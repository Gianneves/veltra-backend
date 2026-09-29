import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsOrder, In, MoreThanOrEqual, Repository } from 'typeorm';
import { Activity } from 'src/activities/entities/activity.entity';
import { AiService, type CoachProposal } from 'src/ai/ai.service';
import { Goal } from 'src/goals/entities/goal.entity';
import { assessDistanceForAge, planAgeAdjustment } from 'src/health/age-policy';
import { HealthAlertsService } from 'src/health/health-alerts.service';
import { assessAdherence, type AdherenceVerdict } from 'src/insights/adherence';
import {
  AthleteProfileService,
  type AthleteProfile,
} from 'src/training-plans/athlete-profile.service';
import {
  TRAINING_SESSION_DAYS,
  TRAINING_SESSION_TYPES,
} from 'src/training-plans/dto/update-training-session.dto';
import { TrainingPlan } from 'src/training-plans/entities/training-plan.entity';
import { TrainingSession } from 'src/training-plans/entities/training-session.entity';
import { CoachConversation } from './entities/coach-conversation.entity';
import { CoachMessage } from './entities/coach-message.entity';

export interface ValidatedProposal extends CoachProposal {
  sessionId: string;
  planId: string;
  before: {
    day: string;
    type: string;
    plannedDistance: number;
    plannedPace: number;
  };
}

export type ProposalRejectionCode =
  | 'INVALID_SESSION'
  | 'PAST_OR_REST'
  | 'OUT_OF_RANGE'
  | 'AGE_CAP'
  | 'EMPTY_CHANGES'
  | 'MALFORMED'
  | 'DAY_COLLISION';

export interface ProposalRejection {
  session: number | null;
  code: ProposalRejectionCode;
  message: string;
}

export interface CoachReply {
  conversationId: string;
  message: {
    id: string;
    role: 'coach';
    content: string;
    timestamp: string | undefined;
  };
  proposal: ValidatedProposal | null;
  proposals: ValidatedProposal[];
  rejections: ProposalRejection[];
}

const HISTORY_LIMIT = 20;
const RECENT_ACTIVITY_LIMIT = 10;
const UPCOMING_PLANS = 3;
const MAX_DISTANCE_CHANGE = 0.25;
const MAX_PACE_CHANGE = 0.1;
const MAX_NOTES_LENGTH = 300;
const NEW_CONVERSATION_TITLE = 'Nova conversa';

// Sinais de que o texto prometeu mudanças no plano (e portanto deveria
// existir um bloco <proposta> com botões nesta resposta).
const PROMISED_CHANGE_PATTERN =
  /aplicar|clique|proposta|novo plano|vou ajustar|desativar|ativar/i;

const PROPOSAL_RETRY_PROMPT = `Você é o Veltra Coach. Responda SOMENTE com o bloco <proposta>[...]</proposta> contendo um array JSON válido (até 5 itens), sem nenhum texto fora do bloco.
Formato exato de cada item: {"session":N,"changes":{"plannedDistance":8000,"plannedPace":330,"day":"Qua"},"reason":"motivo curto"}.
Use apenas números [N] de sessões futuras listadas no contexto. Cada semana tem 7 dias únicos: nunca coloque dois treinos no mesmo dia sem mover a outra sessão junto (swap) ou transformá-la em descanso ({"type":"rest"}). Para ativar um descanso, informe type, plannedDistance (metros) e plannedPace (seg/km).`;

const VERDICT_LABELS: Record<AdherenceVerdict, string> = {
  no_plano: 'No plano',
  proximo: 'Próximo do plano',
  diferente: 'Diferente do plano',
};

const COACH_SYSTEM_PROMPT = `Você é o Veltra Coach, um treinador de corrida experiente, técnico e encorajador.
Você segue a metodologia 80/20 (80% dos treinos leves, 20% intensos) e progressão de volume de no máximo 10% por semana.
Analise sempre os dados reais do atleta fornecidos no contexto; nunca invente dados.
Responda em português do Brasil, em markdown (use listas e negrito quando ajudar), de forma clara e direta.

Ao apresentar o plano ou os treinos da semana, siga estas regras:
- Liste apenas sessões de treino a partir de hoje, com dia, data, distância e pace. Não liste sessões de descanso nem treinos já passados; treinos passados só aparecem se o atleta pedir análise ou retrospectiva.
- O contexto traz os cabeçalhos "Semana atual" e "Próxima semana"; use essas referências ao responder.
- Cite sempre o próximo longão (dia, data, distância e pace) quando houver, usando a linha "Próximo longão" do contexto, e avise quando ele estiver na próxima semana.
- Mencione dias de descanso apenas quando o atleta perguntar ou quando for relevante para justificar a recuperação.

Negociação de treinos: quando o atleta pedir ou quando fizer sentido, você pode propor mudanças em treinos FUTUROS do plano (nunca em treinos passados).
- Cada semana tem 7 posições (uma por dia: treino ou descanso). O dia de cada sessão é único na semana: NUNCA deixe dois treinos no mesmo dia.
- Para REMANEJAR dias (ex.: trocar Ter por Qui), inclua no mesmo bloco <proposta> TODAS as sessões afetadas, com a contrapartida (swap): quem estava na Qui vai para a Ter, ou a sessão da Qui vira descanso. Um item sozinho que move para um dia já ocupado gera duplicata e será rejeitado.
- Para MUDAR A QUANTIDADE de treinos (ex.: "só Qua, Sex e Dom"): desative os treinos excedentes com {"type":"rest"} (vira descanso, distância zerada) e ative os descansos nos dias desejados informando tipo, distância e pace (a distância/pace viajam com o treino de origem — o volume NÃO é recalculado, apenas somado; avise o novo total semanal). Liste TODAS as ativações e desativações no mesmo bloco.
- Sessões de descanso futuras também têm número [N] e podem ser ativadas como treino. Sessões marcadas "(passado)" nunca podem ser alteradas.
- Proponha com cautela: distância dentro de ±25% e pace dentro de ±10% do planejado (o limite de ±25% não vale ao ativar um descanso, pois não há base anterior — mas respeite o limite por idade).
- Se a mudança não for segura para a meta ou para a recuperação, explique o motivo e não proponha.
- Para propor, inclua ao final da resposta um bloco exatamente neste formato (array com até 5 itens, mesmo para uma única mudança):
<proposta>[{"session":2,"changes":{"plannedDistance":8000,"plannedPace":330,"day":"Qua"},"reason":"motivo curto"}]</proposta>
- O campo session é o número entre colchetes da sessão no contexto (ex.: [2]). Use apenas números de sessões listados sem "(passado)". Confira o número de cada sessão antes de propor; nunca invente números.
- Cada item do array altera UMA sessão. Para pedidos que afetam vários treinos ("deixa a semana mais leve", "inverte Qui e Sáb", "só Qua, Sex e Dom"), crie um item por sessão afetada, incluindo contrapartidas e conversões treino↔descanso.
- Exemplos: swap de dias: [{"session":1,"changes":{"day":"Qui"},"reason":"swap"},{"session":2,"changes":{"day":"Ter"},"reason":"swap"}]. Redução 5→3: [{"session":1,"changes":{"type":"rest"},"reason":"reduzir para 3x"},{"session":2,"changes":{"type":"rest"},"reason":"reduzir para 3x"}] (desativa 2 treinos; os 3 restantes ficam onde estão).
- Nunca afirme que já alterou ou aplicou a mudança. Você apenas propõe; a mudança só é salva quando o atleta clicar em "Aplicar mudança" (ou "Aplicar todas", que salva o lote de uma vez ou rejeita tudo). Deixe isso claro ("proponho abaixo, clique em Aplicar para salvar").
- REGRA OBRIGATÓRIA: toda vez que você listar um "Novo Plano", mencionar ativar/desativar treinos, ou escrever "clique em Aplicar", INCLUA o bloco <proposta> na mesma resposta — sem exceção. Sem o bloco, nenhum botão aparece e nada pode ser salvo. Nunca escreva uma seção "Proposta:" em texto corrido: as propostas vão SOMENTE no bloco <proposta>; no texto visível, resuma as mudanças em 1-2 linhas.
- Nunca escreva "clique em Aplicar" se você não incluiu o bloco <proposta> nesta mesma resposta. Sem bloco, não há botão — então não prometa botão.
- Se o pedido já está atendido pelo plano atual (ex.: os treinos já são nos dias pedidos), diga claramente que nada precisa mudar e não use "atualizado", "ajustado" ou "alterado" como se tivesse mudado algo. Só use essas palavras quando incluir o bloco <proposta> na mesma resposta.
- O campo session é o número entre colchetes da sessão no contexto (ex.: [2]). Use apenas números de sessões listados sem "(passado)".
- Se o atleta citar um dia da semana, considere a próxima ocorrência futura desse dia a partir de hoje, conferindo a data de cada sessão no contexto.
- Campos permitidos em changes: type, plannedDistance (metros), plannedPace (segundos por km), day, notes. Se não houver mudança concreta, não inclua o bloco.

Segurança e saúde: você não faz diagnóstico nem prescreve tratamento.
- Se houver alertas de saúde no contexto, explique com cautela, sem alarmar, e recomende acompanhamento profissional quando indicado.
- Se o atleta relatar sintomas agudos (dor no peito, desmaio, falta de ar), oriente interromper o exercício e procurar atendimento imediatamente (SAMU 192).
- Nunca proponha distância ou volume acima do limite por idade informado no contexto.`;

@Injectable()
export class CoachService {
  constructor(
    @InjectRepository(CoachConversation)
    private readonly conversationRepository: Repository<CoachConversation>,
    @InjectRepository(CoachMessage)
    private readonly messageRepository: Repository<CoachMessage>,
    @InjectRepository(Goal)
    private readonly goalRepository: Repository<Goal>,
    @InjectRepository(TrainingPlan)
    private readonly planRepository: Repository<TrainingPlan>,
    @InjectRepository(TrainingSession)
    private readonly sessionRepository: Repository<TrainingSession>,
    @InjectRepository(Activity)
    private readonly activityRepository: Repository<Activity>,
    private readonly athleteProfileService: AthleteProfileService,
    private readonly aiService: AiService,
    private readonly healthAlertsService: HealthAlertsService,
  ) {}

  async getOrCreateConversation(userId: string, conversationId?: string) {
    if (conversationId) {
      const conv = await this.conversationRepository.findOne({
        where: { id: conversationId, userId },
      });
      if (conv) return conv;
    }

    const conv = this.conversationRepository.create({
      userId,
      title: NEW_CONVERSATION_TITLE,
    });
    return this.conversationRepository.save(conv);
  }

  async getConversations(userId: string) {
    const conversations = await this.conversationRepository.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
    });

    return conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt?.toISOString() ?? null,
      updatedAt: conversation.updatedAt?.toISOString() ?? null,
    }));
  }

  async deleteConversations(userId: string): Promise<{ deleted: boolean }> {
    const conversations = await this.conversationRepository.find({
      where: { userId },
    });
    if (conversations.length === 0) return { deleted: true };

    const ids = conversations.map((conversation) => conversation.id);
    await this.messageRepository.delete({ conversationId: In(ids) });
    await this.conversationRepository.delete({ userId });
    return { deleted: true };
  }

  async getMessages(conversationId: string, userId: string) {
    const conv = await this.conversationRepository.findOne({
      where: { id: conversationId, userId },
    });
    if (!conv) return [];

    const messages = await this.messageRepository.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });

    return messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt?.toISOString() ?? null,
      proposals: (message.proposals ?? null) as ValidatedProposal[] | null,
      rejections: (message.rejections ?? null) as ProposalRejection[] | null,
    }));
  }

  async sendMessage(
    userId: string,
    content: string,
    conversationId?: string,
  ): Promise<CoachReply> {
    return this.streamMessage(userId, content, conversationId, () => undefined);
  }

  async streamMessage(
    userId: string,
    content: string,
    conversationId: string | undefined,
    onToken: (token: string) => void,
  ): Promise<CoachReply> {
    const conv = await this.getOrCreateConversation(userId, conversationId);

    const previous = await this.messageRepository.find({
      where: { conversationId: conv.id },
      order: { createdAt: 'DESC' },
      take: HISTORY_LIMIT,
    });
    const history = previous.reverse().map((message) => ({
      role: message.role === 'user' ? ('user' as const) : ('coach' as const),
      content: message.content,
    }));

    const userMsg = this.messageRepository.create({
      conversationId: conv.id,
      role: 'user',
      content,
    });
    await this.messageRepository.save(userMsg);

    const { context, proposalSessions } = await this.buildContext(userId);
    const result = await this.aiService.generateCoachReplyStream(
      `${COACH_SYSTEM_PROMPT}\n\n${context}`,
      history,
      content,
      onToken,
    );

    let text =
      result?.text?.trim() ||
      'Desculpe, não consegui responder agora. Tente novamente.';
    const rawProposals: CoachProposal[] =
      result?.proposals && result.proposals.length > 0
        ? result.proposals
        : result?.proposal
          ? [result.proposal]
          : [];
    const validated = await this.validateProposals(
      userId,
      rawProposals,
      proposalSessions,
    );
    let proposals = validated.proposals;
    const rejections = validated.rejections;

    // Retentativa silenciosa: o modelo descreveu mudanças (ou tentou um
    // bloco que foi rejeitado), mas nenhum botão seria exibido. Pede SÓ o
    // bloco <proposta> de novo, sem alterar o texto já enviado ao atleta.
    if (
      proposals.length === 0 &&
      (PROMISED_CHANGE_PATTERN.test(text) ||
        rawProposals.length > 0 ||
        result?.malformed)
    ) {
      const retry = await this.retryProposalBlock(
        userId,
        content,
        history,
        text,
        context,
        proposalSessions,
        rejections,
      );
      proposals = [...proposals, ...retry.proposals];
      // Mesma validação pode repetir a rejeição (ex.: o retry insistiu no
      // erro); deduplica por sessão+código para não poluir a resposta.
      const seenRejections = new Set(
        rejections.map((rejection) => `${rejection.session}-${rejection.code}`),
      );
      for (const rejection of retry.rejections) {
        const key = `${rejection.session}-${rejection.code}`;
        if (!seenRejections.has(key)) {
          seenRejections.add(key);
          rejections.push(rejection);
        }
      }
    }

    if (
      result?.malformed &&
      rawProposals.length === 0 &&
      proposals.length === 0
    ) {
      rejections.push({
        session: null,
        code: 'MALFORMED',
        message:
          'Não entendi a mudança proposta (bloco inválido). Tente pedir de novo, ex.: "reduz o treino de Qua para 8 km". Nada foi alterado.',
      });
    }

    if (
      proposals.length === 0 &&
      rejections.length === 0 &&
      (/aplicar/i.test(text) ||
        (/atualizad|ajustad|alterad|modificad|salv/i.test(text) &&
          /\[\d+\]/.test(text)))
    ) {
      text +=
        '\n\n_Mostrei seu plano acima, mas não gerei nenhuma mudança — nada foi alterado. Se você quer ajustar algum treino, peça especificando, ex.: "reduz o easy de Qua para 5 km"._';
    }

    if (rawProposals.length > 0) {
      console.warn(
        'Propostas do coach validadas:',
        JSON.stringify({
          raw: rawProposals,
          accepted: proposals.length,
          rejections,
        }),
      );
    }

    const coachMsg = this.messageRepository.create({
      conversationId: conv.id,
      role: 'coach',
      content: text,
      proposals: proposals.length > 0 ? proposals : null,
      rejections: rejections.length > 0 ? rejections : null,
    });
    await this.messageRepository.save(coachMsg);

    await this.conversationRepository.update(conv.id, {
      updatedAt: new Date(),
    });

    if (conv.title === NEW_CONVERSATION_TITLE) {
      conv.title = content.length > 50 ? content.slice(0, 50) + '...' : content;
      await this.conversationRepository.save(conv);
    }

    return {
      conversationId: conv.id,
      message: {
        id: coachMsg.id,
        role: 'coach',
        content: text,
        timestamp: coachMsg.createdAt?.toISOString(),
      },
      proposal: proposals[0] ?? null,
      proposals,
      rejections,
    };
  }

  private async buildContext(userId: string): Promise<{
    context: string;
    proposalSessions: Map<number, string>;
  }> {
    const lines: string[] = [];
    const proposalSessions = new Map<number, string>();
    let proposalIndex = 1;

    const now = new Date();
    lines.push(
      `Data de hoje: ${now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}.`,
    );

    let profile: AthleteProfile | null = null;
    try {
      profile = await this.athleteProfileService.build(userId);
    } catch {
      profile = null;
    }

    if (profile?.hasData) {
      lines.push('Perfil do atleta:');
      lines.push(`- Nível: ${profile.level}`);
      lines.push(`- Volume semanal recente: ${profile.recentWeeklyKm} km`);
      lines.push(`- Maior corrida recente: ${profile.longestRunKm} km`);
      lines.push(`- Corridas por semana: ${profile.runsPerWeek}`);
      if (profile.bestShortPace) {
        lines.push(
          `- Melhor pace curto: ${this.formatPace(profile.bestShortPace)}`,
        );
      }
      if (profile.bestMediumPace) {
        lines.push(
          `- Melhor pace médio: ${this.formatPace(profile.bestMediumPace)}`,
        );
      }
      if (profile.bestLongPace) {
        lines.push(
          `- Melhor pace longo: ${this.formatPace(profile.bestLongPace)}`,
        );
      }
    }

    if (profile?.age !== undefined) {
      lines.push(`- Idade: ${profile.age} anos`);
    }
    if (profile?.predictedMaxHeartRate) {
      lines.push(
        `- FC máxima prevista (fórmula de Tanaka): ${profile.predictedMaxHeartRate} bpm`,
      );
    }
    if (profile?.recentForm?.hasData) {
      lines.push(
        `- Últimas 3 semanas: ${profile.recentForm.weeklyKm} km/semana, ${profile.recentForm.runs} corridas, longão de ${profile.recentForm.longestKm} km`,
      );
    }

    const ageAdjustment = planAgeAdjustment(profile?.age);
    if (ageAdjustment) {
      lines.push(`- Limite por idade: ${ageAdjustment.reason}`);
    }

    const healthAlerts = await this.healthAlertsService
      .getAlerts(userId)
      .catch(() => []);

    if (healthAlerts.length > 0) {
      lines.push('');
      lines.push(
        'Alertas de saúde e segurança (não diagnosticar; orientar acompanhamento profissional quando indicado):',
      );
      for (const alert of healthAlerts.slice(0, 5)) {
        lines.push(
          `- [${alert.severity}] ${alert.title}: ${alert.message} ${alert.recommendation}`,
        );
      }
    }

    const goal = await this.goalRepository.findOne({
      where: { userId, status: 'active' },
      order: { createdAt: 'DESC' },
    });

    if (goal) {
      lines.push('');
      lines.push('Meta ativa:');
      lines.push(
        `- ${goal.title}: ${(goal.targetDistance / 1000).toFixed(1)} km em ${new Date(goal.targetDate).toLocaleDateString('pt-BR')}`,
      );
      lines.push(`- Dias de treino por semana: ${goal.daysPerWeek}`);
      if (goal.longRunDay) lines.push(`- Dia do longão: ${goal.longRunDay}`);
      if (goal.threeKmTime) {
        lines.push(
          `- Teste de 3 km: ${this.formatPace(goal.threeKmTime / 3)}/km`,
        );
      }
      if (goal.longestRunDistance) {
        lines.push(
          `- Maior distância informada: ${(goal.longestRunDistance / 1000).toFixed(1)} km`,
        );
      }
      if (goal.targetTime) {
        lines.push(`- Tempo alvo: ${this.formatDuration(goal.targetTime)}`);
      }
    }

    const weekStart = this.currentWeekStart();
    const plans = await this.planRepository.find({
      where: { userId, weekStart: MoreThanOrEqual(weekStart.toISOString()) },
      relations: ['sessions'],
      order: {
        weekStart: 'ASC',
        sessions: { dayOrder: 'ASC' },
      } as unknown as FindOptionsOrder<TrainingPlan>,
      take: UPCOMING_PLANS,
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const plan of plans) {
      if (!plan.sessions?.length) continue;

      lines.push('');
      lines.push(`${this.describeWeek(new Date(plan.weekStart), weekStart)}:`);

      const restDays: string[] = [];
      let weeklyKm = 0;
      let workoutCount = 0;

      for (const session of plan.sessions) {
        const sessionDate = this.sessionDate(plan.weekStart, session.dayOrder);
        const isPast = sessionDate < today;

        if (session.type === 'rest') {
          if (isPast) {
            const label = sessionDate.toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
            });
            restDays.push(`${session.day} ${label} (passado)`);
            continue;
          }
          const index = proposalIndex++;
          proposalSessions.set(index, session.id);
          lines.push(this.describeSession(session, sessionDate, index));
          continue;
        }

        workoutCount += 1;
        weeklyKm += session.plannedDistance / 1000;

        let index: number | undefined;
        if (!isPast) {
          index = proposalIndex++;
          proposalSessions.set(index, session.id);
        }

        lines.push(this.describeSession(session, sessionDate, index));
      }

      lines.push(
        `- Resumo da semana: ${workoutCount} treinos, ${weeklyKm.toFixed(1)} km (soma dos treinos, sem descanso).`,
      );

      if (restDays.length > 0) {
        lines.push(`- Descanso passado: ${restDays.join(', ')}`);
      }
    }

    const nextLongRun = this.findNextLongRun(plans, today, weekStart);
    if (nextLongRun) {
      lines.push('');
      lines.push(`Próximo longão: ${nextLongRun}`);
    }

    const activities = await this.activityRepository.find({
      where: { user: { id: userId } },
      order: { start_date: 'DESC' },
      take: RECENT_ACTIVITY_LIMIT,
    });

    if (activities.length > 0) {
      const sessions = await this.sessionRepository.find({
        where: { activityId: In(activities.map((activity) => activity.id)) },
      });
      const sessionByActivity = new Map(
        sessions.map((session) => [session.activityId, session]),
      );

      lines.push('');
      lines.push('Corridas recentes:');

      for (const activity of activities) {
        const date =
          activity.start_date_local ?? activity.start_date ?? new Date();
        const distanceKm = activity.distance / 1000;
        const pace = distanceKm > 0 ? activity.moving_time / distanceKm : 0;
        let line = `- ${date.toLocaleDateString('pt-BR')} · ${activity.name} · ${distanceKm.toFixed(2)} km @ ${this.formatPace(pace)}`;

        const session = sessionByActivity.get(activity.id);
        if (session) {
          const adherence = assessAdherence({
            plannedDistance: session.plannedDistance,
            plannedPace: session.plannedPace,
            actualDistance: session.actualDistance,
            actualPace: session.actualPace,
          });
          line += ` · treino ${session.type} (${session.day})`;
          if (adherence)
            line += ` · aderência: ${VERDICT_LABELS[adherence.verdict]}`;
        }

        lines.push(line);
      }
    }

    return { context: lines.join('\n'), proposalSessions };
  }

  private describeSession(
    session: TrainingSession,
    sessionDate: Date,
    index?: number,
  ): string {
    const prefix = index !== undefined ? `[${index}] ` : '';
    if (session.type === 'rest') {
      let line = `- ${prefix}${session.day} ${sessionDate.toLocaleDateString('pt-BR')} descanso`;
      if (index === undefined) line += ' (passado — não pode ser alterado)';
      else line += ' (descanso futuro — pode ser ativado como treino)';
      if (session.notes) line += ` | obs: ${session.notes}`;
      return line;
    }
    let line = `- ${prefix}${session.day} ${sessionDate.toLocaleDateString('pt-BR')} ${session.type} ${(session.plannedDistance / 1000).toFixed(1)} km @ ${this.formatPace(session.plannedPace)}`;

    if (index === undefined) line += ' (passado — não pode ser alterado)';

    if (session.completed && session.actualDistance != null) {
      const actualPace =
        session.actualPace != null
          ? ` @ ${this.formatPace(session.actualPace)}`
          : '';
      line += ` | realizado: ${(session.actualDistance / 1000).toFixed(1)} km${actualPace}`;

      const adherence = assessAdherence({
        plannedDistance: session.plannedDistance,
        plannedPace: session.plannedPace,
        actualDistance: session.actualDistance,
        actualPace: session.actualPace,
      });
      if (adherence) line += ` (${VERDICT_LABELS[adherence.verdict]})`;
    }

    if (session.notes) line += ` | obs: ${session.notes}`;
    return line;
  }

  private async retryProposalBlock(
    userId: string,
    content: string,
    history: { role: 'user' | 'coach'; content: string }[],
    text: string,
    context: string,
    proposalSessions: Map<number, string>,
    rejectionsSoFar: ProposalRejection[],
  ): Promise<{
    proposals: ValidatedProposal[];
    rejections: ProposalRejection[];
  }> {
    const empty = { proposals: [], rejections: [] } as {
      proposals: ValidatedProposal[];
      rejections: ProposalRejection[];
    };

    const reasons = rejectionsSoFar
      .map((rejection) => rejection.message)
      .slice(0, 3);
    const nudge =
      reasons.length > 0
        ? `Sua resposta anterior tentou propor mudanças, mas foram rejeitadas: ${reasons.join(' | ')}. Corrija (dias únicos na semana, só sessões [N] futuras) e responda SOMENTE com o bloco <proposta>.`
        : 'Sua resposta anterior descreveu mudanças no plano mas NÃO incluiu o bloco <proposta>, então nenhum botão apareceu para o atleta. Responda SOMENTE com o bloco <proposta>, sem nenhum outro texto.';

    let retry: Awaited<
      ReturnType<AiService['generateCoachReplyStream']>
    > | null;
    try {
      retry = await this.aiService.generateCoachReplyStream(
        `${PROPOSAL_RETRY_PROMPT}\n\n${context}`,
        [
          ...history,
          { role: 'user' as const, content },
          { role: 'coach' as const, content: text },
        ],
        nudge,
        () => undefined,
      );
    } catch {
      return empty;
    }

    const raw: CoachProposal[] =
      retry?.proposals && retry.proposals.length > 0
        ? retry.proposals
        : retry?.proposal
          ? [retry.proposal]
          : [];
    if (raw.length === 0) return empty;

    console.warn('Retentativa de propostas do coach:', JSON.stringify({ raw }));
    return this.validateProposals(userId, raw, proposalSessions);
  }

  private async validateProposals(
    userId: string,
    rawProposals: CoachProposal[],
    proposalSessions: Map<number, string>,
  ): Promise<{
    proposals: ValidatedProposal[];
    rejections: ProposalRejection[];
  }> {
    const proposals: ValidatedProposal[] = [];
    const rejections: ProposalRejection[] = [];
    const seenSessions = new Set<number>();

    for (const item of rawProposals) {
      if (seenSessions.has(item.session)) {
        rejections.push({
          session: item.session,
          code: 'MALFORMED',
          message: `Sessão [${item.session}] repetida no mesmo pedido — considerei só a primeira. Nada foi alterado para a repetição.`,
        });
        continue;
      }
      seenSessions.add(item.session);

      const validated = await this.validateSingleProposal(
        userId,
        item,
        proposalSessions,
      );
      if (validated.rejection) {
        rejections.push(validated.rejection);
        continue;
      }
      proposals.push(validated.proposal as ValidatedProposal);
    }

    // Simulação do estado final por plano: rejeita o que criaria dia duplicado
    // com sessões existentes no plano (não só dentro do lote). Swaps passam,
    // porque o estado final não tem duplicata.
    const accepted = await this.rejectDayCollisions(proposals, rejections);

    return { proposals: accepted, rejections };
  }

  private async rejectDayCollisions(
    proposals: ValidatedProposal[],
    rejections: ProposalRejection[],
  ): Promise<ValidatedProposal[]> {
    if (proposals.length === 0) return proposals;

    const byPlan = new Map<string, ValidatedProposal[]>();
    for (const proposal of proposals) {
      const list = byPlan.get(proposal.planId) ?? [];
      list.push(proposal);
      byPlan.set(proposal.planId, list);
    }

    const accepted: ValidatedProposal[] = [];

    for (const [planId, items] of byPlan) {
      let siblings: TrainingSession[] = [];
      try {
        siblings = await this.sessionRepository.find({ where: { planId } });
      } catch {
        siblings = [];
      }
      if (siblings.length === 0) {
        // Sem dados do plano (ex.: mocks): simula só com os itens do lote
        // para ao menos detectar colisões dentro do próprio pedido.
        siblings = items.map(
          (item) =>
            ({
              id: item.sessionId,
              day: item.before.day,
              type: item.before.type,
            }) as TrainingSession,
        );
      }

      // Estado final simulado: dia -> sessionId. O dia é único no plano
      // (uma linha por dia, treino ou descanso), então qualquer duplicata
      // — inclusive com sessões fora do lote — rejeita o item.
      // Dias de sessões fora do lote são fixos; itens do lote que trocam
      // entre si (swap/rotação) passam, pois o dia de destino é liberado.
      const finalDay = new Map<string, string>();
      for (const sibling of siblings) {
        finalDay.set(sibling.id, sibling.day);
      }
      for (const item of items) {
        finalDay.set(item.sessionId, item.changes.day ?? item.before.day);
      }

      const claimed = new Map<string, string>();
      for (const sibling of siblings) {
        if (!items.some((item) => item.sessionId === sibling.id)) {
          claimed.set(sibling.day, sibling.id);
        }
      }

      for (const item of items) {
        const day = finalDay.get(item.sessionId) as string;
        if (claimed.has(day)) {
          const occupant = siblings.find(
            (s) =>
              s.id !== item.sessionId &&
              (finalDay.get(s.id) ?? s.day) === day &&
              !items.some((other) => other.sessionId === s.id),
          );
          rejections.push({
            session: item.session,
            code: 'DAY_COLLISION',
            message: occupant
              ? `Sessão [${item.session}]: não propus mover para ${day} porque esse dia já tem treino no plano. Para trocar, preciso mover a outra sessão junto (swap) ou transformar um dos dois em descanso. Nada foi alterado.`
              : `Sessão [${item.session}]: não propus mover para ${day} porque outra mudança do mesmo pedido já ocupa esse dia. Escolha outro dia. Nada foi alterado.`,
          });
          continue;
        }
        claimed.set(day, item.sessionId);
        accepted.push(item);
      }
    }

    return accepted;
  }

  private async validateSingleProposal(
    userId: string,
    proposal: CoachProposal,
    proposalSessions: Map<number, string>,
  ): Promise<{ proposal?: ValidatedProposal; rejection?: ProposalRejection }> {
    const fail = (
      code: ProposalRejectionCode,
      message: string,
    ): { rejection: ProposalRejection } => ({
      rejection: { session: proposal.session, code, message },
    });

    const sessionId = proposalSessions.get(proposal.session);
    if (!sessionId) {
      return fail(
        'INVALID_SESSION',
        `Sessão [${proposal.session}] não existe nos treinos futuros listados (pode ser passada ou número errado). Confira os números [N] da semana e peça de novo. Nada foi alterado.`,
      );
    }

    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
      relations: ['plan'],
    });

    if (!session || session.plan?.userId !== userId) {
      return fail(
        'INVALID_SESSION',
        `Sessão [${proposal.session}] não encontrada no seu plano. Nada foi alterado.`,
      );
    }

    const sessionDate = new Date(session.plan.weekStart);
    sessionDate.setDate(sessionDate.getDate() + session.dayOrder);
    sessionDate.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (sessionDate < today) {
      return fail(
        'PAST_OR_REST',
        `Sessão [${proposal.session}] já passou e não pode ser alterada. Posso ajustar só treinos futuros. Nada foi alterado.`,
      );
    }

    const isRest = session.type === 'rest';
    const targetType =
      proposal.changes.type &&
      TRAINING_SESSION_TYPES.includes(proposal.changes.type)
        ? proposal.changes.type
        : session.type;
    const deactivating = !isRest && targetType === 'rest';
    const activating = isRest && targetType !== 'rest';

    const changes: CoachProposal['changes'] = {};
    let outOfRange = false;
    let ageCapped = false;

    if (
      proposal.changes.type &&
      TRAINING_SESSION_TYPES.includes(proposal.changes.type)
    ) {
      changes.type = proposal.changes.type;
    }

    if (
      proposal.changes.day &&
      TRAINING_SESSION_DAYS.includes(proposal.changes.day)
    ) {
      changes.day = proposal.changes.day;
    }

    // Distância: o limite de ±25% só vale para ajuste de treino existente.
    // Ao ativar um descanso não há base anterior (volume mantido por treino),
    // então aceita distância absoluta e valida só o teto por idade.
    if (proposal.changes.plannedDistance !== undefined) {
      const plannedDistance = proposal.changes.plannedDistance;
      if (activating) {
        if (plannedDistance > 0 && plannedDistance <= 100000) {
          changes.plannedDistance = plannedDistance;
        } else {
          outOfRange = true;
        }
      } else if (deactivating) {
        // Desativar zera a distância no apply; valor enviado é ignorado.
      } else if (session.plannedDistance > 0) {
        if (
          plannedDistance >=
            session.plannedDistance * (1 - MAX_DISTANCE_CHANGE) &&
          plannedDistance <= session.plannedDistance * (1 + MAX_DISTANCE_CHANGE)
        ) {
          changes.plannedDistance = plannedDistance;
        } else {
          outOfRange = true;
        }
      } else {
        outOfRange = true;
      }
    }

    if (changes.plannedDistance !== undefined) {
      const age = await this.athleteProfileService.getAge(userId);
      if (age !== undefined) {
        const distanceKm = changes.plannedDistance / 1000;
        const assessment = assessDistanceForAge(distanceKm, age);
        const adjustment = planAgeAdjustment(age);
        const exceedsAgeCap =
          adjustment?.maxLongRunKm !== undefined &&
          distanceKm > adjustment.maxLongRunKm;

        if (!assessment.allowed || exceedsAgeCap) {
          changes.plannedDistance = undefined;
          ageCapped = true;
        }
      }
    }

    if (proposal.changes.plannedPace !== undefined) {
      const plannedPace = proposal.changes.plannedPace;
      if (activating) {
        if (plannedPace > 0 && plannedPace <= 900) {
          changes.plannedPace = plannedPace;
        } else {
          outOfRange = true;
        }
      } else if (deactivating) {
        // Ignorado: descanso tem pace zerado.
      } else if (session.plannedPace > 0) {
        if (
          plannedPace >= session.plannedPace * (1 - MAX_PACE_CHANGE) &&
          plannedPace <= session.plannedPace * (1 + MAX_PACE_CHANGE)
        ) {
          changes.plannedPace = plannedPace;
        } else {
          outOfRange = true;
        }
      } else {
        outOfRange = true;
      }
    }

    if (proposal.changes.notes) {
      changes.notes = proposal.changes.notes.slice(0, MAX_NOTES_LENGTH);
    }

    if (
      activating &&
      (changes.plannedDistance === undefined ||
        changes.plannedPace === undefined)
    ) {
      return fail(
        'EMPTY_CHANGES',
        `Sessão [${proposal.session}]: para ativar o descanso de ${session.day} como treino preciso de tipo, distância e pace (a distância/pace viajam com o treino de origem, sem recálculo). Nada foi alterado — pode detalhar?`,
      );
    }

    if (Object.keys(changes).length === 0) {
      if (ageCapped) {
        return fail(
          'AGE_CAP',
          `Sessão [${proposal.session}]: não propus a distância por segurança para a sua idade. Nada foi alterado — quer uma opção dentro do limite?`,
        );
      }
      if (outOfRange) {
        return fail(
          'OUT_OF_RANGE',
          `Sessão [${proposal.session}]: não propus porque passou do limite seguro (±25% distância, ±10% pace). Nada foi alterado — quer que eu proponha dentro do limite?`,
        );
      }
      return fail(
        'EMPTY_CHANGES',
        `Sessão [${proposal.session}]: não identifiquei mudança válida (tipo, distância, pace, dia ou observação). Nada foi alterado — pode detalhar o ajuste?`,
      );
    }

    return {
      proposal: {
        session: proposal.session,
        sessionId: session.id,
        planId: session.planId,
        before: {
          day: session.day,
          type: session.type,
          plannedDistance: session.plannedDistance,
          plannedPace: session.plannedPace,
        },
        changes,
        reason: proposal.reason,
      },
    };
  }

  private describeWeek(planWeekStart: Date, currentWeekStart: Date): string {
    const weekEnd = new Date(planWeekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const format = (date: Date) =>
      date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const range = `${format(planWeekStart)} a ${format(weekEnd)}`;

    const diffWeeks = Math.round(
      (planWeekStart.getTime() - currentWeekStart.getTime()) /
        (7 * 24 * 60 * 60 * 1000),
    );

    if (diffWeeks === 0) return `Semana atual (${range})`;
    if (diffWeeks === 1) return `Próxima semana (${range})`;
    return `Semana de ${range}`;
  }

  private sessionDate(weekStart: string, dayOrder: number): Date {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + dayOrder);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private findNextLongRun(
    plans: TrainingPlan[],
    today: Date,
    currentWeekStart: Date,
  ): string | null {
    for (const plan of plans) {
      const sessions = [...(plan.sessions ?? [])].sort(
        (a, b) => a.dayOrder - b.dayOrder,
      );

      for (const session of sessions) {
        if (session.type !== 'long_run' || session.completed) continue;

        const sessionDate = this.sessionDate(plan.weekStart, session.dayOrder);
        if (sessionDate < today) continue;

        const diffWeeks = Math.round(
          (new Date(plan.weekStart).getTime() - currentWeekStart.getTime()) /
            (7 * 24 * 60 * 60 * 1000),
        );

        let when: string;
        if (diffWeeks <= 0) {
          when = 'nesta semana';
        } else if (diffWeeks === 1) {
          when = 'na próxima semana';
        } else {
          const label = new Date(plan.weekStart).toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
          });
          when = `na semana de ${label}`;
        }

        return `${session.day} ${sessionDate.toLocaleDateString('pt-BR')}, ${(session.plannedDistance / 1000).toFixed(1)} km @ ${this.formatPace(session.plannedPace)} (${when})`;
      }
    }

    return null;
  }

  private currentWeekStart(): Date {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
  }

  private formatPace(seconds?: number | null): string {
    if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return 'livre';
    const total = Math.round(seconds);
    const min = Math.floor(total / 60);
    const sec = total % 60;
    return `${min}:${sec.toString().padStart(2, '0')}/km`;
  }

  private formatDuration(seconds: number): string {
    const total = Math.round(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0
      ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
      : `${m}:${s.toString().padStart(2, '0')}`;
  }
}
