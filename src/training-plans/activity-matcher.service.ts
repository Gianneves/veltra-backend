import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Activity } from 'src/activities/entities/activity.entity';
import { AiService } from 'src/ai/ai.service';
import { TrainingPlan } from './entities/training-plan.entity';
import { TrainingSession } from './entities/training-session.entity';

export type ActivityShape = 'interval' | 'long' | 'steady';

export interface ActivityFeatures {
  distanceKm: number;
  pace: number;
  movingTime: number;
  name: string;
  shape: ActivityShape;
  paceVariability: number;
  hardLaps: number;
  lapCount: number;
  maxSpeedRatio: number;
  repSizes: string[];
  localDate: Date;
}

export interface MatchCandidate {
  session: TrainingSession;
  score: number;
  reasons: string[];
}

export interface MatchResult {
  matched: boolean;
  sessionId?: string;
  method?: 'auto' | 'ai' | 'manual';
  score?: number;
  reason?: string;
}

const AUTO_MATCH_SCORE = 0.6;
const AUTO_MATCH_SHAPE_SCORE = 0.55;
const AUTO_MATCH_MARGIN = 0.08;
const AI_MATCH_SCORE = 0.4;
const MAX_DAY_DISTANCE = 2;

const SHAPE_COMPAT: Record<string, Record<ActivityShape, number>> = {
  interval: { interval: 1, long: 0.15, steady: 0.35 },
  fartlek: { interval: 1, long: 0.2, steady: 0.45 },
  tempo: { interval: 0.25, long: 0.35, steady: 0.9 },
  long_run: { interval: 0.15, long: 1, steady: 0.5 },
  race: { interval: 0.2, long: 1, steady: 0.6 },
  recovery: { interval: 0.1, long: 0.5, steady: 0.95 },
  easy: { interval: 0.1, long: 0.5, steady: 0.95 },
};

const MISMATCH_CAP = 0.35;

@Injectable()
export class ActivityMatcherService {
  constructor(
    @InjectRepository(TrainingPlan)
    private readonly planRepository: Repository<TrainingPlan>,
    @InjectRepository(TrainingSession)
    private readonly sessionRepository: Repository<TrainingSession>,
    @InjectRepository(Activity)
    private readonly activityRepository: Repository<Activity>,
    private readonly aiService: AiService,
  ) {}

  buildFeatures(activity: Activity): ActivityFeatures {
    const distanceKm = activity.distance / 1000;
    const pace = distanceKm > 0 ? activity.moving_time / distanceKm : 0;
    const localDate =
      activity.start_date_local ?? activity.start_date ?? new Date();

    const laps = (activity.laps ?? []).filter(
      (lap) => lap.distance >= 200 && lap.moving_time > 0,
    );
    const lapPaces = laps.map((lap) => lap.moving_time / (lap.distance / 1000));

    const meanPace =
      lapPaces.length > 0
        ? lapPaces.reduce((sum, value) => sum + value, 0) / lapPaces.length
        : 0;

    const variance =
      lapPaces.length > 1 && meanPace > 0
        ? lapPaces.reduce(
            (sum, value) => sum + Math.pow(value - meanPace, 2),
            0,
          ) / lapPaces.length
        : 0;

    const paceVariability = meanPace > 0 ? Math.sqrt(variance) / meanPace : 0;

    const hardPaceThreshold = pace > 0 ? pace * 0.92 : 0;
    const hardLaps = lapPaces.filter(
      (value) => hardPaceThreshold > 0 && value <= hardPaceThreshold,
    ).length;

    const maxSpeedRatio =
      activity.average_speed && activity.max_speed
        ? activity.max_speed / activity.average_speed
        : 0;

    let shape: ActivityShape = 'steady';
    if (lapPaces.length >= 4 && (paceVariability >= 0.075 || hardLaps >= 3)) {
      shape = 'interval';
    } else if (
      maxSpeedRatio >= 1.4 &&
      (paceVariability >= 0.06 || hardLaps >= 2)
    ) {
      shape = 'interval';
    } else if (distanceKm >= 12) {
      shape = 'long';
    } else if (paceVariability >= 0.06 && hardLaps >= 2) {
      shape = 'interval';
    }

    return {
      distanceKm,
      pace,
      movingTime: activity.moving_time,
      name: activity.name ?? '',
      shape,
      paceVariability,
      hardLaps,
      lapCount: lapPaces.length,
      maxSpeedRatio,
      repSizes: this.repSizes(activity.name ?? ''),
      localDate,
    };
  }

  scoreSession(
    session: TrainingSession,
    features: ActivityFeatures,
    sessionDate: Date,
  ): MatchCandidate {
    const reasons: string[] = [];

    const dayScore = this.dayScore(features.localDate, sessionDate);
    if (dayScore > 0) reasons.push(`dia ${dayScore.toFixed(2)}`);

    const plannedKm = session.plannedDistance / 1000;
    const maxKm = Math.max(features.distanceKm, plannedKm, 0.1);
    const distanceScore = this.clamp01(
      1 - Math.abs(features.distanceKm - plannedKm) / maxKm,
    );
    reasons.push(`dist ${distanceScore.toFixed(2)}`);

    const plannedPace = session.plannedPace > 0 ? session.plannedPace : 0;
    const paceScore =
      plannedPace > 0
        ? this.clamp01(1 - Math.abs(features.pace - plannedPace) / plannedPace)
        : 0.5;
    reasons.push(`pace ${paceScore.toFixed(2)}`);
    const shapeScore = SHAPE_COMPAT[session.type]?.[features.shape] ?? 0.5;
    reasons.push(`forma ${shapeScore.toFixed(2)}`);

    const nameScore = this.nameSimilarity(features.name, session);
    reasons.push(`nome ${nameScore.toFixed(2)}`);

    let score =
      0.25 * dayScore +
      0.2 * distanceScore +
      0.1 * paceScore +
      0.3 * shapeScore +
      0.15 * nameScore;

    const strongShape = shapeScore >= 0.85;
    const structureMatch = this.structureMatches(features.repSizes, session);

    if (!strongShape && !structureMatch) {
      score = Math.min(score, MISMATCH_CAP);
      reasons.push('sem formato equivalente');
    }

    if (distanceScore < 0.45 && !structureMatch) {
      score = Math.min(score, MISMATCH_CAP);
      reasons.push('distância incompatível');
    }

    const diffDays = Math.abs(this.dayDiff(features.localDate, sessionDate));
    if (diffDays >= 2 && !structureMatch && nameScore < 0.5) {
      score = Math.min(score, MISMATCH_CAP);
      reasons.push('dia distante');
    }

    return { session, score, reasons };
  }

  private structureMatches(
    activityRepSizes: string[],
    session: TrainingSession,
  ): boolean {
    if (activityRepSizes.length === 0) return false;

    const sessionRepSizes = this.repSizes(
      `${session.notes ?? ''} ${session.type}`,
    );

    return activityRepSizes.some((size) => sessionRepSizes.includes(size));
  }

  async matchActivity(
    userId: string,
    activity: Activity,
  ): Promise<MatchResult> {
    if (await this.isManuallyLinked(activity.id)) {
      return { matched: false, reason: 'vínculo manual' };
    }

    await this.unlinkSessionsForActivity(activity.id);

    const features = this.buildFeatures(activity);
    const plans = await this.loadWeekPlans(userId, features.localDate);

    if (plans.length === 0) {
      return { matched: false, reason: 'sem plano na semana' };
    }

    const candidates: MatchCandidate[] = [];
    const alreadyLinked = new Set(
      plans
        .flatMap((plan) => plan.sessions ?? [])
        .filter((session) => !!session.activityId)
        .map((session) => session.id),
    );

    for (const plan of plans) {
      for (const session of plan.sessions ?? []) {
        if (session.type === 'rest') continue;
        if (alreadyLinked.has(session.id)) continue;

        const sessionDate = this.sessionDate(plan, session);
        if (
          Math.abs(this.dayDiff(features.localDate, sessionDate)) >
          MAX_DAY_DISTANCE
        ) {
          continue;
        }

        candidates.push(this.scoreSession(session, features, sessionDate));
      }
    }

    if (candidates.length === 0) {
      return { matched: false, reason: 'nenhum candidato' };
    }

    candidates.sort((a, b) => b.score - a.score);
    const [best, second] = candidates;

    const margin = best.score - (second?.score ?? 0);
    const bestShapeCompat =
      SHAPE_COMPAT[best.session.type]?.[features.shape] ?? 0;
    const autoThreshold =
      bestShapeCompat >= 0.9 ? AUTO_MATCH_SHAPE_SCORE : AUTO_MATCH_SCORE;

    if (best.score >= autoThreshold && margin >= AUTO_MATCH_MARGIN) {
      await this.linkSession(activity, best.session, 'auto', best.score);
      return {
        matched: true,
        sessionId: best.session.id,
        method: 'auto',
        score: best.score,
      };
    }

    if (best.score >= AI_MATCH_SCORE) {
      const aiPick = await this.pickWithAi(
        activity,
        features,
        candidates.slice(0, 3),
      );
      if (aiPick) {
        const candidate = candidates.find(
          (item) => item.session.id === aiPick.sessionId,
        );
        if (candidate) {
          await this.linkSession(
            activity,
            candidate.session,
            'ai',
            candidate.score,
          );
          return {
            matched: true,
            sessionId: candidate.session.id,
            method: 'ai',
            score: candidate.score,
            reason: aiPick.reason,
          };
        }
      }
    }

    return {
      matched: false,
      reason: `melhor score ${best.score.toFixed(2)} insuficiente`,
    };
  }

  async isManuallyLinked(activityId: string): Promise<boolean> {
    const count = await this.sessionRepository.count({
      where: { activityId, matchMethod: 'manual' },
    });
    return count > 0;
  }

  async unlinkSessionsForActivity(activityId: string): Promise<number> {
    const sessions = await this.sessionRepository.find({
      where: { activityId },
    });

    if (sessions.length === 0) return 0;

    for (const session of sessions) {
      this.clearSessionMatch(session);
    }

    await this.sessionRepository.save(sessions);
    return sessions.length;
  }

  async linkActivityToSession(
    userId: string,
    planId: string,
    sessionId: string,
    activityId: string | null,
  ): Promise<TrainingSession | null> {
    const plan = await this.planRepository.findOne({
      where: { id: planId, userId },
      relations: ['sessions'],
    });
    if (!plan) return null;

    const session = (plan.sessions ?? []).find((item) => item.id === sessionId);
    if (!session) return null;

    if (!activityId) {
      this.clearSessionMatch(session);
      return this.sessionRepository.save(session);
    }

    const activity = await this.activityRepository.findOne({
      where: { id: activityId, user: { id: userId } },
    });
    if (!activity) return null;

    await this.unlinkSessionsForActivity(activity.id);
    await this.linkSession(activity, session, 'manual', null);

    return session;
  }

  private async linkSession(
    activity: Activity,
    session: TrainingSession,
    method: 'auto' | 'ai' | 'manual',
    score: number | null,
  ): Promise<void> {
    const distanceKm = activity.distance / 1000;
    session.activityId = activity.id;
    session.actualDistance = activity.distance;
    session.actualPace =
      distanceKm > 0 ? Math.round(activity.moving_time / distanceKm) : 0;
    session.actualMovingTime = activity.moving_time;
    session.matchScore = score;
    session.matchMethod = method;
    session.matchedAt = new Date();
    session.completed = true;

    await this.sessionRepository.save(session);
  }

  private clearSessionMatch(session: TrainingSession): void {
    session.activityId = null;
    session.actualDistance = null;
    session.actualPace = null;
    session.actualMovingTime = null;
    session.matchScore = null;
    session.matchMethod = null;
    session.matchedAt = null;
    session.completed = false;
  }

  private async loadWeekPlans(
    userId: string,
    localDate: Date,
  ): Promise<TrainingPlan[]> {
    const weekStart = this.getWeekStart(localDate);
    const weekStarts = [-7, 0, 7].map((offset) => {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + offset);
      return date.toISOString();
    });

    return this.planRepository.find({
      where: { userId, weekStart: In(weekStarts) },
      relations: ['sessions'],
    });
  }

  private sessionDate(plan: TrainingPlan, session: TrainingSession): Date {
    const date = new Date(plan.weekStart);
    date.setDate(date.getDate() + (session.dayOrder ?? 0));
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private dayDiff(activityDate: Date, sessionDate: Date): number {
    const activityDay = this.startOfDay(activityDate);
    return Math.round(
      (activityDay.getTime() - sessionDate.getTime()) / (24 * 60 * 60 * 1000),
    );
  }

  private dayScore(activityDate: Date, sessionDate: Date): number {
    const diffDays = Math.abs(this.dayDiff(activityDate, sessionDate));

    if (diffDays === 0) return 1;
    if (diffDays === 1) return 0.6;
    if (diffDays === 2) return 0.25;
    return 0;
  }

  private nameSimilarity(
    activityName: string,
    session: TrainingSession,
  ): number {
    const name = this.normalize(activityName);
    const sessionText = this.normalize(
      `${session.notes ?? ''} ${session.type ?? ''}`,
    );

    if (!name) return 0;

    const tokens = name.split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
    const hits = tokens.filter((t) => sessionText.includes(t)).length;
    let score = tokens.length > 0 ? hits / tokens.length : 0;

    const activityReps = this.repPatterns(name);
    const sessionReps = this.repPatterns(sessionText);
    if (
      activityReps.length > 0 &&
      activityReps.some((rep) => sessionReps.includes(rep))
    ) {
      score = Math.max(score, 0.9);
    }

    return score;
  }

  private repPatterns(text: string): string[] {
    const matches: string[] = text.match(/\d+\s*x\s*\d+/g) ?? [];
    return matches.map((rep) => rep.replace(/\s+/g, ''));
  }

  private repSizes(text: string): string[] {
    const normalized = this.normalize(text);
    const sizes = new Set<string>();

    for (const match of normalized.matchAll(
      /(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(km|m)?/g,
    )) {
      const value = Number(match[2].replace(',', '.'));
      const unit = match[3] ?? (value >= 100 ? 'm' : '');
      if (!unit) continue;
      sizes.add(unit === 'km' ? `${value * 1000}m` : `${value}m`);
    }

    for (const match of normalized.matchAll(
      /(\d+)\s*x\s*\(?\s*(\d+)\s*(min|s)\b/g,
    )) {
      sizes.add(`${Number(match[2])}${match[3]}`);
    }

    return [...sizes];
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  private startOfDay(date: Date): Date {
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    return day;
  }

  private getWeekStart(date: Date): Date {
    const start = this.startOfDay(date);
    start.setDate(start.getDate() - start.getDay());
    return start;
  }

  private clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  private async pickWithAi(
    activity: Activity,
    features: ActivityFeatures,
    candidates: MatchCandidate[],
  ): Promise<{ sessionId: string; reason?: string } | null> {
    const context = JSON.stringify({
      atividade: {
        nome: activity.name,
        distanciaKm: Math.round(features.distanceKm * 10) / 10,
        paceSegKm: Math.round(features.pace),
        tempoMovimentoSeg: features.movingTime,
        formato: features.shape,
        variacaoPace: Math.round(features.paceVariability * 100) / 100,
        voltasRapidas: features.hardLaps,
        voltas: features.lapCount,
        dataLocal: this.startOfDay(features.localDate)
          .toISOString()
          .slice(0, 10),
      },
      candidatos: candidates.map((candidate) => ({
        id: candidate.session.id,
        tipo: candidate.session.type,
        dia: candidate.session.day,
        distanciaKm:
          Math.round((candidate.session.plannedDistance / 1000) * 10) / 10,
        paceSegKm: Math.round(candidate.session.plannedPace),
        notas: (candidate.session.notes ?? '').slice(0, 160),
        score: Math.round(candidate.score * 100) / 100,
      })),
    });

    return this.aiService.classifyActivityMatch(context);
  }
}
