import type {
  AiTier,
  AiTask,
  ModelDecision,
  RoutingSignals,
} from './model-router';

export type AiProviderMessageRole = 'system' | 'user' | 'assistant';

export interface AiProviderMessage {
  role: AiProviderMessageRole;
  content: string;
}

export interface AiProviderRequest {
  task: AiTask;
  messages: AiProviderMessage[];
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  routing: RoutingSignals;
}

export interface AiProviderResult {
  text: string;
  decision: ModelDecision;
  usage: unknown;
}

export type AiProviderFailureReason = 'http' | 'transport' | 'timeout';

export class AiProviderUnavailableError extends Error {
  constructor(
    readonly provider: string,
    readonly reason: AiProviderFailureReason,
    readonly status?: number,
    readonly cause?: unknown,
  ) {
    super(
      `AI provider ${provider} unavailable (${reason}${
        status !== undefined ? ` ${status}` : ''
      })`,
    );
    this.name = 'AiProviderUnavailableError';
  }
}

export abstract class AiProvider {
  abstract decide(request: AiProviderRequest): ModelDecision;

  abstract complete(
    request: AiProviderRequest,
    tier: AiTier,
  ): Promise<AiProviderResult>;

  abstract stream(
    request: AiProviderRequest,
    tier: AiTier,
    onToken: (token: string) => void,
  ): Promise<AiProviderResult>;

  abstract canEscalate(): boolean;
}
