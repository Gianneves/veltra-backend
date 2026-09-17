import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { StravaWebhookEvent } from 'src/utils/types';
import { StravaWebhookService } from './strava-webhook.service';

@Controller('strava/webhook')
@SkipThrottle()
export class StravaWebhookController {
  constructor(private readonly webhookService: StravaWebhookService) {}

  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const expected = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;

    if (
      mode === 'subscribe' &&
      expected &&
      verifyToken === expected &&
      challenge
    ) {
      return res.json({ 'hub.challenge': challenge });
    }

    throw new UnauthorizedException('invalid webhook verification');
  }

  @Post()
  async receive(@Body() event: StravaWebhookEvent) {
    await this.webhookService.enqueue(event);
    return { ok: true };
  }
}
