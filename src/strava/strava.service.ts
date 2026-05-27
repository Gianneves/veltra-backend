import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { StravaAuthResponse } from 'src/utils/types';

@Injectable()
export class StravaService {
    async exchangeCodeForTokens(code: string): Promise<StravaAuthResponse> {
        const response = await axios.post<StravaAuthResponse>('https://www.strava.com/oauth/token', {
            client_id: process.env.STRAVA_CLIENT_ID,
            client_secret: process.env.STRAVA_CLIENT_SECRET,
            code: code,
            grant_type: 'authorization_code'
        });

        return response.data;
    }

    async refreshAccessToken(refreshToken: string): Promise<StravaAuthResponse> {
        const response = await axios.post<StravaAuthResponse>('https://www.strava.com/oauth/token',
            {
                client_id: process.env.STRAVA_CLIENT_ID,
                client_secret: process.env.STRAVA_CLIENT_SECRET,
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
            });

        return response.data;
    }

    
}
