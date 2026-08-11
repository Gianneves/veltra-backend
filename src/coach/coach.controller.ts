import { Controller, Get, Post, Body, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CoachService } from './coach.service';
import { SendMessageDto } from './dto/send-message.dto';
import { AuthSessionService } from 'src/auth/auth-session.service';

@Controller('coach')
export class CoachController {
  constructor(
    private readonly coachService: CoachService,
    private readonly sessionService: AuthSessionService,
  ) {}

  @Get('insights')
  async getInsights(@Req() req: Request) {
    const userId = await this.sessionService.resolveUserId(req);
    return this.coachService.getInsights(userId);
  }

  @Get('chat')
  async getMessages(
    @Query('conversation_id') conversationId: string,
    @Req() req: Request,
  ) {
    const userId = await this.sessionService.resolveUserId(req);
    if (!conversationId) {
      return this.coachService.getConversations(userId);
    }
    return this.coachService.getMessages(conversationId, userId);
  }

  @Post('chat')
  async sendMessage(@Body() dto: SendMessageDto, @Req() req: Request) {
    const userId = await this.sessionService.resolveUserId(req);
    return this.coachService.sendMessage(
      userId,
      dto.content,
      dto.conversationId,
    );
  }
}
