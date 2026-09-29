import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Activity } from 'src/activities/entities/activity.entity';
import {
  AiService,
  parseActivityInsight,
  type ActivityInsightContent,
} from 'src/ai/ai.service';
import { Goal } from 'src/goals/entities/goal.entity';
import {
  buildActivityFeatures,
  classifyRunType,
} from 'src/training-plans/activity-features';
import {
  AthleteProfileService,
  type AthleteProfile,
} from 'src/training-plans/athlete-profile.service';
import { TrainingSession } from 'src/training-plans/entities/training-session.entity';
import { buildActivityInsightContext } from './activity-insight-context';
import { assessAdherence, type AdherenceVerdict } from './adherence';
import { Insight } from './entities/insight.entity';

export interface ActivityInsightResponse {
  id: string;
  activityId: string;
  status: string;
  content: ActivityInsightContent | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface InsightFeedItem extends ActivityInsightResponse {
  activityName: string;
  activityDate: string | null;
  activityType: string | null;
  distanceKm: number;
  paceSecondsPerKm: number;
  verdict: AdherenceVerdict | null;
}

const DEFAULT_FEED_LIMIT = 20;

@Injectable()
export class InsightsService {
  constructor(
    @InjectRepository(Insight)
    private readonly insightRepository: Repository<Insight>,
    @InjectRepository(Activity)
    private readonly activityRepository: Repository<Activity>,
    @InjectRepository(TrainingSession)
    private readonly sessionRepository: Repository<TrainingSession>,
    @InjectRepository(Goal)
    private readonly goalRepository: Repository<Goal>,
    private readonly athleteProfileService: AthleteProfileService,
    private readonly aiService: AiService,
  ) {}

  async getForActivity(
    activityId: string,
    userId: string,
  ): Promise<ActivityInsightResponse | null> {
    const activity = await this.activityRepository.findOne({
      where: { id: activityId, user: { id: userId } },
    });
    if (!activity) return null;

    const insight = await this.insightRepository.findOne({
      where: { activityId },
    });

    return insight ? this.toResponse(insight) : null;
  }

  async generateForActivity(
    activity: Activity,
    userId: string,
  ): Promise<ActivityInsightResponse | null> {
    const existing = await this.insightRepository.findOne({
      where: { activityId: activity.id },
    });
    const insight =
      existing ??
      this.insightRepository.create({ activityId: activity.id, content: '' });

    insight.status = 'pending';
    await this.insightRepository.save(insight);

    const context = await this.buildContext(activity, userId);
    const content = await this.aiService.generateActivityInsight(context);

    if (content) {
      insight.content = JSON.stringify(content);
      insight.status = 'completed';
    } else {
      insight.status = 'failed';
    }

    const saved = await this.insightRepository.save(insight);

    return this.toResponse(saved);
  }

  async generateIfMissing(activity: Activity, userId: string): Promise<void> {
    try {
      const existing = await this.insightRepository.findOne({
        where: { activityId: activity.id },
      });
      if (existing?.status === 'completed') return;

      await this.generateForActivity(activity, userId);
    } catch (err) {
      console.error(
        'Falha ao gerar insight da corrida:',
        (err as Error).message,
      );
    }
  }

  async getRecentForUser(
    userId: string,
    limit = DEFAULT_FEED_LIMIT,
  ): Promise<InsightFeedItem[]> {
    const insights = await this.insightRepository.find({
      where: { status: 'completed', activity: { user: { id: userId } } },
      relations: ['activity'],
      order: { createdAt: 'DESC' },
      take: limit,
    });

    if (insights.length === 0) return [];

    const sessions = await this.sessionRepository.find({
      where: { activityId: In(insights.map((insight) => insight.activityId)) },
    });
    const sessionByActivity = new Map(
      sessions.map((session) => [session.activityId, session]),
    );

    return insights.map((insight) => {
      const session = sessionByActivity.get(insight.activityId);
      const adherence = session
        ? assessAdherence({
            plannedDistance: session.plannedDistance,
            plannedPace: session.plannedPace,
            actualDistance: session.actualDistance,
            actualPace: session.actualPace,
          })
        : null;

      const activity = insight.activity;
      const distanceKm = activity.distance / 1000;

      return {
        ...this.toResponse(insight),
        activityName: activity.name,
        activityDate:
          activity.start_date_local?.toISOString() ??
          activity.start_date?.toISOString() ??
          null,
        activityType: activity.sport_type ?? activity.type ?? null,
        distanceKm,
        paceSecondsPerKm:
          distanceKm > 0 ? activity.moving_time / distanceKm : 0,
        verdict: adherence?.verdict ?? null,
      };
    });
  }

  private async buildContext(
    activity: Activity,
    userId: string,
  ): Promise<string> {
    const features = buildActivityFeatures(activity);
    const runType = classifyRunType(features);

    const session = await this.sessionRepository.findOne({
      where: { activityId: activity.id },
      relations: ['plan'],
    });

    const goal = await this.goalRepository.findOne({
      where: { userId, status: 'active' },
      order: { createdAt: 'DESC' },
    });

    let profile: AthleteProfile | null = null;
    try {
      profile = await this.athleteProfileService.build(userId);
    } catch {
      profile = null;
    }

    return buildActivityInsightContext({
      activity,
      features,
      runType,
      session,
      plan: session?.plan ?? null,
      goal,
      profile,
    });
  }

  private toResponse(insight: Insight): ActivityInsightResponse {
    return {
      id: insight.id,
      activityId: insight.activityId,
      status: insight.status,
      content: this.parseContent(insight.content),
      createdAt: insight.createdAt?.toISOString() ?? null,
      updatedAt: insight.updatedAt?.toISOString() ?? null,
    };
  }

  private parseContent(raw: string | null): ActivityInsightContent | null {
    if (!raw) return null;
    return parseActivityInsight(raw);
  }
}
