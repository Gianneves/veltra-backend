import { Controller, Get, Post, Body, Query, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { CoachService } from './coach.service';
import { SendMessageDto } from './dto/send-message.dto';
import { RedisService } from 'src/redis/redis.service';

@Controller('coach')
export class CoachController {
    constructor(
        private readonly coachService: CoachService,
        private readonly redisService: RedisService,
    ) {}

    private async getUserIdFromSession(req: Request): Promise<string> {
        const sessionId = req.cookies?.user_session;
        if (!sessionId) throw new UnauthorizedException('Não autenticado');
        const userId = await this.redisService.get(`app:session:${sessionId}`);
        if (!userId) throw new UnauthorizedException('Sessão inválida');
        return userId;
    }

    @Get('insights')
    async getInsights(@Req() req: Request) {
        const userId = await this.getUserIdFromSession(req);
        return this.coachService.getInsights(userId);
    }

    @Get('chat')
    async getMessages(@Query('conversation_id') conversationId: string, @Req() req: Request) {
        const userId = await this.getUserIdFromSession(req);
        if (!conversationId) {
            return this.coachService.getConversations(userId);
        }
        return this.coachService.getMessages(conversationId, userId);
    }

    @Post('chat')
    async sendMessage(@Body() dto: SendMessageDto, @Req() req: Request) {
        const userId = await this.getUserIdFromSession(req);
        return this.coachService.sendMessage(userId, dto.content, dto.conversationId);
    }
}
