import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CoachService } from './coach.service';
import { SendMessageDto } from './dto/send-message.dto';
import { AuthSessionService } from 'src/auth/auth-session.service';

@Controller('coach')
export class CoachController {
  constructor(
    private readonly coachService: CoachService,
    private readonly sessionService: AuthSessionService,
  ) {}

  @Get('chat')
  async getChat(
    @Query('conversationId') conversationId: string | undefined,
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

  @Post('chat/stream')
  async streamMessage(
    @Body() dto: SendMessageDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const userId = await this.sessionService.resolveUserId(req);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      if (!res.writableEnded) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };

    try {
      const result = await this.coachService.streamMessage(
        userId,
        dto.content,
        dto.conversationId,
        (token) => send('token', { token }),
      );
      send('done', result);
    } catch {
      send('error', {
        message: 'Não foi possível responder agora. Tente novamente.',
      });
    } finally {
      res.end();
    }
  }
}
