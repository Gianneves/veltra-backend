import { Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import {
  AiProvider,
  type AiProviderName,
  type AiProviderRequest,
  type AiProviderResult,
} from './ai-provider';
import type { AiTier, ModelDecision } from './model-router';
import {
  messageText,
  runProviderCall,
  toProviderMessages,
} from './provider-runtime';

const PROVIDER_NAME: AiProviderName = 'deepseek';
const BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';

@Injectable()
export class DeepSeekProvider extends AiProvider {
  decide(): ModelDecision {
    return {
      tier: 'cheap',
      model: this.modelName(),
      reason: 'fallback_single_model',
    };
  }

  canEscalate(): boolean {
    return false;
  }

  isConfigured(): boolean {
    return !!process.env.DEEPSEEK_API_KEY?.trim();
  }

  async complete(
    request: AiProviderRequest,
    tier: AiTier,
  ): Promise<AiProviderResult> {
    return runProviderCall(PROVIDER_NAME, request.timeoutMs, async (signal) => {
      const model = this.createModel(request);
      const response = await model.invoke(
        toProviderMessages(request.messages),
        { signal },
      );

      return {
        text: messageText(response),
        decision: this.decision(tier),
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
      const model = this.createModel(request);
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
        decision: this.decision(tier),
        usage,
        provider: PROVIDER_NAME,
      };
    });
  }

  private createModel(request: AiProviderRequest): ChatOpenAI {
    return new ChatOpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: this.modelName(),
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      streamUsage: false,
      configuration: { baseURL: BASE_URL },
    });
  }

  private modelName(): string {
    const name = process.env.DEEPSEEK_MODEL?.trim();
    return name && name.length > 0 ? name : DEFAULT_MODEL;
  }

  private decision(tier: AiTier): ModelDecision {
    return {
      tier,
      model: this.modelName(),
      reason: 'fallback_single_model',
    };
  }
}
