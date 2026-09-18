import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthSessionService } from 'src/auth/auth-session.service';
import { AchievementsService } from './achievements.service';

@Controller('achievements')
export class AchievementsController {
  constructor(
    private readonly achievementsService: AchievementsService,
    private readonly sessionService: AuthSessionService,
  ) {}

  @Get()
  async getAchievements(@Req() req: Request) {
    const userId = await this.sessionService.resolveUserId(req);
    return this.achievementsService.getAchievements(userId);
  }
}
