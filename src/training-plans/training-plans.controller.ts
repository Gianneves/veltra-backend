import { Controller, Get, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { TrainingPlansService } from './training-plans.service';
import { RedisService } from 'src/redis/redis.service';

@Controller('training-plans')
export class TrainingPlansController {
    constructor(
        private readonly trainingPlansService: TrainingPlansService,
        private readonly redisService: RedisService,
    ) {}

    private async getUserIdFromSession(req: Request): Promise<string> {
        const sessionId = req.cookies?.user_session;
        if (!sessionId) throw new UnauthorizedException('Não autenticado');
        const userId = await this.redisService.get(`app:session:${sessionId}`);
        if (!userId) throw new UnauthorizedException('Sessão inválida');
        return userId;
    }

    @Get('current')
    async findCurrent(@Req() req: Request) {
        const userId = await this.getUserIdFromSession(req);
        return this.trainingPlansService.findCurrent(userId);
    }
}
