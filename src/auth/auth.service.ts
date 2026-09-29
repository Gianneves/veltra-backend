import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from 'src/redis/redis.service';
import { StravaService } from 'src/strava/strava.service';
import { UsersService } from 'src/users/users.service';
import { v4 as uuidv4 } from 'uuid';
import { SESSION_TTL } from './auth-session.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly stravaService: StravaService,
    private readonly redisService: RedisService,
    private readonly userService: UsersService,
    private readonly jwtService: JwtService,
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
      avatarUrl: data.athlete.profile_medium ?? data.athlete.profile,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
    };

    const user = await this.userService.createOrUpdate(createUser);

    const stravaCacheKey = `strava:token:${user.id}`;
    const stravaTtl = data.expires_at - Math.floor(Date.now() / 1000);

    if (stravaTtl > 0) {
      await this.redisService.set(stravaCacheKey, data.access_token, stravaTtl);
    }

    const sessionId = uuidv4();
    const sessionkey = `app:session:${sessionId}`;

    const sessionTtl = SESSION_TTL;

    await this.redisService.set(sessionkey, user.id, sessionTtl);

    const jwt = await this.jwtService.signAsync(
      { userId: user.id },
      { expiresIn: '7d' },
    );

    return {
      sessionId,
      sessionTtl,
      jwt,
    };
  }

  async getUser(userId: string) {
    const user = await this.userService.findById(userId);
    if (!user) return user;

    if (!user.avatarUrl) {
      const avatarUrl = await this.resolveAvatar(userId);
      if (avatarUrl) user.avatarUrl = avatarUrl;
    }

    return user;
  }

  private async resolveAvatar(userId: string): Promise<string | null> {
    try {
      let token = await this.redisService.get(`strava:token:${userId}`);

      if (!token) {
        const fullUser = await this.userService.findFullById(userId);
        if (!fullUser) return null;

        const tokenStillValid =
          Boolean(fullUser.accessToken) &&
          fullUser.expiresAt !== undefined &&
          fullUser.expiresAt.getTime() > Date.now() + 60_000;

        if (tokenStillValid) {
          token = fullUser.accessToken;
        } else if (fullUser.refreshToken) {
          const data = await this.stravaService.refreshAccessToken(
            fullUser.refreshToken,
          );

          await this.userService.updateStravaTokens(userId, {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: data.expires_at,
          });

          token = data.access_token;
        }
      }

      if (!token) return null;

      const avatarUrl = await this.stravaService.fetchAthleteAvatar(token);
      if (avatarUrl) await this.userService.updateAvatar(userId, avatarUrl);

      return avatarUrl;
    } catch (error) {
      console.error(
        'Falha ao obter avatar do Strava:',
        (error as Error).message,
      );
      return null;
    }
  }

  async logout(sessionId: string) {
    const sessionKey = `app:session:${sessionId}`;
    await this.redisService.del(sessionKey);
  }
}
