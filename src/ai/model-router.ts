import { Injectable } from '@nestjs/common';
import type { BaseMessage } from '@langchain/core/messages';
import type { AIMessageChunk } from '@langchain/core/messages';
import {
  RunnableBranch,
  RunnableLambda,
  type Runnable,
} from '@langchain/core/runnables';
import { ChatOpenAI } from '@langchain/openai';

export type AiTier = 'cheap' | 'premium';

export type AiTask =
  | 'activity_match'
  | 'activity_insight'
  | 'plan_review'
  | 'coach_reply'
  | 'generic';

export type RoutingMode = 'auto' | 'cheap' | 'premium';

export interface RoutingSignals {
  task: AiTask;
  text?: string;
  contextLength?: number;
  historyLength?: number;
  hasHealthSignal?: boolean;
  wantsPlanChange?: boolean;
}

export interface ModelDecision {
  tier: AiTier;
  model: string;
  reason: string;
}

export interface RoutedChatInput {
  signals: RoutingSignals;
  messages: BaseMessage[];
}

export interface RoutedRunnable {
  runnable: Runnable<RoutedChatInput, AIMessageChunk>;
  decision: ModelDecision;
}

const DEFAULT_CHEAP_MODEL = 'gpt-4o-mini';
const DEFAULT_PREMIUM_MODEL = 'gpt-4o';

const LONG_COACH_CONTEXT_CHARS = 8000;
const LONG_INSIGHT_CONTEXT_CHARS = 6000;
const LONG_COACH_HISTORY = 12;

const PLAN_CHANGE_PATTERN =
  /\b(mudar|muda|ajust\w*|trocar|troca|reduz\w*|aument\w*|remarc\w*|invert\w*|desativ\w*|ativar|transform\w*|adicion\w*|remov\w*|tirar|tira|colocar|coloca|passar|passa|mover|move)\b/i;

const HEALTH_SIGNAL_PATTERN =
  /\b(dor|dores|les[ãa]o|les[õo]es|machuc\w*|lesion\w*|sintoma\w*|sa[úu]de|alerta\w*|card[íi]ac\w*|desmaio|press[ãa]o|falta de ar)\b/i;

const MAX_TOKENS_BY_TASK: Record<AiTask, number> = {
  activity_match: 300,
  activity_insight: 900,
  plan_review: 2000,
  coach_reply: 1400,
  generic: 700,
};

@Injectable()
export class AiModelRouter {
  routingMode(): RoutingMode {
    const raw = process.env.OPENAI_MODEL_ROUTING?.trim().toLowerCase();
    if (raw === 'cheap' || raw === 'premium') return raw;
    return 'auto';
  }

  escalationEnabled(): boolean {
    return (
      process.env.OPENAI_MODEL_ESCALATION?.trim().toLowerCase() !== 'false'
    );
  }

  decide(signals: RoutingSignals): ModelDecision {
    const mode = this.routingMode();

    if (mode === 'cheap') {
      return this.decision('cheap', 'routing_forced_cheap');
    }
    if (mode === 'premium') {
      return this.decision('premium', 'routing_forced_premium');
    }

    const hasHealthSignal =
      signals.hasHealthSignal ??
      (signals.text ? this.hasHealthSignal(signals.text) : false);
    const wantsPlanChange =
      signals.wantsPlanChange ??
      (signals.text ? this.hasPlanChangeIntent(signals.text) : false);

    if (signals.task === 'activity_match') {
      return this.decision('cheap', 'structured_low_complexity');
    }

    if (signals.task === 'generic') {
      return this.decision('cheap', 'generic_prompt');
    }

    if (signals.task === 'activity_insight') {
      if (hasHealthSignal) {
        return this.decision('premium', 'health_context');
      }
      if ((signals.contextLength ?? 0) > LONG_INSIGHT_CONTEXT_CHARS) {
        return this.decision('premium', 'long_context');
      }
      return this.decision('cheap', 'standard_insight');
    }

    if (signals.task === 'plan_review') {
      return this.decision('premium', 'multi_week_plan_analysis');
    }

    if (hasHealthSignal) {
      return this.decision('premium', 'health_context');
    }
    if (wantsPlanChange) {
      return this.decision('premium', 'plan_negotiation');
    }
    if (
      (signals.contextLength ?? 0) > LONG_COACH_CONTEXT_CHARS ||
      (signals.historyLength ?? 0) > LONG_COACH_HISTORY
    ) {
      return this.decision('premium', 'long_context');
    }
    return this.decision('cheap', 'simple_chat');
  }

  buildRoutedRunnable(
    signals: RoutingSignals,
    temperature: number,
  ): RoutedRunnable {
    const decision = this.decide(signals);

    const cheapModel = this.createModel('cheap', signals.task, temperature);
    const premiumModel = this.createModel('premium', signals.task, temperature);

    const toMessages = RunnableLambda.from(
      (input: RoutedChatInput) => input.messages,
    );

    const branch = RunnableBranch.from<RoutedChatInput, AIMessageChunk>([
      [
        (input: RoutedChatInput) =>
          this.decide(input.signals).tier === 'premium',
        toMessages.pipe(premiumModel),
      ],
      toMessages.pipe(cheapModel),
    ]);

    const runnable = RunnableLambda.from((input: RoutedChatInput) => input)
      .pipe(branch)
      .withConfig({ runName: `ai-${signals.task}-${decision.tier}` });

    console.info(
      `[ai] task=${signals.task} tier=${decision.tier} model=${decision.model} reason=${decision.reason}`,
    );

    return { runnable, decision };
  }

  createModel(tier: AiTier, task: AiTask, temperature: number): ChatOpenAI {
    return new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      model: this.modelName(tier),
      temperature,
      maxTokens: MAX_TOKENS_BY_TASK[task],
    });
  }

  modelName(tier: AiTier): string {
    const fallback =
      tier === 'premium' ? DEFAULT_PREMIUM_MODEL : DEFAULT_CHEAP_MODEL;
    const envName =
      tier === 'premium'
        ? process.env.OPENAI_MODEL_PREMIUM
        : process.env.OPENAI_MODEL_CHEAP;
    const name = envName?.trim();
    return name && name.length > 0 ? name : fallback;
  }

  hasPlanChangeIntent(text: string): boolean {
    return PLAN_CHANGE_PATTERN.test(text);
  }

  hasHealthSignal(text: string): boolean {
    return HEALTH_SIGNAL_PATTERN.test(text);
  }

  private decision(tier: AiTier, reason: string): ModelDecision {
    return { tier, model: this.modelName(tier), reason };
  }
}
