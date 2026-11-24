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
    const secondaryConfigured = this.secondary.isConfigured();

    if (!this.primary.isConfigured()) {
      return this.onlySecondary(secondaryConfigured, () =>
        this.secondary.complete(request, tier),
      );
    }

    const marker = secondaryConfigured ? await this.state.primaryDown() : null;
    if (marker && marker.until > Date.now()) {
      return this.untilSecondaryEnds(() =>
        this.secondary.complete(request, tier),
      );
    }

    try {
      const result = await this.primary.complete(request, tier);
      if (!result.text.trim()) {
        throw new AiProviderUnavailableError(PRIMARY, 'empty');
      }
      if (marker) await this.state.clearPrimaryDown();
      return result;
    } catch (err) {
      if (!secondaryConfigured || !this.switchesOn(err, true)) throw err;

      await this.state.markPrimaryDown();
      return this.untilSecondaryEnds(() =>
        this.secondary.complete(request, tier),
      );
    }
  }

  async stream(
    request: AiProviderRequest,
    tier: AiTier,
    onToken: (token: string) => void,
  ): Promise<AiProviderResult> {
    const secondaryConfigured = this.secondary.isConfigured();

    if (!this.primary.isConfigured()) {
      return this.onlySecondary(secondaryConfigured, () =>
        this.secondary.stream(request, tier, onToken),
      );
    }

    const marker = secondaryConfigured ? await this.state.primaryDown() : null;
    if (marker && marker.until > Date.now()) {
      return this.untilSecondaryEnds(() =>
        this.secondary.stream(request, tier, onToken),
      );
    }

    let emitted = false;
    try {
      const result = await this.primary.stream(request, tier, (token) => {
        emitted = true;
        onToken(token);
      });
      if (marker) await this.state.clearPrimaryDown();
      return result;
    } catch (err) {
      if (!secondaryConfigured || !this.switchesOn(err, false)) throw err;

      await this.state.markPrimaryDown();
      if (emitted) throw err;

      return this.untilSecondaryEnds(() =>
        this.secondary.stream(request, tier, onToken),
      );
    }
  }

  private async onlySecondary<T>(
    configured: boolean,
    call: () => Promise<T>,
  ): Promise<T> {
    if (!configured) {
      throw new AiProviderUnavailableError(SECONDARY, 'transport');
    }
    return call();
  }

  private async untilSecondaryEnds<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      await this.state.clearPrimaryDown();
      throw err;
    }
  }

  private switchesOn(err: unknown, allowEmpty: boolean): boolean {
    if (!(err instanceof AiProviderUnavailableError)) return false;

    if (err.reason === 'transport' || err.reason === 'timeout') return true;
    if (err.reason === 'empty') return allowEmpty;

    if (err.reason === 'http' && err.status !== undefined) {
      return SWITCH_STATUS.includes(err.status) || err.status >= 500;
    }

    return false;
  }
}
