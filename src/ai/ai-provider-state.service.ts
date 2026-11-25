import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';

const PRIMARY_DOWN_KEY = 'ai:provider:primary:down';
const NOTICE_KEY_PREFIX = 'ai:provider:notice:';
const NOTICE_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_COOLDOWN_SECONDS = 60;

@Injectable()
export class AiProviderStateService {
  constructor(private readonly redis: RedisService) {}

  private cooldownSeconds(): number {
    const raw = process.env.AI_FAILOVER_COOLDOWN_SECONDS?.trim();
    if (!raw) return DEFAULT_COOLDOWN_SECONDS;

    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return DEFAULT_COOLDOWN_SECONDS;
    return parsed <= 0 ? 0 : parsed;
  }

  async primaryDown(): Promise<{ until: number } | null> {
    try {
      const raw = await this.redis.get(PRIMARY_DOWN_KEY);
      if (!raw) return null;

      const until = Number.parseInt(raw, 10);
      return Number.isFinite(until) ? { until } : null;
    } catch (err) {
      this.warn('ler', err);
      return null;
    }
  }

  async markPrimaryDown(): Promise<number | null> {
    const seconds = this.cooldownSeconds();
    if (seconds <= 0) return null;

    const until = Date.now() + seconds * 1000;

    try {
      await this.redis.set(PRIMARY_DOWN_KEY, String(until), seconds);
      return until;
    } catch (err) {
      this.warn('gravar', err);
      return null;
    }
  }

  async clearPrimaryDown(): Promise<void> {
    try {
      await this.redis.del(PRIMARY_DOWN_KEY);
    } catch (err) {
      this.warn('apagar', err);
    }
  }

  async consumeNotice(userId: string, episodeId: number): Promise<boolean> {
    const key = this.noticeKey(userId);
    const value = String(episodeId);

    try {
      if (await this.redis.setNx(key, value, NOTICE_TTL_SECONDS)) return true;
    } catch (err) {
      this.warn('gravar', err);
      return false;
    }

    let current: string | null;
    try {
      current = await this.redis.get(key);
    } catch (err) {
      this.warn('ler', err);
      return false;
    }

    if (current === value) return false;

    try {
      await this.redis.set(key, value, NOTICE_TTL_SECONDS);
      return true;
    } catch (err) {
      this.warn('gravar', err);
      return false;
    }
  }

  async clearNotice(userId: string): Promise<void> {
    try {
      await this.redis.del(this.noticeKey(userId));
    } catch (err) {
      this.warn('apagar', err);
    }
  }

  private noticeKey(userId: string): string {
    return `${NOTICE_KEY_PREFIX}${userId}`;
  }

  private warn(action: string, err: unknown): void {
    console.warn(
      `[ai] não foi possível ${action} o estado do fornecedor:`,
      (err as Error).message,
    );
  }
}
