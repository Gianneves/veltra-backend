import {
  Body,
  Controller,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ActivitiesService } from 'src/activities/activities.service';
import { AuthSessionService } from 'src/auth/auth-session.service';
import { InsightsService } from 'src/insights/insights.service';
import { StravaService } from 'src/strava/strava.service';
import { ActivityMatcherService } from 'src/training-plans/activity-matcher.service';
import { UsersService } from 'src/users/users.service';
import type { Activity } from 'src/utils/types';
import { StravaTokenService } from './strava-token.service';
import { StravaWebhookService } from './strava-webhook.service';

const DEFAULT_DAYS = 7;

@Controller('strava')
export class StravaSyncController {
  constructor(
    private readonly stravaService: StravaService,
    private readonly usersService: UsersService,
    private readonly activitiesService: ActivitiesService,
    private readonly matcher: ActivityMatcherService,
    private readonly tokenService: StravaTokenService,
    private readonly webhookService: StravaWebhookService,
    private readonly insightsService: InsightsService,
    private readonly sessionService: AuthSessionService,
  ) {}

  @Post('resync')
  async resync(@Req() req: Request, @Body() body: { days?: number }) {
    const userId = await this.sessionService.resolveUserId(req);
    const user = await this.usersService.findFullById(userId);
    if (!user) throw new UnauthorizedException('Usuário não encontrado');

    const token = await this.tokenService.getAccessToken(user);
    if (!token) {
      throw new UnauthorizedException(
        'Token do Strava inválido — faça login novamente',
      );
    }

    const days = body?.days && body.days > 0 ? body.days : DEFAULT_DAYS;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    const activities = (await this.stravaService.fetchAllActivities(
      token,
    )) as Activity[];

    let synced = 0;
    let matched = 0;

    for (const summary of activities) {
      const start = summary.start_date
        ? new Date(summary.start_date).getTime()
        : 0;
      if (start < cutoff) continue;

      const detail = await this.fetchDetail(summary, token);

      const saved = await this.activitiesService.upsert(
        this.webhookService.toActivityDto(detail),
        user,
      );

      const result = await this.matcher.matchActivity(user.id, saved);
      void this.insightsService.generateIfMissing(saved, user.id);
      synced += 1;
      if (result.matched) matched += 1;
    }

    return { synced, matched, days };
  }

  private async fetchDetail(
    summary: Activity,
    token: string,
  ): Promise<Activity> {
    if (!summary.has_heartrate) return summary;

    try {
      const detail = await this.stravaService.fetchActivityById(
        summary.id as number,
        token,
      );
      if (detail) return { ...summary, ...detail };
    } catch (err) {
      console.error(
        `Falha ao buscar detalhe da atividade ${summary.id}:`,
        (err as Error).message,
      );
    }

    return summary;
  }
}
