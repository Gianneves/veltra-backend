import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { Activity, StravaAuthResponse } from 'src/utils/types';

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

    async fetchAllActivities(accessToken: string) {
        try {
            const allRunningActivities: any = [];
            let page = 1;
            const perPage = 200;
            let keepFetching = true;

            while (keepFetching) {
                try {
                    const response = await fetch(
                        `https://www.strava.com/api/v3/athlete/activities?page=${page}&per_page=${perPage}`,
                        {
                            method: 'GET',
                            headers: {
                                'Authorization': `Bearer ${accessToken}`,
                                'Content-Type': 'application/json'
                            }
                        }
                    );

                    if (!response.ok) {
                        throw new Error(`Strava API Error: ${response.status}  ${response.statusText}`);
                    }

                    const activities = await response.json();

                    if (activities.length === 0) {
                        keepFetching = false;
                        break;
                    }

                    const runs = activities.filter(activity => 
                        activity.type === 'Run' || activity.sport_type === 'Run'
                    );

                    allRunningActivities.push(...runs);

                    if (activities.length < perPage) {
                        keepFetching = false;
                    } else {
                        page++;
                    }
                    
                } catch (error) {
                    console.error(`Failed to fetch page: ${page}:`, error);
                    keepFetching = false;
                }
            }
            return allRunningActivities;
        } catch (error: unknown) {
            console.error(`Falha ao buscar atividades: ${error}`);
            return [];
        }
    }

}
