import { Injectable } from '@nestjs/common';
import { OpenAIEmbeddings } from '@langchain/openai';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import {
  AiModelRouter,
  type AiTask,
  type ModelDecision,
  type RoutingSignals,
} from './model-router';

export interface PlanTip {
  day?: string;
  text: string;
}

export interface PlanWeekReview {
  weekStart: string;
  focus: string;
  rationale: string;
  tips: PlanTip[];
}

export interface PlanReview {
  overview: string;
  weeks: PlanWeekReview[];
}

export interface ActivityInsightContent {
  summary: string;
  performance: string;
  workoutType: string;
  plan: string | null;
  tips: string[];
}

export interface CoachProposal {
  session: number;
  changes: {
    type?: string;
    plannedDistance?: number;
    plannedPace?: number;
    day?: string;
    notes?: string;
  };
  reason: string;
}

export interface CoachReplyResult {
  text: string;
  proposal: CoachProposal | null;
  proposals: CoachProposal[];
  malformed: boolean;
}

export const MAX_COACH_PROPOSALS = 5;

const PLAN_REVIEW_TIMEOUT_MS = 45000;
const ACTIVITY_MATCH_TIMEOUT_MS = 20000;
const ACTIVITY_INSIGHT_TIMEOUT_MS = 30000;
const COACH_REPLY_TIMEOUT_MS = 60000;

const PROPOSAL_PATTERN = /<proposta>([\s\S]*?)<\/proposta>/i;

function sanitizeChanges(raw: unknown): CoachProposal['changes'] {
  const changes: CoachProposal['changes'] = {};
  if (!raw || typeof raw !== 'object') return changes;

  const record = raw as Record<string, unknown>;

  if (typeof record.type === 'string') changes.type = record.type;
  if (typeof record.plannedDistance === 'number') {
    changes.plannedDistance = record.plannedDistance;
  }
  if (typeof record.plannedPace === 'number') {
    changes.plannedPace = record.plannedPace;
  }
  if (typeof record.day === 'string') changes.day = record.day;
  if (typeof record.notes === 'string') changes.notes = record.notes;

  return changes;
}

function parseProposalItem(raw: unknown): CoachProposal | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = raw as {
    session?: unknown;
    changes?: unknown;
    reason?: unknown;
  };
  if (typeof parsed.session !== 'number' || !Number.isFinite(parsed.session)) {
    return null;
  }
  return {
    session: parsed.session,
    changes: sanitizeChanges(parsed.changes),
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
  };
}

function cleanProposalBlock(block: string): string {
  // O modelo às vezes envolve o JSON em code fence ou deixa trailing comma.
  return block
    .replace(/```(?:json)?/gi, '')
    .replace(/,(\s*[}\]])/g, '$1')
    .trim();
}

function parseProposalBlock(block: string): {
  proposals: CoachProposal[];
  malformed: boolean;
} {
  let raw: unknown;
  try {
    raw = JSON.parse(cleanProposalBlock(block));
  } catch {
    console.warn(
      'Bloco de proposta inválido do coach:',
      block.trim().slice(0, 300),
    );
    return { proposals: [], malformed: true };
  }

  const items = Array.isArray(raw) ? raw : [raw];
  const proposals: CoachProposal[] = [];
  let malformed = false;

  for (const item of items.slice(0, MAX_COACH_PROPOSALS)) {
    const parsed = parseProposalItem(item);
    if (parsed) {
      proposals.push(parsed);
    } else {
      malformed = true;
    }
  }

  if (Array.isArray(raw) && raw.length > MAX_COACH_PROPOSALS) {
    malformed = true;
  }

  if (proposals.length === 0 && malformed) {
    console.warn(
      'Bloco de proposta sem sessão numérica:',
      block.trim().slice(0, 300),
    );
  }

  return { proposals, malformed };
}

export function splitCoachReply(text: string): CoachReplyResult {
  const match = text.match(PROPOSAL_PATTERN);
  if (!match)
    return {
      text: text.trim(),
      proposal: null,
      proposals: [],
      malformed: false,
    };

  const cleaned = text.replace(PROPOSAL_PATTERN, '').trim();
  const { proposals, malformed } = parseProposalBlock(match[1]);

  return {
    text: cleaned,
    proposal: proposals[0] ?? null,
    proposals,
    malformed,
  };
}

export function parseActivityInsight(
  text: string,
): ActivityInsightContent | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      summary?: unknown;
      performance?: unknown;
      workoutType?: unknown;
      plan?: unknown;
      tips?: unknown;
    };

    if (typeof parsed.summary !== 'string') return null;
    if (typeof parsed.performance !== 'string') return null;
    if (typeof parsed.workoutType !== 'string') return null;

    const tips = Array.isArray(parsed.tips)
      ? parsed.tips
          .filter((tip): tip is string => typeof tip === 'string')
          .map((tip) => tip.trim())
          .filter((tip) => tip.length > 0)
          .slice(0, 6)
      : [];

    return {
      summary: parsed.summary,
      performance: parsed.performance,
      workoutType: parsed.workoutType,
      plan: typeof parsed.plan === 'string' ? parsed.plan : null,
      tips,
    };
  } catch {
    return null;
  }
}

@Injectable()
export class AiService {
  constructor(private readonly modelRouter: AiModelRouter) {}

  createEmbedding(text: string) {
    const cleanSpaces = text.replace(/\s+/g, ' ').trim();

    const embeddings = new OpenAIEmbeddings({
      apiKey: process.env.OPENAI_API_KEY,
      model: 'text-embedding-3-small',
    });

    const vector = embeddings.embedQuery(cleanSpaces);

    return vector;
  }

  async generateInsight(data: string) {
    const systemMsg = new SystemMessage(
      "You're an experienced running coach, so you need to analyze user data and provide your feedback on it.",
    );
    const humanMsg = new HumanMessage(data);

    const messages = [systemMsg, humanMsg];
    const { text } = await this.invokeRouted('generic', 0, messages);

    return text;
  }

  async generateCoachReplyStream(
    systemPrompt: string,
    history: { role: 'user' | 'coach'; content: string }[],
    userMessage: string,
    onToken: (token: string) => void,
  ): Promise<CoachReplyResult | null> {
    if (!process.env.OPENAI_API_KEY) return null;

    const signals: RoutingSignals = {
      task: 'coach_reply',
      text: userMessage,
      contextLength: systemPrompt.length,
      historyLength: history.length,
      wantsPlanChange: this.modelRouter.hasPlanChangeIntent(userMessage),
      hasHealthSignal: this.modelRouter.hasHealthSignal(userMessage),
    };

    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      ...history.map((message) =>
        message.role === 'user'
          ? new HumanMessage(message.content)
          : new AIMessage(message.content),
      ),
      new HumanMessage(userMessage),
    ];

    const { runnable, decision } = this.modelRouter.buildRoutedRunnable(
      signals,
      0.3,
    );

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      COACH_REPLY_TIMEOUT_MS,
    );

    let full = '';
    let usage: unknown;

    try {
      const stream = await runnable.stream(
        { signals, messages },
        { signal: controller.signal },
      );

      for await (const chunk of stream) {
        const token = typeof chunk.content === 'string' ? chunk.content : '';
        if (chunk.usage_metadata) usage = chunk.usage_metadata;
        if (!token) continue;
        full += token;
        onToken(token);
      }

      this.logUsage('coach_reply', decision, usage);
      return splitCoachReply(full);
    } catch (err) {
      console.error('Erro ao gerar resposta do coach:', (err as Error).message);

      if (
        !full.trim() &&
        decision.tier === 'cheap' &&
        this.modelRouter.escalationEnabled()
      ) {
        const retry = await this.streamPremiumFallback(messages, onToken);
        if (retry !== null) return retry;
      }

      return full.trim() ? splitCoachReply(full) : null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async streamPremiumFallback(
    messages: BaseMessage[],
    onToken: (token: string) => void,
  ): Promise<CoachReplyResult | null> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      COACH_REPLY_TIMEOUT_MS,
    );

    let full = '';

    try {
      const llm = this.modelRouter.createModel('premium', 'coach_reply', 0.3);
      const stream = await llm.stream(messages, {
        signal: controller.signal,
      });

      for await (const chunk of stream) {
        const token = typeof chunk.content === 'string' ? chunk.content : '';
        if (!token) continue;
        full += token;
        onToken(token);
      }

      console.info('[ai] task=coach_reply tier=premium reason=fallback');
      return splitCoachReply(full);
    } catch (err) {
      console.error(
        'Erro ao gerar resposta do coach (fallback premium):',
        (err as Error).message,
      );
      return full.trim() ? splitCoachReply(full) : null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async generateActivityInsight(
    context: string,
  ): Promise<ActivityInsightContent | null> {
    if (!process.env.OPENAI_API_KEY) return null;

    const systemMsg = new SystemMessage(
      `Você é o Veltra Coach, treinador de corrida experiente. Analise a corrida realizada pelo atleta usando os dados fornecidos.
Responda SOMENTE com JSON válido, sem markdown, no formato:
{"summary":"...","performance":"...","workoutType":"...","plan":"..." ou null,"tips":["..."]}
Regras: português do Brasil; "summary" com 2 frases resumindo a corrida; "performance" com 2-3 frases sobre pace, distância e esforço (cite frequência cardíaca, cadência ou elevação quando existirem), comparando com o perfil recente do atleta quando disponível; "workoutType" com 1-2 frases explicando o tipo de treino executado (intervalado, tempo run, fartlek, longão ou leve) e sua função no treinamento; "plan" com 2-3 frases avaliando o cumprimento do treino planejado e a aderência informada, ou null se não houver treino planejado vinculado; "tips" com 2 a 4 dicas curtas e práticas para as próximas corridas, cada uma com no máximo 160 caracteres. Seja honesto e construtivo, aponte o que melhorar com cautela e não invente dados que não estão no contexto. Nunca faça diagnóstico médico; se houver faixa etária ou alertas de saúde no contexto, seja cauteloso e recomende acompanhamento profissional quando fizer sentido.`,
    );
    const humanMsg = new HumanMessage(context);

    const result = await this.invokeParsed(
      'activity_insight',
      0.3,
      {
        contextLength: context.length,
        hasHealthSignal: this.modelRouter.hasHealthSignal(context),
      },
      [systemMsg, humanMsg],
      parseActivityInsight,
      ACTIVITY_INSIGHT_TIMEOUT_MS,
      'Timeout ao gerar insight da corrida',
      'Erro ao gerar insight da corrida com IA',
    );

    return result;
  }

  async generatePlanReview(context: string): Promise<PlanReview | null> {
    if (!process.env.OPENAI_API_KEY) return null;

    const systemMsg = new SystemMessage(
      `Você é o Veltra Coach, treinador de corrida experiente. Analise o plano gerado e os dados reais do atleta.
Responda SOMENTE com JSON válido, sem markdown, no formato:
{"overview":"...","weeks":[{"weekStart":"YYYY-MM-DD","focus":"...","rationale":"...","tips":[{"dia":"Seg","dica":"..."}]}]}
Regras: português do Brasil; "overview" com 2-3 frases resumindo a estratégia; "focus" com no máximo 8 palavras; "rationale" com 2-3 frases citando os dados do atleta (volume, longão, paces); se houver "tempoAlvo" nos dados, comente na "rationale" da primeira semana se a meta é conservadora, realista, agressiva ou improvável, citando o tempo projetado; se houver "historicoDoAtleta", use-o para citar a rotina real (dias de qualidade, longão, tipos de treino e paces que o atleta costuma fazer) e explique como o plano se aproxima dela; seja crítico e realista: se o volume ou a intensidade subirem rápido demais para o histórico, avise, e se houver "ajusteAplicado" comente o motivo; se houver "idade" e "limitePorIdade" nos dados, respeite e explique os limites de segurança; se houver "ultimas3Semanas" e "teste3Km", cite que o plano foi calibrado por eles (e por "baseDoPlano"), sem inventar dados; nunca faça diagnóstico médico; "tips" com uma dica prática para cada dia listado, usando exatamente a mesma abreviação de "dia" (Dom, Seg, Ter, Qua, Qui, Sex, Sáb), com no máximo 140 caracteres cada. Use exatamente os mesmos weekStart das semanas fornecidas.`,
    );
    const humanMsg = new HumanMessage(context);

    return this.invokeParsed(
      'plan_review',
      0.2,
      {
        contextLength: context.length,
        hasHealthSignal: this.modelRouter.hasHealthSignal(context),
      },
      [systemMsg, humanMsg],
      (text) => this.parsePlanReview(text),
      PLAN_REVIEW_TIMEOUT_MS,
      'Timeout ao gerar análise do plano',
      'Erro ao gerar análise do plano com IA',
    );
  }

  async classifyActivityMatch(
    context: string,
  ): Promise<{ sessionId: string; reason?: string } | null> {
    if (!process.env.OPENAI_API_KEY) return null;

    const systemMsg = new SystemMessage(
      `Você é o Veltra Coach. Dada uma atividade realizada e candidatos de treino planejado, decida qual treino a atividade representa.
Responda SOMENTE com JSON válido, sem markdown, no formato:
{"sessionId":"<id do candidato ou null>","confidence":0.0,"reason":"..."}
Regras: escolha apenas ids presentes em "candidatos"; prefira o candidato com maior "score", só escolhendo outro com motivo claro; se nenhum candidato corresponder claramente, retorne "sessionId": null; "reason" com no máximo 120 caracteres em português do Brasil. Leve em conta formato do treino (intervalado, longão, tempo, leve), distância, pace, dia e nome da atividade.`,
    );
    const humanMsg = new HumanMessage(context);

    return this.invokeParsed(
      'activity_match',
      0,
      { contextLength: context.length },
      [systemMsg, humanMsg],
      (text) => this.parseActivityMatch(text),
      ACTIVITY_MATCH_TIMEOUT_MS,
      'Timeout ao classificar atividade',
      'Erro ao classificar atividade com IA',
    );
  }

  private parseActivityMatch(
    text: string,
  ): { sessionId: string; reason?: string } | null {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;

    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as {
        sessionId?: unknown;
        reason?: unknown;
      };

      if (typeof parsed.sessionId !== 'string') return null;

      return {
        sessionId: parsed.sessionId,
        reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
      };
    } catch {
      return null;
    }
  }

  private async invokeRouted(
    task: AiTask,
    temperature: number,
    messages: BaseMessage[],
  ): Promise<{ text: string; decision: ModelDecision }> {
    const signals: RoutingSignals = { task };
    const { runnable, decision } = this.modelRouter.buildRoutedRunnable(
      signals,
      temperature,
    );

    const response = await runnable.invoke({ signals, messages });
    this.logUsage(task, decision, response.usage_metadata);

    return { text: this.messageText(response), decision };
  }

  private async invokeParsed<T>(
    task: AiTask,
    temperature: number,
    signals: Omit<RoutingSignals, 'task'>,
    messages: BaseMessage[],
    parse: (text: string) => T | null,
    timeoutMs: number,
    timeoutMessage: string,
    errorMessage: string,
  ): Promise<T | null> {
    const routingSignals: RoutingSignals = { task, ...signals };
    const { runnable, decision } = this.modelRouter.buildRoutedRunnable(
      routingSignals,
      temperature,
    );

    try {
      const response = await this.withTimeout(
        runnable.invoke({ signals: routingSignals, messages }),
        timeoutMs,
        timeoutMessage,
      );

      this.logUsage(task, decision, response.usage_metadata);
      const parsed = parse(this.messageText(response));
      if (parsed !== null) return parsed;

      if (decision.tier !== 'cheap' || !this.modelRouter.escalationEnabled()) {
        return null;
      }

      console.info(`[ai] task=${task} tier=premium reason=parse_escalation`);
      const premium = this.modelRouter.createModel(
        'premium',
        task,
        temperature,
      );
      const retry = await this.withTimeout(
        premium.invoke(messages),
        timeoutMs,
        timeoutMessage,
      );

      this.logUsage(
        task,
        {
          tier: 'premium',
          model: this.modelRouter.modelName('premium'),
          reason: 'parse_escalation',
        },
        retry.usage_metadata,
      );

      return parse(this.messageText(retry));
    } catch (err) {
      console.error(`${errorMessage}:`, (err as Error).message);
      return null;
    }
  }

  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    if (timeoutMs <= 0) return promise;

    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(message)), timeoutMs),
      ),
    ]);
  }

  private messageText(response: { content: unknown }): string {
    return typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
  }

  private logUsage(
    task: AiTask,
    decision: ModelDecision,
    usage: unknown,
  ): void {
    if (!usage) return;
    console.info(
      `[ai] task=${task} tier=${decision.tier} model=${decision.model} usage=${JSON.stringify(usage)}`,
    );
  }

  private parsePlanReview(text: string): PlanReview | null {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;

    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as {
        overview?: unknown;
        weeks?: unknown;
      };

      if (typeof parsed.overview !== 'string') return null;
      if (!Array.isArray(parsed.weeks)) return null;

      const weeks: PlanWeekReview[] = parsed.weeks
        .filter(
          (week): week is Record<string, unknown> =>
            !!week &&
            typeof week === 'object' &&
            typeof (week as Record<string, unknown>).weekStart === 'string' &&
            typeof (week as Record<string, unknown>).focus === 'string' &&
            typeof (week as Record<string, unknown>).rationale === 'string',
        )
        .map((week) => ({
          weekStart: week.weekStart as string,
          focus: week.focus as string,
          rationale: week.rationale as string,
          tips: this.parseTips(week.tips),
        }));

      if (weeks.length === 0) return null;

      return { overview: parsed.overview, weeks };
    } catch {
      return null;
    }
  }

  private parseTips(raw: unknown): PlanTip[] {
    if (!Array.isArray(raw)) return [];

    const tips: PlanTip[] = [];

    for (const item of raw) {
      if (typeof item === 'string') {
        tips.push({ text: item });
        continue;
      }

      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        const text = record.dica ?? record.tip ?? record.text;
        const day = record.dia ?? record.day;
        if (typeof text === 'string') {
          tips.push({
            day: typeof day === 'string' ? day : undefined,
            text,
          });
        }
      }
    }

    return tips;
  }
}
