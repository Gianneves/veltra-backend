import { Controller, Get, Put, Body, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { TrainingPlansService } from './training-plans.service';
import { AuthSessionService } from 'src/auth/auth-session.service';

@Controller('training-plans')
export class TrainingPlansController {
  constructor(
    private readonly trainingPlansService: TrainingPlansService,
    private readonly sessionService: AuthSessionService,
  ) {}

  @Get('current')
  async findCurrent(@Req() req: Request) {
    const userId = await this.sessionService.resolveUserId(req);
    return this.trainingPlansService.findCurrent(userId);
  }

  @Get()
  async findAll(@Req() req: Request) {
    const userId = await this.sessionService.resolveUserId(req);
    return this.trainingPlansService.findAll(userId);
  }

  @Get('by-week')
  async findByWeek(@Query('weekStart') weekStart: string, @Req() req: Request) {
    const userId = await this.sessionService.resolveUserId(req);
    return this.trainingPlansService.findByWeek(userId, weekStart);
  }

  @Put(':planId/sessions/:sessionId')
  async updateSession(
    @Param('planId') planId: string,
    @Param('sessionId') sessionId: string,
    @Body()
    data: {
      plannedDistance?: number;
      plannedPace?: number;
      type?: string;
      day?: string;
      notes?: string;
    },
    @Req() req: Request,
  ) {
    const userId = await this.sessionService.resolveUserId(req);
    return this.trainingPlansService.updateSession(
      planId,
      sessionId,
      userId,
      data,
    );
  }
}
