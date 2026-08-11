import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService } from './auth.service';
import {
  AuthSessionService,
  AUTH_COOKIE,
  SESSION_COOKIE,
} from './auth-session.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: AuthSessionService,
  ) {}

  @Get('strava/connect')
  connectWithStrava(@Res() res: Response) {
    const url = this.authService.generateStravaAuthUrl();
    return res.redirect(url);
  }

  @Get('strava/callback')
  async handleStravaCallback(
    @Query('code') code: string,
    @Res() res: Response,
  ) {
    const { sessionId, sessionTtl, jwt } =
      await this.authService.handleStravaCallback(code);

    const cookieOptions: CookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    };

    res.cookie(SESSION_COOKIE, sessionId, {
      ...cookieOptions,
      maxAge: sessionTtl * 1000,
    });
    res.cookie(AUTH_COOKIE, jwt, {
      ...cookieOptions,
      maxAge: sessionTtl * 1000,
    });

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    return res.redirect(`${frontendUrl}/dashboard`);
  }

  @Get('me')
  async getMe(@Req() req: Request) {
    const userId = await this.sessionService.resolveUserId(req);

    const user = await this.authService.getUser(userId);
    if (!user) {
      throw new UnauthorizedException('Sessão inválida ou expirada');
    }

    return user;
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res() res: Response) {
    const sessionId = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (sessionId) {
      await this.authService.logout(sessionId);
    }

    const cookieOptions: CookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    };

    res.clearCookie(SESSION_COOKIE, cookieOptions);
    res.clearCookie(AUTH_COOKIE, cookieOptions);

    return res.status(200).json({ success: true });
  }
}
