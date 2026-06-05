import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import { StravaService } from 'src/strava/strava.service';
import { UsersService } from 'src/users/users.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AuthService {
    constructor(
        private readonly stravaService: StravaService,
        private readonly redisService: RedisService,
        private readonly userService: UsersService
    ) {}

    generateStravaAuthUrl() {
        const clientId = process.env.STRAVA_CLIENT_ID;
        const redirectUri = process.env.STRAVA_REDIRECT_URI;

        const scope = 'read,activity:read_all';

        return `https://www.strava.com/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;
    }

    async handleStravaCallback(code: string) {
        const data = await this.stravaService.exchangeCodeForTokens(code);

        const createUser = {
            name: data.athlete.firstname + ' ' + data.athlete.lastname,
            stravaId: data.athlete.id,
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: data.expires_at
        }

        const user = await this.userService.createOrUpdate(createUser);


        const stravaCacheKey = `strava:token:${user.id}`;
        const stravaTtl = data.expires_at - Math.floor(Date.now() / 1000);

        if (stravaTtl > 0) {
            await this.redisService.set(stravaCacheKey, data.access_token, stravaTtl);
        }

        const sessionId = uuidv4();
        const sessionkey = `app:session:${sessionId}`;

        const sessionTtl = 7 * 24 * 60 * 60;

        await this.redisService.set(sessionkey, user.id, sessionTtl);
        
        return {
            sessionId,
            sessionTtl
        }
    }
}
