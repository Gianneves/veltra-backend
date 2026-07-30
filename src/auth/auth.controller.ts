import { Controller, Get, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
    constructor(
        private readonly authService: AuthService
    ){}

    @Get('strava/connect')
    async connectWithStrava(@Res() res: Response) {
        const url = this.authService.generateStravaAuthUrl();
        return res.redirect(url);
    }

    @Get('strava/callback')
    async handleStravaCallback(
        @Query('code') code: string,
        @Res() res: Response
    ) {
        const { sessionId, sessionTtl } = await this.authService.handleStravaCallback(code);

        res.cookie('user_session', sessionId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
            maxAge: sessionTtl * 1000
        });

        const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
        return res.redirect(`${frontendUrl}/dashboard`);
    }

    @Get('me')
    async getMe(@Req() req: Request) {
        const sessionId = req.cookies?.user_session;
        if (!sessionId) {
            throw new UnauthorizedException('Não autenticado');
        }

        const user = await this.authService.getMe(sessionId);
        if (!user) {
            throw new UnauthorizedException('Sessão inválida ou expirada');
        }

        return user;
    }

    @Post('logout')
    async logout(@Req() req: Request, @Res() res: Response) {
        const sessionId = req.cookies?.user_session;
        if (sessionId) {
            await this.authService.logout(sessionId);
        }

        res.clearCookie('user_session', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        });

        return res.status(200).json({ success: true });
    }
}
