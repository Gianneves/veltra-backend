import dotenv from 'dotenv'
dotenv.config()
import axios from 'axios';
import { prisma } from '../lib/prisma.ts';
import jwt from 'jsonwebtoken';


interface StravaAuthResponse {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    athlete: {
        id: number;
        firstname: string;
        lastname: string;
        city: string | null;
        state: string | null;
        sex: 'M' | 'F' | null;
        weight: number | null;
        profile_medium: string;
    };
}


export const authService = {
    generateStravaAuthUrl: () => {
        const clientId = process.env.STRAVA_CLIENT_ID;
        const redirectUri = process.env.STRAVA_REDIRECT_URI;

        const scope = 'read,activity:read_all';

        return `https://www.strava.com/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;
    },

    authenticateWithStrava: async (code: string) => {
        const response = await axios.post<StravaAuthResponse>('https://www.strava.com/oauth/token', {
            client_id: process.env.STRAVA_CLIENT_ID,
            client_secret: process.env.STRAVA_CLIENT_SECRET,
            code: code,
            grant_type: 'authorization_code'
        });

        const { access_token, refresh_token, expires_at, athlete } = response.data;

        const weight = athlete.weight ? Number(athlete.weight) : null;

        let userSex: 'M' | 'F' | 'O' = 'O';
        if (athlete.sex === 'M') userSex = 'M';
        if (athlete.sex === 'F') userSex = 'F';

        const stravaIdStr = String(athlete.id);
        const expirationDate = new Date(expires_at * 1000);


        const user = await prisma.user.upsert({
            where: { stravaId: stravaIdStr },
            update: {
                accessToken: access_token,
                refreshToken: refresh_token,
                expiresAt: expirationDate,
                name: athlete.firstname,
            },
            create: {
                stravaId: athlete.id,
                name: athlete.firstname,
                accessToken: access_token,
                refreshToken: refresh_token,
                expiresAt: expirationDate,
                profile: {
                    create: {
                        sex: userSex,
                        weight: weight,
                        city: athlete.city,
                        state: athlete.state,
                        profile_photo: athlete.profile_medium
                    }
                }
            }
        })

        const secretKey = process.env.SECRET_KEY_JWT

        if (!secretKey) {
            throw new Error("MISSING_KEY")
        }

        const token = jwt.sign({  })
    }
};