import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
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

        return res.status(200).json({
            success: true,
            message: 'Autenticado com sucesso!'
        });
    }
}
