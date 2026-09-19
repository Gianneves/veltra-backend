import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthSessionService } from 'src/auth/auth-session.service';
import { HealthAlertsService } from './health-alerts.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly healthAlertsService: HealthAlertsService,
    private readonly sessionService: AuthSessionService,
  ) {}

  @Get('alerts')
  async getAlerts(@Req() req: Request) {
    const userId = await this.sessionService.resolveUserId(req);
    return this.healthAlertsService.getOverview(userId);
  }

  @Get('policy')
  async getPolicy(
    @Req() req: Request,
    @Query('distanceKm') distanceKm?: string,
  ) {
    const userId = await this.sessionService.resolveUserId(req);
    const parsed = distanceKm !== undefined ? Number(distanceKm) : undefined;
    return this.healthAlertsService.getPolicy(
      userId,
      parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
    );
  }
}
