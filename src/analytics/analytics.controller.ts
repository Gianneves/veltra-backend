import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AnalyticsService } from './analytics.service';
import { AuthSessionService } from 'src/auth/auth-session.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly sessionService: AuthSessionService,
  ) {}

  @Get('weekly')
  async getWeeklyStats(@Req() req: Request) {
    const userId = await this.sessionService.resolveUserId(req);
    return this.analyticsService.getWeeklyStats(userId);
  }
}
