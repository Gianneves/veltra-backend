import { Injectable } from '@nestjs/common';
import { OpenAIEmbeddings } from '@langchain/openai';
import {
  AiProvider,
  type AiProviderName,
  type AiProviderRequest,
  type AiProviderResult,
} from './ai-provider';
import { AiModelRouter, type AiTier, type ModelDecision } from './model-router';
import {
  messageText,
  runProviderCall,
  toProviderMessages,
} from './provider-runtime';

const PROVIDER_NAME: AiProviderName = 'openai';

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

  canEscalate(provider: AiProviderName): boolean {
    return provider === PROVIDER_NAME && this.modelRouter.escalationEnabled();
  }

  isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY?.trim();
  }

  async complete(
    request: AiProviderRequest,
    tier: AiTier,
  ): Promise<AiProviderResult> {
    return runProviderCall(PROVIDER_NAME, request.timeoutMs, async (signal) => {
      const model = this.createModel(request, tier);
      const response = await model.invoke(
        toProviderMessages(request.messages),
        { signal },
      );

      return {
        text: messageText(response),
        decision: this.decision(request, tier),
        usage: response.usage_metadata,
        provider: PROVIDER_NAME,
      };
    });
  }

  async stream(
    request: AiProviderRequest,
    tier: AiTier,
    onToken: (token: string) => void,
  ): Promise<AiProviderResult> {
    return runProviderCall(PROVIDER_NAME, request.timeoutMs, async (signal) => {
      const model = this.createModel(request, tier);
      const stream = await model.stream(toProviderMessages(request.messages), {
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

      return {
        text,
        decision: this.decision(request, tier),
        usage,
        provider: PROVIDER_NAME,
      };
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
}
