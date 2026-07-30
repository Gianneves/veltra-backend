import { Controller, Get, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AnalyticsService } from './analytics.service';
import { RedisService } from 'src/redis/redis.service';

@Controller('analytics')
export class AnalyticsController {
    constructor(
        private readonly analyticsService: AnalyticsService,
        private readonly redisService: RedisService,
    ) {}

    private async getUserIdFromSession(req: Request): Promise<string> {
        const sessionId = req.cookies?.user_session;
        if (!sessionId) throw new UnauthorizedException('Não autenticado');
        const userId = await this.redisService.get(`app:session:${sessionId}`);
        if (!userId) throw new UnauthorizedException('Sessão inválida');
        return userId;
    }

    @Get('weekly')
    async getWeeklyStats(@Req() req: Request) {
        const userId = await this.getUserIdFromSession(req);
        return this.analyticsService.getWeeklyStats(userId);
    }
}
