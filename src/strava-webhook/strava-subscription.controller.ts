import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthSessionService } from 'src/auth/auth-session.service';
import { StravaService } from 'src/strava/strava.service';

@Controller('strava/subscription')
export class StravaSubscriptionController {
  constructor(
    private readonly stravaService: StravaService,
    private readonly sessionService: AuthSessionService,
  ) {}

  @Post()
  async subscribe(@Req() req: Request, @Body() body: { callbackUrl?: string }) {
    await this.sessionService.resolveUserId(req);

    const callbackUrl =
      body?.callbackUrl ?? process.env.STRAVA_WEBHOOK_CALLBACK_URL;
    const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;

    if (!callbackUrl || !verifyToken) {
      throw new BadRequestException(
        'callbackUrl e STRAVA_WEBHOOK_VERIFY_TOKEN são obrigatórios',
      );
    }

    return this.stravaService.subscribePush(callbackUrl, verifyToken);
  }

  @Get()
  async list(@Req() req: Request) {
    await this.sessionService.resolveUserId(req);
    return this.stravaService.listPushSubscriptions();
  }

  @Delete()
  async remove(@Req() req: Request, @Body() body: { id: number }) {
    await this.sessionService.resolveUserId(req);

    if (!body?.id) {
      throw new BadRequestException('id da subscription é obrigatório');
    }

    await this.stravaService.deletePushSubscription(body.id);
    return { deleted: true, id: body.id };
  }
}
