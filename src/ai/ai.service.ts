import { Injectable } from '@nestjs/common';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

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

const PLAN_REVIEW_TIMEOUT_MS = 45000;
const ACTIVITY_MATCH_TIMEOUT_MS = 20000;

@Injectable()
export class AiService {
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
    const llm = new ChatOpenAI({
      model: 'gpt-4o-mini',
      temperature: 0,
    });

    const systemMsg = new SystemMessage(
      "You're an experienced running coach, so you need to analyze user data and provide your feedback on it.",
    );
    const humanMsg = new HumanMessage(data);

    const messages = [systemMsg, humanMsg];

    const insight = await llm.invoke(messages);

    return insight.content as string;
  }

  async generatePlanReview(context: string): Promise<PlanReview | null> {
    if (!process.env.OPENAI_API_KEY) return null;

    const llm = new ChatOpenAI({
      model: 'gpt-4o-mini',
      temperature: 0.2,
    });

    const systemMsg = new SystemMessage(
      `Você é o Veltra Coach, treinador de corrida experiente. Analise o plano gerado e os dados reais do atleta.
Responda SOMENTE com JSON válido, sem markdown, no formato:
{"overview":"...","weeks":[{"weekStart":"YYYY-MM-DD","focus":"...","rationale":"...","tips":[{"dia":"Seg","dica":"..."}]}]}
Regras: português do Brasil; "overview" com 2-3 frases resumindo a estratégia; "focus" com no máximo 8 palavras; "rationale" com 2-3 frases citando os dados do atleta (volume, longão, paces); se houver "tempoAlvo" nos dados, comente na "rationale" da primeira semana se a meta é conservadora, realista, agressiva ou improvável, citando o tempo projetado; se houver "historicoDoAtleta", use-o para citar a rotina real (dias de qualidade, longão, tipos de treino e paces que o atleta costuma fazer) e explique como o plano se aproxima dela; seja crítico e realista: se o volume ou a intensidade subirem rápido demais para o histórico, avise, e se houver "ajusteAplicado" comente o motivo; "tips" com uma dica prática para cada dia listado, usando exatamente a mesma abreviação de "dia" (Dom, Seg, Ter, Qua, Qui, Sex, Sáb), com no máximo 140 caracteres cada. Use exatamente os mesmos weekStart das semanas fornecidas.`,
    );
    const humanMsg = new HumanMessage(context);

    try {
      const response = await Promise.race([
        llm.invoke([systemMsg, humanMsg]),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Timeout ao gerar análise do plano')),
            PLAN_REVIEW_TIMEOUT_MS,
          ),
        ),
      ]);

      const text =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);

      return this.parsePlanReview(text);
    } catch (err) {
      console.error(
        'Erro ao gerar análise do plano com IA:',
        (err as Error).message,
      );
      return null;
    }
  }

  async classifyActivityMatch(
    context: string,
  ): Promise<{ sessionId: string; reason?: string } | null> {
    if (!process.env.OPENAI_API_KEY) return null;

    const llm = new ChatOpenAI({
      model: 'gpt-4o-mini',
      temperature: 0,
    });

    const systemMsg = new SystemMessage(
      `Você é o Veltra Coach. Dada uma atividade realizada e candidatos de treino planejado, decida qual treino a atividade representa.
Responda SOMENTE com JSON válido, sem markdown, no formato:
{"sessionId":"<id do candidato ou null>","confidence":0.0,"reason":"..."}
Regras: escolha apenas ids presentes em "candidatos"; prefira o candidato com maior "score", só escolhendo outro com motivo claro; se nenhum candidato corresponder claramente, retorne "sessionId": null; "reason" com no máximo 120 caracteres em português do Brasil. Leve em conta formato do treino (intervalado, longão, tempo, leve), distância, pace, dia e nome da atividade.`,
    );
    const humanMsg = new HumanMessage(context);

    try {
      const response = await Promise.race([
        llm.invoke([systemMsg, humanMsg]),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Timeout ao classificar atividade')),
            ACTIVITY_MATCH_TIMEOUT_MS,
          ),
        ),
      ]);

      const text =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);

      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start < 0 || end <= start) return null;

      const parsed = JSON.parse(text.slice(start, end + 1)) as {
        sessionId?: unknown;
        reason?: unknown;
      };

      if (typeof parsed.sessionId !== 'string') return null;

      return {
        sessionId: parsed.sessionId,
        reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
      };
    } catch (err) {
      console.error(
        'Erro ao classificar atividade com IA:',
        (err as Error).message,
      );
      return null;
    }
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
