import { Injectable } from '@nestjs/common';
import {
  AiProvider,
  AiProviderUnavailableError,
  type AiProviderName,
  type AiProviderRequest,
  type AiProviderResult,
} from './ai-provider';
import { AiProviderStateService } from './ai-provider-state.service';
import { DeepSeekProvider } from './deepseek-provider';
import type { AiTier, ModelDecision } from './model-router';
import { OpenAiProvider } from './openai-provider';

const PRIMARY: AiProviderName = 'openai';
const SECONDARY: AiProviderName = 'deepseek';
const SWITCH_STATUS = [401, 402, 403, 429];

interface ProviderRoute {
  marker: { until: number } | null;
  secondary: boolean;
}

@Injectable()
export class AiFailoverService extends AiProvider {
  constructor(
    private readonly primary: OpenAiProvider,
    private readonly secondary: DeepSeekProvider,
    private readonly state: AiProviderStateService,
  ) {
    super();
  }

  decide(request: AiProviderRequest): ModelDecision {
    return this.primary.decide(request);
  }

  canEscalate(provider: AiProviderName): boolean {
    const target: AiProvider =
      provider === PRIMARY ? this.primary : this.secondary;
    return target.canEscalate(provider);
  }

  isConfigured(): boolean {
    return this.primary.isConfigured() || this.secondary.isConfigured();
  }

  async complete(
    request: AiProviderRequest,
    tier: AiTier,
  ): Promise<AiProviderResult> {
    const route = await this.route();
    if (route.secondary) {
      return this.runSecondary(() => this.secondary.complete(request, tier));
    }

    try {
      const result = await this.primary.complete(request, tier);
      if (!result.text.trim() && this.secondary.isConfigured()) {
        throw new AiProviderUnavailableError(PRIMARY, 'empty');
      }
      if (route.marker) await this.state.clearPrimaryDown();
      return result;
    } catch (err) {
      if (!this.secondary.isConfigured() || !this.switchesOn(err)) throw err;

      await this.state.markPrimaryDown();
      return this.runSecondary(() => this.secondary.complete(request, tier));
    }
  }

  async stream(
    request: AiProviderRequest,
    tier: AiTier,
    onToken: (token: string) => void,
  ): Promise<AiProviderResult> {
    const route = await this.route();
    if (route.secondary) {
      return this.runSecondary(() =>
        this.secondary.stream(request, tier, onToken),
      );
    }

    let emitted = false;
    try {
      const result = await this.primary.stream(request, tier, (token) => {
        emitted = true;
        onToken(token);
      });
      if (route.marker) await this.state.clearPrimaryDown();
      return result;
    } catch (err) {
      if (!this.secondary.isConfigured() || !this.switchesOn(err)) throw err;

      await this.state.markPrimaryDown();
      if (emitted) throw err;

      return this.runSecondary(() =>
        this.secondary.stream(request, tier, onToken),
      );
    }
  }

  private async route(): Promise<ProviderRoute> {
    if (!this.primary.isConfigured()) {
      return { marker: null, secondary: true };
    }
    if (!this.secondary.isConfigured()) {
      return { marker: null, secondary: false };
    }

    const marker = await this.state.primaryDown();
    return {
      marker,
      secondary: marker !== null && marker.until > Date.now(),
    };
  }

  private async runSecondary<T>(call: () => Promise<T>): Promise<T> {
    if (!this.secondary.isConfigured()) {
      throw new AiProviderUnavailableError(SECONDARY, 'transport');
    }

    try {
      return await call();
    } catch (err) {
      await this.state.clearPrimaryDown();
      throw err;
    }
  }

  private switchesOn(err: unknown): boolean {
    if (!(err instanceof AiProviderUnavailableError)) return false;

    if (err.reason === 'transport' || err.reason === 'timeout') return true;
    if (err.reason === 'empty') return true;

    if (err.reason === 'http' && err.status !== undefined) {
      return SWITCH_STATUS.includes(err.status) || err.status >= 500;
    }

    return false;
  }
}
