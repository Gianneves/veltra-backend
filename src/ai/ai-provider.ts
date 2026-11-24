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

export type AiProviderName = 'openai' | 'deepseek';

export interface AiProviderResult {
  text: string;
  decision: ModelDecision;
  usage: unknown;
  provider: AiProviderName;
}

export type AiProviderFailureReason =
  | 'http'
  | 'transport'
  | 'timeout'
  | 'empty';

export class AiProviderUnavailableError extends Error {
  constructor(
    readonly provider: AiProviderName,
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

  abstract canEscalate(provider: AiProviderName): boolean;

  abstract isConfigured(): boolean;
}
