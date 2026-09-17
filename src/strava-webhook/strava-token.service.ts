import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import { StravaService } from 'src/strava/strava.service';
import { UsersService } from 'src/users/users.service';
import type { User } from 'src/users/entities/user.entity';

const TOKEN_MARGIN_MS = 60_000;
const LOCK_TTL_SECONDS = 30;
const LOCK_WAIT_ATTEMPTS = 10;
const LOCK_WAIT_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class StravaTokenService {
  constructor(
    private readonly stravaService: StravaService,
    private readonly usersService: UsersService,
    private readonly redisService: RedisService,
  ) {}

  async getAccessToken(user: User): Promise<string | null> {
    const cacheKey = `strava:token:${user.id}`;

    const cached = await this.redisService.get(cacheKey);
    if (cached) return cached;

    if (
      user.accessToken &&
      user.expiresAt &&
      user.expiresAt.getTime() > Date.now() + TOKEN_MARGIN_MS
    ) {
      await this.cacheToken(user.id, user.accessToken, user.expiresAt);
      return user.accessToken;
    }

    if (!user.refreshToken) return null;

    const lockKey = `strava:refresh:${user.id}`;
    const locked = await this.redisService.setNx(
      lockKey,
      '1',
      LOCK_TTL_SECONDS,
    );

    if (!locked) {
      for (let attempt = 0; attempt < LOCK_WAIT_ATTEMPTS; attempt++) {
        await sleep(LOCK_WAIT_MS);
        const token = await this.redisService.get(cacheKey);
        if (token) return token;
      }
      return null;
    }

    try {
      const data = await this.stravaService.refreshAccessToken(
        user.refreshToken,
      );

      await this.usersService.updateStravaTokens(user.id, {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_at,
      });

      await this.cacheToken(
        user.id,
        data.access_token,
        new Date(data.expires_at * 1000),
      );

      return data.access_token;
    } catch (err) {
      console.error(
        'Falha ao renovar token do Strava:',
        (err as Error).message,
      );
      return null;
    } finally {
      await this.redisService.del(lockKey);
    }
  }

  async invalidate(userId: string): Promise<void> {
    await this.redisService.del(`strava:token:${userId}`);
  }

  private async cacheToken(
    userId: string,
    token: string,
    expiresAt: Date,
  ): Promise<void> {
    const ttl = Math.floor((expiresAt.getTime() - Date.now()) / 1000) - 60;
    if (ttl > 30) {
      await this.redisService.set(`strava:token:${userId}`, token, ttl);
    }
  }
}
