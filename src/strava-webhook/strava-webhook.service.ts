import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ActivitiesService } from 'src/activities/activities.service';
import { CreateActivityDto } from 'src/activities/dto/create-activity.dto';
import { RedisService } from 'src/redis/redis.service';
import { StravaService } from 'src/strava/strava.service';
import { ActivityMatcherService } from 'src/training-plans/activity-matcher.service';
import { UsersService } from 'src/users/users.service';
import type { User } from 'src/users/entities/user.entity';
import type { Activity, StravaWebhookEvent } from 'src/utils/types';
import { StravaTokenService } from './strava-token.service';

const QUEUE_KEY = 'strava:events';
const FAILED_KEY = 'strava:events:failed';
const DEDUP_TTL_SECONDS = 3600;
const MAX_ATTEMPTS = 3;
const WORKER_INTERVAL_MS = 1500;
const BATCH_SIZE = 10;

const RUN_SPORTS = ['Run', 'TrailRun', 'VirtualRun'];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class StravaWebhookService implements OnModuleInit, OnModuleDestroy {
  private worker?: NodeJS.Timeout;
  private processing = false;

  constructor(
    private readonly stravaService: StravaService,
    private readonly usersService: UsersService,
    private readonly activitiesService: ActivitiesService,
    private readonly matcher: ActivityMatcherService,
    private readonly tokenService: StravaTokenService,
    private readonly redisService: RedisService,
  ) {}

  onModuleInit() {
    this.worker = setInterval(() => {
      void this.processQueue();
    }, WORKER_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.worker) clearInterval(this.worker);
  }

  async enqueue(event: StravaWebhookEvent): Promise<boolean> {
    if (
      !event ||
      (event.object_type !== 'activity' && event.object_type !== 'athlete')
    ) {
      return false;
    }

    const dedupKey = `strava:evt:${event.object_type}:${event.object_id}:${event.aspect_type}:${event.event_time}`;
    const isNew = await this.redisService.setNx(
      dedupKey,
      '1',
      DEDUP_TTL_SECONDS,
    );
    if (!isNew) return false;

    await this.redisService.lpush(QUEUE_KEY, JSON.stringify(event));
    return true;
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      for (let i = 0; i < BATCH_SIZE; i++) {
        const raw = await this.redisService.rpop(QUEUE_KEY);
        if (!raw) break;
        await this.processWithRetry(raw);
      }
    } catch (err) {
      console.error(
        'Erro no worker do webhook Strava:',
        (err as Error).message,
      );
    } finally {
      this.processing = false;
    }
  }

  private async processWithRetry(raw: string): Promise<void> {
    let event: StravaWebhookEvent;

    try {
      event = JSON.parse(raw) as StravaWebhookEvent;
    } catch {
      await this.redisService.lpush(FAILED_KEY, raw);
      return;
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await this.handleEvent(event);
        return;
      } catch (err) {
        const isLast = attempt === MAX_ATTEMPTS;
        console.error(
          `Evento Strava ${event.object_type}/${event.object_id} falhou (tentativa ${attempt}):`,
          (err as Error).message,
        );
        if (isLast) {
          await this.redisService.lpush(FAILED_KEY, raw);
        } else {
          await sleep(1000 * attempt);
        }
      }
    }
  }

  async handleEvent(event: StravaWebhookEvent): Promise<void> {
    if (event.object_type === 'athlete') {
      await this.handleAthleteEvent(event);
      return;
    }

    if (event.object_type !== 'activity') return;

    const user = await this.usersService.findByStravaId(event.owner_id);
    if (!user) return;

    if (event.aspect_type === 'delete') {
      await this.handleDelete(event.object_id);
      return;
    }

    await this.handleUpsert(user, event);
  }

  private async handleAthleteEvent(event: StravaWebhookEvent): Promise<void> {
    const updates = event.updates ?? {};
    if (updates.authorized === false) {
      const user = await this.usersService.findByStravaId(event.owner_id);
      if (user) {
        await this.usersService.clearStravaTokens(user.id);
        await this.tokenService.invalidate(user.id);
      }
    }
  }

  private async handleDelete(stravaActivityId: number): Promise<void> {
    const activity =
      await this.activitiesService.findByStravaId(stravaActivityId);
    if (!activity) return;

    await this.matcher.unlinkSessionsForActivity(activity.id);
    await this.activitiesService.remove(activity);
  }

  private async handleUpsert(
    user: User,
    event: StravaWebhookEvent,
  ): Promise<void> {
    const token = await this.tokenService.getAccessToken(user);
    if (!token) {
      throw new Error('sem token Strava válido');
    }

    const detail = await this.stravaService.fetchActivityById(
      event.object_id,
      token,
    );
    if (!detail) return;

    const existing = await this.activitiesService.findByStravaId(
      event.object_id,
    );
    const isRun = RUN_SPORTS.includes(detail.sport_type ?? detail.type ?? '');

    if (!isRun) {
      if (existing) {
        await this.matcher.unlinkSessionsForActivity(existing.id);
        await this.activitiesService.remove(existing);
      }
      return;
    }

    const saved = await this.activitiesService.upsert(
      this.toActivityDto(detail),
      user,
    );

    if (existing && (await this.matcher.isManuallyLinked(saved.id))) {
      return;
    }

    await this.matcher.matchActivity(user.id, saved);
  }

  toActivityDto(detail: Activity): CreateActivityDto {
    return {
      activityStravaId: detail.id as number,
      elapsed_time: detail.elapsed_time,
      moving_time: detail.moving_time,
      name: detail.name,
      type: detail.type,
      sport_type: detail.sport_type,
      distance: detail.distance,
      max_speed: detail.max_speed,
      total_elevation_gain: detail.total_elevation_gain,
      average_cadence: detail.average_cadence,
      average_speed: detail.average_speed,
      startDate: detail.start_date ? new Date(detail.start_date) : undefined,
      startDateLocal: detail.start_date_local
        ? new Date(detail.start_date_local)
        : undefined,
      timezone: detail.timezone,
      laps: detail.laps,
      average_heartrate: detail.average_heartrate,
      max_heartrate: detail.max_heartrate,
      max_watts: detail.max_watts,
    };
  }
}
