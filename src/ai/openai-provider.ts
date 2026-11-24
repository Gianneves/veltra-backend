import { Injectable } from '@nestjs/common';
import { OpenAIEmbeddings } from '@langchain/openai';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import {
  AiProvider,
  AiProviderUnavailableError,
  type AiProviderMessage,
  type AiProviderRequest,
  type AiProviderResult,
} from './ai-provider';
import { AiModelRouter, type AiTier, type ModelDecision } from './model-router';

const PROVIDER_NAME = 'openai';

function toMessages(messages: AiProviderMessage[]): BaseMessage[] {
  return messages.map((message) => {
    if (message.role === 'system') return new SystemMessage(message.content);
    if (message.role === 'assistant') return new AIMessage(message.content);
    return new HumanMessage(message.content);
  });
}

function messageText(response: { content: unknown }): string {
  return typeof response.content === 'string'
    ? response.content
    : JSON.stringify(response.content);
}

@Injectable()
export class OpenAiProvider extends AiProvider {
  constructor(private readonly modelRouter: AiModelRouter) {
    super();
  }

  decide(request: AiProviderRequest): ModelDecision {
    const decision = this.modelRouter.decide(request.routing);
    console.info(
      `[ai] task=${request.task} tier=${decision.tier} model=${decision.model} reason=${decision.reason}`,
    );
    return decision;
  }

  canEscalate(): boolean {
    return this.modelRouter.escalationEnabled();
  }

  async complete(
    request: AiProviderRequest,
    tier: AiTier,
  ): Promise<AiProviderResult> {
    return this.execute(request, async (signal) => {
      const model = this.createModel(request, tier);
      const response = await model.invoke(toMessages(request.messages), {
        signal,
      });

      return {
        text: messageText(response),
        decision: this.decision(request, tier),
        usage: response.usage_metadata,
      };
    });
  }

  async stream(
    request: AiProviderRequest,
    tier: AiTier,
    onToken: (token: string) => void,
  ): Promise<AiProviderResult> {
    return this.execute(request, async (signal) => {
      const model = this.createModel(request, tier);
      const stream = await model.stream(toMessages(request.messages), {
        signal,
      });

      let text = '';
      let usage: unknown;

      for await (const chunk of stream) {
        if (chunk.usage_metadata) usage = chunk.usage_metadata;
        const token = typeof chunk.content === 'string' ? chunk.content : '';
        if (!token) continue;
        text += token;
        onToken(token);
      }

      return { text, decision: this.decision(request, tier), usage };
    });
  }

  createEmbedding(text: string): Promise<number[]> {
    const cleanSpaces = text.replace(/\s+/g, ' ').trim();

    const embeddings = new OpenAIEmbeddings({
      apiKey: process.env.OPENAI_API_KEY,
      model: 'text-embedding-3-small',
    });

    return embeddings.embedQuery(cleanSpaces);
  }

  private createModel(request: AiProviderRequest, tier: AiTier) {
    return this.modelRouter.createModel(
      tier,
      request.task,
      request.temperature,
      request.maxTokens,
    );
  }

  private decision(request: AiProviderRequest, tier: AiTier): ModelDecision {
    const decided = this.modelRouter.decide(request.routing);
    if (decided.tier === tier) return decided;
    return {
      tier,
      model: this.modelRouter.modelName(tier),
      reason: 'escalation',
    };
  }

  private async execute<T>(
    request: AiProviderRequest,
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = this.startTimeout(request.timeoutMs, controller);

    try {
      return await run(controller.signal);
    } catch (err) {
      throw this.unavailable(err, timeout.timedOut());
    } finally {
      timeout.clear();
    }
  }

  private startTimeout(
    timeoutMs: number,
    controller: AbortController,
  ): { clear: () => void; timedOut: () => boolean } {
    if (timeoutMs <= 0) {
      return { clear: () => undefined, timedOut: () => false };
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    return {
      clear: () => clearTimeout(timer),
      timedOut: () => timedOut,
    };
  }

  private unavailable(
    err: unknown,
    timedOut: boolean,
  ): AiProviderUnavailableError {
    if (err instanceof AiProviderUnavailableError) return err;
    if (timedOut) {
      return new AiProviderUnavailableError(
        PROVIDER_NAME,
        'timeout',
        undefined,
        err,
      );
    }

    const status = this.statusOf(err);
    if (status !== undefined) {
      return new AiProviderUnavailableError(PROVIDER_NAME, 'http', status, err);
    }

    return new AiProviderUnavailableError(
      PROVIDER_NAME,
      'transport',
      undefined,
      err,
    );
  }

  private statusOf(err: unknown): number | undefined {
    if (!err || typeof err !== 'object') return undefined;
    const record = err as {
      status?: unknown;
      statusCode?: unknown;
      response?: { status?: unknown };
    };
    const status =
      record.status ?? record.statusCode ?? record.response?.status;
    return typeof status === 'number' ? status : undefined;
  }
}
