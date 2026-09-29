import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthSessionService } from 'src/auth/auth-session.service';
import { InsightsService } from './insights.service';

@Controller('insights')
export class InsightsController {
  constructor(
    private readonly insightsService: InsightsService,
    private readonly sessionService: AuthSessionService,
  ) {}

  @Get()
  async findAll(@Req() req: Request, @Query('limit') limit?: string) {
    const userId = await this.sessionService.resolveUserId(req);
    return this.insightsService.getRecentForUser(
      userId,
      limit ? Number(limit) : undefined,
    );
  }
}
