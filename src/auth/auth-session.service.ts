import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { RedisService } from 'src/redis/redis.service';
import { v4 as uuidv4 } from 'uuid';

export const SESSION_TTL = 7 * 24 * 60 * 60;
export const SESSION_COOKIE = 'user_session';
export const AUTH_COOKIE = 'veltra_auth';

@Injectable()
export class AuthSessionService {
  constructor(
    private readonly redisService: RedisService,
    private readonly jwtService: JwtService,
  ) {}

  async resolveUserId(req: Request): Promise<string> {
    const sessionId = req.cookies?.[SESSION_COOKIE] as string | undefined;

    if (sessionId) {
      const userId = await this.redisService.get(`app:session:${sessionId}`);
      if (userId) return userId;
    }

    const token = req.cookies?.[AUTH_COOKIE] as string | undefined;
    if (token) {
      const userId = await this.recoverFromJwt(token, sessionId);
      if (userId) return userId;
    }

    throw new UnauthorizedException('Sessão inválida ou expirada');
  }

  private async recoverFromJwt(
    token: string,
    sessionId?: string,
  ): Promise<string | null> {
    try {
      const payload = this.jwtService.verify<{ userId?: string }>(token);
      if (!payload?.userId) return null;

      const key = `app:session:${sessionId ?? uuidv4()}`;
      await this.redisService.set(key, payload.userId, SESSION_TTL);
      return payload.userId;
    } catch {
      return null;
    }
  }
}
