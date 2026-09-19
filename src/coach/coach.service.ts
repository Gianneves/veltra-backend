import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsOrder, In, MoreThanOrEqual, Repository } from 'typeorm';
import { Activity } from 'src/activities/entities/activity.entity';
import { AiService, type CoachProposal } from 'src/ai/ai.service';
import { Goal } from 'src/goals/entities/goal.entity';
import {
  assessDistanceForAge,
  planAgeAdjustment,
} from 'src/health/age-policy';
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

export interface CoachReply {
  conversationId: string;
  message: {
    id: string;
    role: 'coach';
    content: string;
    timestamp: string | undefined;
  };
  proposal: ValidatedProposal | null;
}

const HISTORY_LIMIT = 20;
const RECENT_ACTIVITY_LIMIT = 10;
const UPCOMING_PLANS = 3;
const MAX_DISTANCE_CHANGE = 0.25;
const MAX_PACE_CHANGE = 0.1;
const MAX_NOTES_LENGTH = 300;
const NEW_CONVERSATION_TITLE = 'Nova conversa';

const VERDICT_LABELS: Record<AdherenceVerdict, string> = {
  no_plano: 'No plano',
  proximo: 'Próximo do plano',
  diferente: 'Diferente do plano',
};

const COACH_SYSTEM_PROMPT = `Você é o Veltra Coach, um treinador de corrida experiente, técnico e encorajador.
Você segue a metodologia 80/20 (80% dos treinos leves, 20% intensos) e progressão de volume de no máximo 10% por semana.
Analise sempre os dados reais do atleta fornecidos no contexto; nunca invente dados.
Responda em português do Brasil, em markdown (use listas e negrito quando ajudar), de forma clara e direta.

Negociação de treinos: quando o atleta pedir ou quando fizer sentido, você pode propor mudanças em treinos FUTUROS do plano (nunca em treinos passados ou de descanso).
- Proponha com cautela: distância dentro de ±25% e pace dentro de ±10% do planejado.
- Se a mudança não for segura para a meta ou para a recuperação, explique o motivo e não proponha.
- Para propor, inclua ao final da resposta um bloco exatamente neste formato:
<proposta>{"session":2,"changes":{"plannedDistance":8000,"plannedPace":330,"day":"Qua"},"reason":"motivo curto"}</proposta>
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

    const text =
      result?.text?.trim() ||
      'Desculpe, não consegui responder agora. Tente novamente.';
    const proposal = result?.proposal
      ? await this.validateProposal(userId, result.proposal, proposalSessions)
      : null;

    if (result?.proposal && !proposal) {
      console.warn(
        'Proposta do coach descartada na validação:',
        JSON.stringify(result.proposal),
      );
    }

    const coachMsg = this.messageRepository.create({
      conversationId: conv.id,
      role: 'coach',
      content: text,
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
      proposal,
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
      lines.push(
        `Plano da semana de ${new Date(plan.weekStart).toLocaleDateString('pt-BR')}:`,
      );

      for (const session of plan.sessions) {
        const sessionDate = new Date(plan.weekStart);
        sessionDate.setDate(sessionDate.getDate() + session.dayOrder);
        sessionDate.setHours(0, 0, 0, 0);

        const isPast = sessionDate < today;
        let index: number | undefined;
        if (!isPast) {
          index = proposalIndex++;
          proposalSessions.set(index, session.id);
        }

        lines.push(this.describeSession(session, sessionDate, index));
      }
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

  private async validateProposal(
    userId: string,
    proposal: CoachProposal,
    proposalSessions: Map<number, string>,
  ): Promise<ValidatedProposal | null> {
    const sessionId = proposalSessions.get(proposal.session);
    if (!sessionId) return null;

    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
      relations: ['plan'],
    });

    if (!session || session.plan?.userId !== userId) return null;
    if (session.type === 'rest') return null;

    const sessionDate = new Date(session.plan.weekStart);
    sessionDate.setDate(sessionDate.getDate() + session.dayOrder);
    sessionDate.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (sessionDate < today) return null;

    const changes: CoachProposal['changes'] = {};

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

    if (
      proposal.changes.plannedDistance !== undefined &&
      session.plannedDistance > 0
    ) {
      const plannedDistance = proposal.changes.plannedDistance;
      if (
        plannedDistance >=
          session.plannedDistance * (1 - MAX_DISTANCE_CHANGE) &&
        plannedDistance <= session.plannedDistance * (1 + MAX_DISTANCE_CHANGE)
      ) {
        changes.plannedDistance = plannedDistance;
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
        }
      }
    }

    if (proposal.changes.plannedPace !== undefined && session.plannedPace > 0) {
      const plannedPace = proposal.changes.plannedPace;
      if (
        plannedPace >= session.plannedPace * (1 - MAX_PACE_CHANGE) &&
        plannedPace <= session.plannedPace * (1 + MAX_PACE_CHANGE)
      ) {
        changes.plannedPace = plannedPace;
      }
    }

    if (proposal.changes.notes) {
      changes.notes = proposal.changes.notes.slice(0, MAX_NOTES_LENGTH);
    }

    if (Object.keys(changes).length === 0) return null;

    return {
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
    };
  }

  private currentWeekStart(): Date {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
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
