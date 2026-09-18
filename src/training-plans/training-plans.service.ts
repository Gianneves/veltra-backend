import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsOrder, In, MoreThanOrEqual, Repository } from 'typeorm';
import { TrainingPlan } from './entities/training-plan.entity';
import { TrainingSession } from './entities/training-session.entity';
import { Activity } from 'src/activities/entities/activity.entity';
import { Goal } from 'src/goals/entities/goal.entity';
import { AiService } from 'src/ai/ai.service';
import {
  AthleteProfile,
  AthleteProfileService,
  AthleteLevel,
} from './athlete-profile.service';
import {
  PlanPhase,
  QualityWorkout,
  WorkoutPreferences,
  phaseWorkoutPool,
  resolvePhase,
  selectWeekWorkouts,
  workoutsOfType,
} from './workout-library';
import type { QualityRunType, TrainingPattern } from './training-pattern';
import {
  RaceTargetAssessment,
  assessRaceTarget,
  buildRaceReferences,
  formatRaceTime,
  predictRacePace,
} from './race-target';
import { ActivityMatcherService } from './activity-matcher.service';

export interface generateFromGoalResult {
  plans: TrainingPlan[];
}

interface PaceSet {
  interval: number;
  threshold: number;
  easy: number;
  recovery: number;
  goal: number;
}

type SessionRole =
  | 'long'
  | 'quality1'
  | 'quality2'
  | 'easy'
  | 'recovery'
  | 'rest';

interface WeekLayout {
  day: string;
  role: SessionRole;
}

interface WeekSummary {
  weekStart: string;
  phase: PlanPhase;
  weeklyKm: number;
  longKm: number;
  workouts: string[];
}

const DAY_ORDER: Record<string, number> = {
  Dom: 0,
  Seg: 1,
  Ter: 2,
  Qua: 3,
  Qui: 4,
  Sex: 5,
  Sáb: 6,
};

const ALL_DAY_SHORTS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const FULL_TO_SHORT: Record<string, string> = {
  Domingo: 'Dom',
  Segunda: 'Seg',
  Terça: 'Ter',
  Quarta: 'Qua',
  Quinta: 'Qui',
  Sexta: 'Sex',
  Sábado: 'Sáb',
};

const MIN_PACE = 150;
const MAX_PACE = 600;
const MIN_EASY_KM = 3;

const SESSIONS_ORDER = {
  sessions: { dayOrder: 'ASC' },
} as unknown as FindOptionsOrder<TrainingPlan>;

const DISTANCE_TARGETS: { minKm: number; key: string }[] = [
  { minKm: 42, key: '42.2' },
  { minKm: 21, key: '21.1' },
  { minKm: 10, key: '10' },
  { minKm: 5, key: '5' },
];

@Injectable()
export class TrainingPlansService {
  constructor(
    @InjectRepository(TrainingPlan)
    private readonly planRepository: Repository<TrainingPlan>,
    @InjectRepository(TrainingSession)
    private readonly sessionRepository: Repository<TrainingSession>,
    @InjectRepository(Goal)
    private readonly goalRepository: Repository<Goal>,
    @InjectRepository(Activity)
    private readonly activityRepository: Repository<Activity>,
    private readonly athleteProfileService: AthleteProfileService,
    private readonly aiService: AiService,
    private readonly activityMatcher: ActivityMatcherService,
  ) {}

  async findCurrent(userId: string) {
    const now = new Date();
    const weekStart = this.getWeekStart(now);

    const plan = await this.planRepository.findOne({
      where: { userId, weekStart: weekStart.toISOString() },
      relations: ['sessions'],
      order: SESSIONS_ORDER,
    });

    return plan;
  }

  async findAll(userId: string) {
    return this.planRepository.find({
      where: { userId },
      relations: ['sessions'],
      order: { weekStart: 'ASC', ...SESSIONS_ORDER },
    });
  }

  async findByWeek(userId: string, weekStart: string) {
    return this.planRepository.findOne({
      where: { userId, weekStart },
      relations: ['sessions'],
      order: SESSIONS_ORDER,
    });
  }

  async getPattern(userId: string) {
    const goal = await this.goalRepository.findOne({
      where: { userId, status: 'active' },
      order: { createdAt: 'DESC' },
    });

    const profile = await this.athleteProfileService.build(
      userId,
      goal ?? undefined,
    );

    return profile.pattern;
  }

  async linkSessionActivity(
    userId: string,
    planId: string,
    sessionId: string,
    activityId: string | null,
  ) {
    return this.activityMatcher.linkActivityToSession(
      userId,
      planId,
      sessionId,
      activityId,
    );
  }

  async updateSession(
    planId: string,
    sessionId: string,
    userId: string,
    data: Partial<TrainingSession>,
  ) {
    const plan = await this.planRepository.findOne({
      where: { id: planId, userId },
    });
    if (!plan) return null;

    const session = await this.sessionRepository.findOne({
      where: { id: sessionId, planId },
    });
    if (!session) return null;

    Object.assign(session, data);
    return this.sessionRepository.save(session);
  }

  async regenerateForUser(userId: string) {
    const goal = await this.goalRepository.findOne({
      where: { userId, status: 'active' },
      order: { createdAt: 'DESC' },
    });

    if (!goal) return { regenerated: false, reason: 'no_active_goal' };

    const { plans } = await this.regenerateFromGoal(goal);

    return { regenerated: true, weeks: plans.length };
  }

  async hasCompletedSessions(userId: string, weekStart: Date) {
    const plan = await this.planRepository.findOne({
      where: { userId, weekStart: weekStart.toISOString() },
      relations: ['sessions'],
    });

    return !!plan?.sessions?.some((s) => s.completed);
  }

  async deleteFuturePlansForUser(userId: string, from: Date) {
    const fromIso = this.getWeekStart(from).toISOString();
    const plans = await this.planRepository.find({
      where: { userId, weekStart: MoreThanOrEqual(fromIso) },
    });

    await this.deletePlans(plans);
  }

  async deleteFuturePlansForGoal(userId: string, goalId: string, from: Date) {
    const fromIso = this.getWeekStart(from).toISOString();
    const plans = await this.planRepository.find({
      where: { userId, goalId, weekStart: MoreThanOrEqual(fromIso) },
    });

    await this.deletePlans(plans);
  }

  async regenerateFromGoal(
    goal: Goal,
    options?: { startDate?: Date },
  ): Promise<generateFromGoalResult> {
    const startDate = options?.startDate ?? new Date();
    const startWeek = this.getWeekStart(startDate);

    await this.deleteFuturePlansForUser(goal.userId, startWeek);

    const profile = await this.athleteProfileService.build(goal.userId, goal);
    const pattern = profile.pattern;
    const preferences = this.buildWorkoutPreferences(pattern);
    const raceKm = goal.targetDistance / 1000;
    const targetDate = new Date(goal.targetDate);

    const totalWeeks = Math.max(
      Math.ceil(
        (targetDate.getTime() - startWeek.getTime()) /
          (7 * 24 * 60 * 60 * 1000),
      ),
      1,
    );

    const { paces, assessment } = this.buildPaces(goal, profile, totalWeeks);
    const targetNote = assessment
      ? this.describeRaceTarget(assessment, totalWeeks)
      : undefined;

    const volume = this.buildVolumePlan({
      goal,
      profile,
      raceKm,
      totalWeeks,
    });

    const runDays = this.resolveRunDays(goal, pattern);
    const longRunDay = this.resolveLongRunDay(goal, runDays, pattern);
    const qualityCount = this.qualitySessionsPerWeek(
      profile.level,
      runDays,
      pattern,
    );
    const fastStart =
      profile.hasData &&
      (profile.level === 'intermediate' || profile.level === 'advanced');
    let patternNote: string | undefined;

    const plans: TrainingPlan[] = [];
    const summaries: WeekSummary[] = [];
    const phaseWeekIndexes: Record<PlanPhase, number> = {
      base: 0,
      build: 0,
      peak: 0,
      taper: 0,
    };

    for (let weekIndex = 0; weekIndex < totalWeeks; weekIndex++) {
      const phase = resolvePhase(weekIndex, totalWeeks, fastStart);
      const isDeload = this.isDeloadWeek(weekIndex, totalWeeks);
      const weeklyKm = volume.weeklyKm[weekIndex];
      const longKm = volume.longKm[weekIndex];

      const workouts = this.fitWorkoutsToHistory(
        selectWeekWorkouts({
          level: profile.level,
          phase,
          phaseWeekIndex: phaseWeekIndexes[phase],
          globalWeekIndex: weekIndex,
          raceKm,
          hasSecondaryDay: qualityCount >= 2,
          deload: isDeload,
          preferences,
        }),
        paces,
        pattern,
        profile.level,
        phase,
      );
      phaseWeekIndexes[phase] += 1;

      const layout = this.buildWeekLayout({
        runDays,
        longRunDay,
        daysPerWeek: this.resolveDaysPerWeek(goal, runDays, pattern),
        weekIndex,
        qualityCount,
        pattern,
      });

      if (weekIndex === 0) {
        patternNote = this.describeTrainingPattern(
          pattern,
          layout,
          qualityCount,
        );
      }

      const weekStart = new Date(startWeek);
      weekStart.setDate(weekStart.getDate() + weekIndex * 7);
      const weekStartIso = weekStart.toISOString();

      const sessions = this.buildWeekSessions({
        goal,
        phase,
        isDeload,
        weeklyKm,
        longKm,
        layout,
        workouts,
        paces,
        weekStart,
        weekIndex,
      });

      const plan = this.planRepository.create({
        userId: goal.userId,
        goalId: goal.id,
        weekStart: weekStartIso,
      });

      const savedPlan = await this.planRepository.save(plan);

      for (const session of sessions) {
        session.planId = savedPlan.id;
      }

      savedPlan.sessions = await this.sessionRepository.save(sessions);
      plans.push(savedPlan);

      summaries.push({
        weekStart: weekStartIso,
        phase,
        weeklyKm: Math.round(weeklyKm),
        longKm: Math.round(longKm * 10) / 10,
        workouts: [workouts.primary.label, workouts.secondary?.label].filter(
          (w): w is string => !!w,
        ),
      });
    }

    const firstWeekNotes = [patternNote, targetNote]
      .filter((part): part is string => !!part)
      .join('\n\n');

    if (firstWeekNotes && plans.length > 0) {
      await this.planRepository.update(plans[0].id, {
        coachNotes: firstWeekNotes,
      });
      plans[0].coachNotes = firstWeekNotes;
    }

    this.enrichPlanWithAi(
      goal,
      profile,
      paces,
      plans,
      summaries,
      assessment,
      targetNote,
      patternNote,
    ).catch((err) => console.error('Erro ao enriquecer plano com IA:', err));

    this.backfillRecentActivities(goal.userId, startWeek);

    return { plans };
  }

  private backfillRecentActivities(userId: string, startWeek: Date): void {
    const since = new Date(startWeek);
    since.setDate(since.getDate() - 1);

    this.activityRepository
      .find({
        where: {
          user: { id: userId },
          start_date: MoreThanOrEqual(since),
        },
        order: { start_date: 'DESC' },
        take: 50,
      })
      .then(async (activities) => {
        for (const activity of activities) {
          const sport = activity.sport_type ?? activity.type;
          if (!['Run', 'TrailRun', 'VirtualRun'].includes(sport)) continue;

          try {
            const linked = await this.sessionRepository.count({
              where: { activityId: activity.id },
            });
            if (linked > 0) continue;

            await this.activityMatcher.matchActivity(userId, activity);
          } catch (err) {
            console.error(
              'Erro ao vincular atividade no backfill:',
              (err as Error).message,
            );
          }
        }
      })
      .catch((err: Error) =>
        console.error('Erro ao buscar atividades para backfill:', err.message),
      );
  }

  private async deletePlans(plans: TrainingPlan[]) {
    if (plans.length === 0) return;
    const ids = plans.map((p) => p.id);
    await this.sessionRepository.delete({ planId: In(ids) });
    await this.planRepository.delete({ id: In(ids) });
  }

  private buildVolumePlan(opts: {
    goal: Goal;
    profile: AthleteProfile;
    raceKm: number;
    totalWeeks: number;
  }): { weeklyKm: number[]; longKm: number[] } {
    const { goal, profile, raceKm, totalWeeks } = opts;

    const tablePeak = this.peakWeeklyVolume(raceKm, profile.level);
    const goalLongKm = goal.longestRunDistance
      ? goal.longestRunDistance / 1000
      : 0;
    const longCap = this.longRunCap(raceKm, profile.level);

    const recentLong =
      profile.longestRunKm > 0 ? profile.longestRunKm : goalLongKm;
    const longFloor = Math.min(recentLong, longCap);
    const weeklyForLong = (longKmValue: number) =>
      longKmValue <= 0 ? 0 : longKmValue / 0.62;

    const peakCap =
      profile.peakWeeklyKm > 0
        ? profile.peakWeeklyKm * 1.05
        : Number.POSITIVE_INFINITY;
    const fallbackWeekly = Math.max(10, tablePeak * 0.5);
    const recentWeekly =
      profile.recentWeeklyKm > 0 ? profile.recentWeeklyKm : fallbackWeekly;

    const startWeekly = Math.min(
      Math.max(recentWeekly, fallbackWeekly * 0.7, weeklyForLong(longFloor)),
      peakCap,
      tablePeak * 1.6,
    );
    const targetPeak = Math.min(
      Math.max(tablePeak, startWeekly * 1.15),
      startWeekly * 1.5,
    );

    const weeklyKm: number[] = [];
    const longKm: number[] = [];

    let weekly = startWeekly;
    let long = Math.min(Math.max(longFloor, startWeekly * 0.28), longCap);

    for (let i = 0; i < totalWeeks; i++) {
      const isTaper = i >= totalWeeks - 2;
      const isLast = i === totalWeeks - 1;
      const isDeload = this.isDeloadWeek(i, totalWeeks);

      if (isTaper) {
        const factor = isLast ? 0.55 : 0.75;
        const taperLong = Math.max(
          0,
          Math.min(long * (isLast ? 0.5 : 0.7), longCap),
        );
        const taperWeekly = Math.max(startWeekly * 0.4, weekly * factor);
        weeklyKm.push(Math.max(taperWeekly, weeklyForLong(taperLong)));
        longKm.push(taperLong);
      } else if (isDeload) {
        const deloadLong = Math.min(
          Math.max(long * 0.72, longFloor * 0.85),
          longCap,
        );
        weeklyKm.push(Math.max(weekly * 0.72, weeklyForLong(deloadLong)));
        longKm.push(deloadLong);
      } else {
        const nextLong = Math.min(
          Math.max(long * 1.07 + 0.5, longFloor),
          longCap,
        );
        const weekWeekly = Math.max(weekly, weeklyForLong(nextLong));
        weeklyKm.push(weekWeekly);
        longKm.push(nextLong);
        weekly = Math.min(weekWeekly * 1.08, Math.max(targetPeak, weekWeekly));
        long = nextLong;
      }
    }

    return { weeklyKm, longKm };
  }

  private buildWeekSessions(opts: {
    goal: Goal;
    phase: PlanPhase;
    isDeload: boolean;
    weeklyKm: number;
    longKm: number;
    layout: WeekLayout[];
    workouts: { primary: QualityWorkout; secondary?: QualityWorkout };
    paces: PaceSet;
    weekStart: Date;
    weekIndex: number;
  }): TrainingSession[] {
    const {
      goal,
      phase,
      isDeload,
      weeklyKm,
      longKm,
      layout,
      workouts,
      paces,
      weekStart,
      weekIndex,
    } = opts;

    const q1 = this.qualityTotals(workouts.primary, paces);
    const q2 = workouts.secondary
      ? this.qualityTotals(workouts.secondary, paces)
      : undefined;

    const scale = isDeload ? 0.6 : 1;

    const normalizedLayout = layout.map((entry) =>
      entry.role === 'quality2' && !workouts.secondary
        ? { day: entry.day, role: 'easy' as const }
        : entry,
    );

    const easyDays = normalizedLayout.filter((d) => d.role === 'easy');
    const recoveryDays = normalizedLayout.filter((d) => d.role === 'recovery');
    const qualityDays = normalizedLayout.filter(
      (d) => d.role === 'quality1' || d.role === 'quality2',
    );

    let qualityTotal =
      (qualityDays.some((d) => d.role === 'quality1') ? q1.total * scale : 0) +
      (qualityDays.some((d) => d.role === 'quality2') && q2
        ? q2.total * scale
        : 0);

    let easyRemaining = weeklyKm - longKm - qualityTotal;
    const easyCount = easyDays.length + recoveryDays.length;

    if (easyCount > 0 && easyRemaining < easyCount * MIN_EASY_KM) {
      const available = Math.max(
        weeklyKm - longKm - easyCount * MIN_EASY_KM,
        0,
      );
      const fitScale =
        qualityTotal > 0
          ? Math.max(0.4, Math.min(1, available / qualityTotal))
          : 1;
      qualityTotal *= fitScale;
      easyRemaining = weeklyKm - longKm - qualityTotal;
    }

    const recoveryWeight = 0.75;
    const unitWeight = easyDays.length + recoveryDays.length * recoveryWeight;
    const perUnitKm =
      unitWeight > 0 ? Math.max(0, easyRemaining) / unitWeight : 0;

    const sessions: TrainingSession[] = [];
    const raceDay = this.findRaceDay(goal, weekStart);

    for (const { day, role } of normalizedLayout) {
      if (raceDay === day) {
        sessions.push(
          this.createSession({
            day,
            type: 'race',
            distance: goal.targetDistance,
            pace: paces.goal,
            notes: `Dia da prova: ${goal.title}. Aquecimento leve e confie no plano. Pace alvo ${this.formatPace(paces.goal)}/km.${goal.targetTime ? ` Tempo alvo: ${formatRaceTime(goal.targetTime)}.` : ''}`,
          }),
        );
        continue;
      }

      const proximity = this.raceProximity(goal, weekStart, day);

      if (proximity === 'after') {
        sessions.push(
          this.createSession({
            day,
            type: 'rest',
            distance: 0,
            pace: 0,
            notes: 'Pós-prova: descanse e comemore. Recuperação total.',
          }),
        );
        continue;
      }

      if (role === 'rest') {
        sessions.push(
          this.createSession({
            day,
            type: 'rest',
            distance: 0,
            pace: 0,
            notes: 'Descanso — recuperação também é treino.',
          }),
        );
        continue;
      }

      if (role === 'long') {
        if (proximity === 'dayBefore') {
          sessions.push(
            this.createSession({
              day,
              type: 'easy',
              distance: 4000,
              pace: paces.easy,
              notes:
                'Trote leve de 4.0km na véspera da prova, com 4 retas de 20s no final para soltar as pernas. Confie no trabalho feito.',
            }),
          );
          continue;
        }

        const { distance, notes } = this.longRunSession({
          km: longKm,
          paces,
          raceKm: goal.targetDistance / 1000,
          phase,
          weekIndex,
        });
        sessions.push(
          this.createSession({
            day,
            type: 'long_run',
            distance,
            pace: paces.easy,
            notes,
          }),
        );
        continue;
      }

      if (role === 'quality1' || role === 'quality2') {
        const workout =
          role === 'quality1' ? workouts.primary : workouts.secondary;
        if (workout) {
          sessions.push(this.qualitySession(day, workout, paces, isDeload));
          continue;
        }
      }

      const isRecovery = role === 'recovery';
      const km = isRecovery ? perUnitKm * recoveryWeight : perUnitKm;
      const distance = Math.max(2000, Math.round((km * 1000) / 100) * 100);
      const pace = isRecovery ? paces.recovery : paces.easy;
      const notes = isRecovery
        ? `Recuperação de ${(distance / 1000).toFixed(1)}km bem leve (${this.formatPace(pace)}/km) — solte as pernas.`
        : `Corrida leve de ${(distance / 1000).toFixed(1)}km em ritmo de conversa (${this.formatPace(pace)}/km).`;

      sessions.push(
        this.createSession({
          day,
          type: isRecovery ? 'recovery' : 'easy',
          distance,
          pace,
          notes,
        }),
      );
    }

    return sessions;
  }

  private qualitySession(
    day: string,
    workout: QualityWorkout,
    paces: PaceSet,
    isDeload: boolean,
  ): TrainingSession {
    const totals = this.qualityTotals(workout, paces);
    const scale = isDeload ? 0.6 : 1;
    const mainKm = totals.mainKm * scale;
    const distance = Math.max(
      3000,
      Math.round(
        ((totals.wu + totals.extra + totals.cd + mainKm) * 1000) / 100,
      ) * 100,
    );

    const pace = this.clamp(
      Math.round(paces[workout.paceRef] + workout.paceAdjust),
      MIN_PACE,
      MAX_PACE,
    );

    let notes = workout.notes
      .replace('{pace}', this.formatPace(pace))
      .replace('{goalPace}', this.formatPace(paces.goal))
      .replace('{mainMin}', String(workout.mainMinutes ?? ''));

    if (isDeload) {
      notes = `Semana de deload — volume reduzido. ${notes}`;
    }

    notes = `Aquecimento ${totals.wu}km + ${notes} + desaquecimento ${totals.cd}km.`;

    return this.createSession({
      day,
      type: workout.type,
      distance,
      pace,
      notes,
    });
  }

  private buildWorkoutPreferences(
    pattern?: TrainingPattern,
  ): WorkoutPreferences | undefined {
    if (!pattern?.hasData) return undefined;

    const qualityTypes = (
      Object.keys(pattern.typicalQuality) as QualityRunType[]
    ).filter((type) => !!pattern.typicalQuality[type]);
    if (qualityTypes.length === 0) return undefined;

    const ranked = [...qualityTypes].sort(
      (a, b) => pattern.typeMix[b] - pattern.typeMix[a],
    );

    const typicalReps: WorkoutPreferences['typicalReps'] = {};
    const typicalMainKm: WorkoutPreferences['typicalMainKm'] = {};

    for (const type of qualityTypes) {
      const typical = pattern.typicalQuality[type];
      if (!typical) continue;

      if (typical.reps.length > 0) typicalReps[type] = typical.reps;
      typicalMainKm[type] = Math.max(1, typical.km - 3.5);
    }

    return {
      primaryType: ranked[0],
      secondaryType: ranked[1],
      typicalReps,
      typicalMainKm,
    };
  }

  private fitWorkoutsToHistory(
    workouts: { primary: QualityWorkout; secondary?: QualityWorkout },
    paces: PaceSet,
    pattern: TrainingPattern | undefined,
    level: AthleteLevel,
    phase: PlanPhase,
  ): { primary: QualityWorkout; secondary?: QualityWorkout } {
    const fit = (workout?: QualityWorkout): QualityWorkout | undefined => {
      if (!workout || workout.key.startsWith('race-specific')) return workout;

      const typical = pattern?.typicalQuality[workout.type];
      if (!typical || typical.km <= 0) return workout;

      const cap = typical.km * 1.35;
      const pool = new Map(
        [
          ...phaseWorkoutPool(level, phase),
          ...workoutsOfType(workout.type),
        ].map((candidate) => [candidate.key, candidate]),
      );
      const entries = [...pool.values()]
        .filter((candidate) => candidate.type === workout.type)
        .map((candidate) => ({
          candidate,
          total: this.qualityTotals(candidate, paces).total,
        }));

      const selected =
        entries.find((entry) => entry.candidate.key === workout.key) ??
        entries[0];
      if (!selected) return workout;
      if (selected.total <= cap) return workout;

      const smaller = entries
        .filter((entry) => entry.total <= cap)
        .sort((a, b) => b.total - a.total)[0];

      if (smaller) return smaller.candidate;

      return entries.sort((a, b) => a.total - b.total)[0]?.candidate ?? workout;
    };

    return {
      primary: fit(workouts.primary) ?? workouts.primary,
      secondary: fit(workouts.secondary),
    };
  }

  private describeTrainingPattern(
    pattern: TrainingPattern | undefined,
    layout: WeekLayout[],
    qualityCount: number,
  ): string | undefined {
    if (!pattern?.hasData) return undefined;

    const format = (days: string[]) => days.filter(Boolean).join('/');
    const qualityDays = layout
      .filter((entry) => entry.role === 'quality1' || entry.role === 'quality2')
      .map((entry) => entry.day);
    const recoveryDays = layout
      .filter((entry) => entry.role === 'recovery')
      .map((entry) => entry.day);
    const easyDays = layout
      .filter((entry) => entry.role === 'easy')
      .map((entry) => entry.day);
    const longDay = layout.find((entry) => entry.role === 'long')?.day;

    const structure = [
      qualityDays.length > 0
        ? `${qualityCount}x qualidade (${format(qualityDays)})`
        : undefined,
      recoveryDays.length > 0
        ? `regenerativo ${format(recoveryDays)}`
        : undefined,
      easyDays.length > 0 ? `leve ${format(easyDays)}` : undefined,
      longDay ? `longão ${longDay}` : undefined,
    ]
      .filter((part): part is string => !!part)
      .join(', ');

    const historicalQuality = pattern.preferredQualityDays;
    const adjusted =
      historicalQuality.length > 0 &&
      qualityDays.some((day) => !historicalQuality.includes(day));

    const base = `Seu histórico mostra cerca de ${pattern.runsPerWeek}x corrida por semana e longão${pattern.preferredLongRunDay ? ` em ${pattern.preferredLongRunDay}` : 's'}. Mantive sua estrutura: ${structure}.`;

    if (adjusted) {
      return `${base} Ajustei os dias de qualidade (seu histórico: ${format(historicalQuality)}) para garantir recuperação entre os estímulos.`;
    }

    return base;
  }

  private longRunSession(opts: {
    km: number;
    paces: PaceSet;
    raceKm: number;
    phase: PlanPhase;
    weekIndex: number;
  }): { distance: number; notes: string } {
    const { km, paces, raceKm, phase, weekIndex } = opts;
    const distance = Math.max(0, Math.round((km * 1000) / 100) * 100);
    const easyStr = this.formatPace(paces.easy);
    const goalStr = this.formatPace(paces.goal);
    const distKm = (distance / 1000).toFixed(1);

    if (distance === 0) {
      return {
        distance,
        notes: 'Descanso — recuperação também é treino.',
      };
    }

    const canBlock =
      (phase === 'build' || phase === 'peak') && distance >= 10000;
    const hasBlock = canBlock && weekIndex % 2 === 0;

    if (hasBlock && raceKm <= 11) {
      const blockKm = Math.min(3, Math.round(distance * 0.25) / 1000) * 1;
      const block = Math.max(2, Math.round(blockKm * 10) / 10);
      return {
        distance,
        notes: `Longão de ${distKm}km em ritmo de conversa (${easyStr}/km). Últimos ${block.toFixed(1)}km no pace da prova (${goalStr}/km).`,
      };
    }

    if (hasBlock && raceKm <= 22) {
      const block = Math.max(3, Math.round(km * 0.25 * 10) / 10);
      return {
        distance,
        notes: `Longão de ${distKm}km em ritmo de conversa (${easyStr}/km), com 2x${block.toFixed(1)}km no pace da prova (${goalStr}/km) e 1km leve entre os blocos.`,
      };
    }

    if (hasBlock && raceKm > 22) {
      const block = Math.max(5, Math.round(km * 0.3 * 10) / 10);
      return {
        distance,
        notes: `Longão de ${distKm}km em ritmo de conversa (${easyStr}/km). Bloco final de ${block.toFixed(1)}km no pace da prova (${goalStr}/km).`,
      };
    }

    return {
      distance,
      notes: `Longão de ${distKm}km em ritmo de conversa (${easyStr}/km). Progressivo: comece bem leve e feche um pouco mais forte.`,
    };
  }

  private createSession(opts: {
    day: string;
    type: string;
    distance: number;
    pace: number;
    notes: string;
  }): TrainingSession {
    const isRest = opts.type === 'rest';
    const distance = Number.isFinite(opts.distance)
      ? Math.max(0, opts.distance)
      : 0;
    const pace = isRest
      ? 0
      : this.clamp(
          Number.isFinite(opts.pace) && opts.pace > 0 ? opts.pace : MIN_PACE,
          MIN_PACE,
          MAX_PACE,
        );

    return this.sessionRepository.create({
      day: opts.day,
      dayOrder: DAY_ORDER[opts.day] ?? 0,
      type: opts.type,
      plannedDistance: distance,
      plannedPace: Math.round(pace),
      notes: opts.notes,
      completed: false,
    });
  }

  private buildWeekLayout(opts: {
    runDays: string[];
    longRunDay: string;
    daysPerWeek: number;
    weekIndex: number;
    qualityCount: number;
    pattern?: TrainingPattern;
  }): WeekLayout[] {
    const {
      runDays,
      longRunDay,
      daysPerWeek,
      weekIndex,
      qualityCount,
      pattern,
    } = opts;

    let trainingDays = Array.from(
      new Set([...runDays, longRunDay].filter((d) => d in DAY_ORDER)),
    ).sort((a, b) => DAY_ORDER[a] - DAY_ORDER[b]);

    if (trainingDays.length > daysPerWeek) {
      const removable = trainingDays.filter((d) => d !== longRunDay);
      const toRemove = trainingDays.length - daysPerWeek;
      const seed = weekIndex * 7;
      for (let i = 0; i < toRemove && removable.length > 0; i++) {
        const idx = (seed + i) % removable.length;
        trainingDays = trainingDays.filter((d) => d !== removable[idx]);
        removable.splice(idx, 1);
      }
      trainingDays.sort((a, b) => DAY_ORDER[a] - DAY_ORDER[b]);
    }

    const candidates = trainingDays.filter((d) => d !== longRunDay);
    const dist = (a: string, b: string) =>
      Math.min(
        (DAY_ORDER[a] - DAY_ORDER[b] + 7) % 7,
        (DAY_ORDER[b] - DAY_ORDER[a] + 7) % 7,
      );

    const qualityPreference = (day: string) =>
      pattern?.qualityDayRate[day] ?? 0;
    const runPreference = (day: string) => pattern?.weekdayRate[day] ?? 0;

    const pickQualityDay = (
      pool: string[],
      base: string,
      used: Set<string>,
      forbidden: string[] = [],
    ): string | undefined => {
      const eligible = pool.filter(
        (day) =>
          !used.has(day) && !forbidden.includes(day) && dist(day, base) >= 2,
      );
      const fallback = pool.filter(
        (day) => !used.has(day) && !forbidden.includes(day),
      );
      const options = eligible.length > 0 ? eligible : fallback;

      return [...options].sort((a, b) => {
        const preferenceGap = qualityPreference(b) - qualityPreference(a);
        if (preferenceGap !== 0) return preferenceGap;

        const spacingGap =
          Math.abs(dist(a, base) - 3) - Math.abs(dist(b, base) - 3);
        if (spacingGap !== 0) return spacingGap;

        return DAY_ORDER[a] - DAY_ORDER[b];
      })[0];
    };

    const used = new Set<string>([longRunDay]);
    const quality1 =
      pickQualityDay(candidates, longRunDay, used) ?? candidates[0];

    let quality2: string | undefined;
    if (qualityCount >= 2 && candidates.length >= 2) {
      quality2 = pickQualityDay(candidates, quality1, used, [quality1]);
    }

    used.add(quality1);
    if (quality2) used.add(quality2);

    const adjacencyBase = quality2 ?? quality1;
    const recovery = candidates
      .filter(
        (day) =>
          !used.has(day) &&
          (dist(day, longRunDay) === 1 || dist(day, adjacencyBase) === 1),
      )
      .sort((a, b) => {
        const rankA = dist(a, longRunDay) === 1 ? 0 : 1;
        const rankB = dist(b, longRunDay) === 1 ? 0 : 1;
        if (rankA !== rankB) return rankA - rankB;

        const preferenceGap = runPreference(b) - runPreference(a);
        if (preferenceGap !== 0) return preferenceGap;

        return DAY_ORDER[a] - DAY_ORDER[b];
      })[0];

    const layout: WeekLayout[] = ALL_DAY_SHORTS.map((day) => {
      if (!trainingDays.includes(day)) return { day, role: 'rest' as const };
      if (day === longRunDay) return { day, role: 'long' as const };
      if (day === quality1) return { day, role: 'quality1' as const };
      if (quality2 && day === quality2) {
        return { day, role: 'quality2' as const };
      }
      if (recovery && day === recovery) {
        return { day, role: 'recovery' as const };
      }
      return { day, role: 'easy' as const };
    });

    return layout;
  }

  private qualityTotals(workout: QualityWorkout, paces: PaceSet) {
    const mainKm = this.workoutMainKm(workout, paces);

    let wu = 2;
    let cd = 1.5;
    let extra = 0;

    if (workout.type === 'fartlek' || workout.key === 'easy-strides') {
      wu = 1.5;
      cd = 1;
    }

    if (workout.type === 'interval') {
      extra = mainKm <= 5 ? mainKm * 0.5 : mainKm * 0.25;
    }

    if (workout.type === 'tempo' && workout.label.startsWith('2x')) {
      extra = 0.5;
    }

    return { wu, cd, extra, mainKm, total: wu + cd + extra + mainKm };
  }

  private workoutMainKm(workout: QualityWorkout, paces: PaceSet): number {
    if (workout.mainKm !== undefined) return workout.mainKm;

    if (workout.mainMinutes !== undefined) {
      return (workout.mainMinutes * 60) / paces[workout.paceRef];
    }

    if (workout.hardMinutes !== undefined) {
      return (
        (workout.hardMinutes * 60) / paces.interval +
        (workout.hardMinutes * 60) / paces.easy
      );
    }

    return 4;
  }

  private buildPaces(
    goal: Goal,
    profile: AthleteProfile,
    totalWeeks: number,
  ): { paces: PaceSet; assessment?: RaceTargetAssessment } {
    const threeKmPace =
      goal.threeKmTime > 0
        ? this.clamp(goal.threeKmTime / 3, MIN_PACE, 420)
        : undefined;

    const shortRefs = [threeKmPace, profile.bestShortPace].filter(
      (pace): pace is number => pace !== undefined,
    );
    const shortRef = shortRefs.length > 0 ? Math.min(...shortRefs) : undefined;

    const pattern = profile.pattern;
    const observedIntervalPace = pattern?.typicalQuality.interval?.repPace;
    const observedTempoPace = pattern?.typicalQuality.tempo?.repPace;

    const intervalCandidates = [
      shortRef ? shortRef * 1.03 : undefined,
      observedIntervalPace ? observedIntervalPace * 1.02 : undefined,
    ].filter((pace): pace is number => pace !== undefined);

    const intervalBase =
      intervalCandidates.length > 0
        ? Math.min(...intervalCandidates)
        : this.defaultIntervalPace(profile.level);

    const thresholdEstimate = shortRef
      ? shortRef * Math.pow(10 / 3, 0.06)
      : intervalBase * 1.06;

    const threshold = this.clamp(
      Math.max(
        thresholdEstimate,
        profile.bestMediumPace ?? 0,
        observedTempoPace ?? 0,
        intervalBase + 5,
      ),
      MIN_PACE + 10,
      480,
    );

    const interval = this.clamp(
      Math.min(intervalBase, threshold - 15),
      MIN_PACE,
      430,
    );

    const easy = this.clamp(threshold + 65, 300, 450);
    const recovery = this.clamp(easy + 20, 320, 480);

    const predictedGoalPace = this.estimateGoalPace(
      goal,
      profile,
      interval,
      threshold,
      threeKmPace,
    );

    let goalPace = predictedGoalPace;
    let assessment: RaceTargetAssessment | undefined;

    if (goal.targetTime && goal.targetTime > 0) {
      const raceKm = Math.max(goal.targetDistance / 1000, 1);
      assessment = assessRaceTarget({
        targetTime: goal.targetTime,
        raceKm,
        predictedPace: predictedGoalPace,
        level: profile.level,
        totalWeeks,
      });
      goalPace = this.clamp(
        assessment.realisticPace,
        interval + 5,
        Math.min(threshold + 120, MAX_PACE),
      );
    }

    return {
      paces: {
        interval: Math.round(interval),
        threshold: Math.round(threshold),
        easy: Math.round(easy),
        recovery: Math.round(recovery),
        goal: Math.round(goalPace),
      },
      assessment,
    };
  }

  private describeRaceTarget(
    assessment: RaceTargetAssessment,
    totalWeeks: number,
  ): string {
    const target = formatRaceTime(assessment.targetTime);
    const predicted = formatRaceTime(assessment.predictedTime);
    const targetPace = this.formatPace(assessment.targetPace);
    const predictedPace = this.formatPace(assessment.predictedPace);
    const weeks = `${totalWeeks} semana${totalWeeks > 1 ? 's' : ''}`;

    if (assessment.verdict === 'conservadora') {
      return `Meta de tempo: ${target} (${targetPace}/km). Seu potencial atual estimado é ${predicted} (${predictedPace}/km) — meta conservadora, com folga para executar bem.`;
    }

    if (assessment.verdict === 'realista') {
      return `Meta de tempo: ${target} (${targetPace}/km). Seu potencial atual estimado é ${predicted} (${predictedPace}/km) — meta realista para as ${weeks} de plano.`;
    }

    const need = Math.round(assessment.requiredImprovement * 100);
    const cap = Math.round(assessment.maxImprovement * 100);
    const realisticPace = this.formatPace(assessment.realisticPace);

    if (assessment.verdict === 'agressiva') {
      return `Meta de tempo: ${target} (${targetPace}/km) é agressiva: exige cerca de ${need}% de melhora, acima do ganho esperado para o seu nível (~${cap}% em ${weeks}). O plano vai trabalhar no pace realista de ${realisticPace}/km e o coach acompanha sua evolução.`;
    }

    return `Meta de tempo: ${target} (${targetPace}/km) está fora do alcance para este ciclo: exige cerca de ${need}% de melhora contra ~${cap}% esperados em ${weeks} (potencial atual: ${predicted} / ${predictedPace}/km). O plano usará o pace realista de ${realisticPace}/km — reavalie a meta depois dos próximos testes.`;
  }

  private estimateGoalPace(
    goal: Goal,
    profile: AthleteProfile,
    interval: number,
    threshold: number,
    threeKmPace?: number,
  ): number {
    const raceKm = Math.max(goal.targetDistance / 1000, 1);
    const refs = buildRaceReferences(profile, threeKmPace);

    const paceFloor =
      raceKm <= 11
        ? threshold - 10
        : raceKm <= 22
          ? threshold + 5
          : threshold + 25;

    const pace = predictRacePace(refs, raceKm);

    if (pace === undefined) {
      return this.clamp(
        Math.max(interval * 1.08, paceFloor),
        MIN_PACE,
        MAX_PACE,
      );
    }

    return this.clamp(
      Math.max(pace, paceFloor),
      Math.max(interval + 5, MIN_PACE),
      Math.min(threshold + 120, MAX_PACE),
    );
  }

  private defaultIntervalPace(level: AthleteLevel): number {
    const defaults: Record<AthleteLevel, number> = {
      beginner: 340,
      novice: 320,
      intermediate: 295,
      advanced: 275,
    };
    return defaults[level];
  }

  private resolveRunDays(goal: Goal, pattern?: TrainingPattern): string[] {
    const days = (goal.runDays ?? [])
      .map((d) => FULL_TO_SHORT[d] ?? d)
      .filter((d) => d in DAY_ORDER);

    if (days.length > 0) return Array.from(new Set(days));

    const preferred = (pattern?.preferredRunDays ?? []).filter(
      (d) => d in DAY_ORDER,
    );
    if (preferred.length > 0) return preferred;

    return ['Seg', 'Ter', 'Qui', 'Sex'];
  }

  private resolveLongRunDay(
    goal: Goal,
    runDays: string[],
    pattern?: TrainingPattern,
  ): string {
    const longDay = goal.longRunDay
      ? (FULL_TO_SHORT[goal.longRunDay] ?? goal.longRunDay)
      : undefined;

    if (longDay && longDay in DAY_ORDER) return longDay;

    const preferred = pattern?.preferredLongRunDay;
    if (preferred && preferred in DAY_ORDER) {
      if ((goal.runDays ?? []).length === 0 || runDays.includes(preferred)) {
        return preferred;
      }
    }

    if (runDays.includes('Sáb')) return 'Sáb';
    if (runDays.includes('Dom')) return 'Dom';
    return runDays[runDays.length - 1];
  }

  private resolveDaysPerWeek(
    goal: Goal,
    runDays: string[],
    pattern?: TrainingPattern,
  ): number {
    const formDays = (goal.runDays ?? []).filter((d) => {
      const short = FULL_TO_SHORT[d] ?? d;
      return short in DAY_ORDER;
    }).length;

    let days: number;

    if (formDays > 0) {
      days = formDays;
    } else if (pattern?.hasData && pattern.runsPerWeek > 0) {
      days = Math.round(pattern.runsPerWeek);
    } else if (goal.daysPerWeek && goal.daysPerWeek > 0) {
      days = goal.daysPerWeek;
    } else {
      days = runDays.length;
    }

    return Math.max(2, Math.min(days, 7));
  }

  private qualitySessionsPerWeek(
    level: AthleteLevel,
    runDays: string[],
    pattern?: TrainingPattern,
  ): number {
    const cap = runDays.length <= 3 ? 1 : 2;

    if (level === 'beginner') return 1;

    const historical =
      pattern?.hasData && pattern.qualityPerWeek > 0
        ? Math.round(pattern.qualityPerWeek)
        : undefined;

    const fallback = level === 'novice' ? 1 : 2;
    const desired = historical ?? fallback;

    return Math.max(1, Math.min(cap, desired));
  }

  private longRunCap(raceKm: number, level: AthleteLevel): number {
    const caps: Record<AthleteLevel, Record<string, number>> = {
      beginner: { '5': 8, '10': 12, '21.1': 15, '42.2': 25 },
      novice: { '5': 10, '10': 14, '21.1': 18, '42.2': 28 },
      intermediate: { '5': 12, '10': 16, '21.1': 21, '42.2': 32 },
      advanced: { '5': 14, '10': 18, '21.1': 24, '42.2': 35 },
    };

    for (const { minKm, key } of DISTANCE_TARGETS) {
      if (raceKm >= minKm) return caps[level][key];
    }
    return caps[level]['5'];
  }

  private peakWeeklyVolume(raceKm: number, level: AthleteLevel): number {
    const volumes: Record<AthleteLevel, Record<string, number>> = {
      beginner: { '5': 18, '10': 25, '21.1': 35, '42.2': 45 },
      novice: { '5': 22, '10': 30, '21.1': 40, '42.2': 55 },
      intermediate: { '5': 25, '10': 35, '21.1': 50, '42.2': 65 },
      advanced: { '5': 28, '10': 40, '21.1': 60, '42.2': 80 },
    };

    for (const { minKm, key } of DISTANCE_TARGETS) {
      if (raceKm >= minKm) return volumes[level][key];
    }
    return Math.max(15, raceKm * 1.5);
  }

  private isDeloadWeek(weekIndex: number, totalWeeks: number): boolean {
    return weekIndex % 4 === 3 && weekIndex > 0 && weekIndex < totalWeeks - 2;
  }

  private raceProximity(
    goal: Goal,
    weekStart: Date,
    day: string,
  ): 'before' | 'dayBefore' | 'after' {
    const race = new Date(goal.targetDate);
    race.setHours(0, 0, 0, 0);

    const date = new Date(weekStart);
    date.setDate(date.getDate() + (DAY_ORDER[day] ?? 0));
    date.setHours(0, 0, 0, 0);

    const diffDays = Math.round(
      (date.getTime() - race.getTime()) / (24 * 60 * 60 * 1000),
    );

    if (diffDays === -1) return 'dayBefore';
    if (diffDays > 0) return 'after';
    return 'before';
  }

  private findRaceDay(goal: Goal, weekStart: Date): string | undefined {
    const race = new Date(goal.targetDate);
    const start = new Date(weekStart);
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 7);

    if (race < start || race >= end) return undefined;
    return ALL_DAY_SHORTS[race.getDay()];
  }

  private getWeekStart(date: Date): Date {
    const start = new Date(date);
    start.setDate(date.getDate() - date.getDay());
    start.setHours(0, 0, 0, 0);
    return start;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private formatPace(secondsPerKm: number): string {
    const safe = this.clamp(Math.round(secondsPerKm), MIN_PACE, MAX_PACE);
    const min = Math.floor(safe / 60);
    const sec = safe % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }

  private async enrichPlanWithAi(
    goal: Goal,
    profile: AthleteProfile,
    paces: PaceSet,
    plans: TrainingPlan[],
    summaries: WeekSummary[],
    assessment?: RaceTargetAssessment,
    targetNote?: string,
    patternNote?: string,
  ) {
    if (!process.env.OPENAI_API_KEY || plans.length === 0) return;

    const pattern = profile.pattern;

    const context = JSON.stringify({
      atleta: {
        nivel: profile.level,
        temHistorico: profile.hasData,
        volumeSemanalRecenteKm: profile.recentWeeklyKm,
        longaoRecenteKm: profile.longestRunKm,
        melhorPace5k: profile.bestShortPace,
        melhorPace10k: profile.bestMediumPace,
        corridasPorSemana: profile.runsPerWeek,
      },
      historicoDoAtleta: pattern?.hasData
        ? {
            amostraDeCorridas: pattern.sampleSize,
            semanasAnalisadas: pattern.weeksAnalyzed,
            confianca: pattern.confidence,
            diasQueCostumaCorrer: pattern.preferredRunDays,
            diasDeQualidade: pattern.preferredQualityDays,
            diaDoLongao: pattern.preferredLongRunDay ?? null,
            corridasPorSemana: pattern.runsPerWeek,
            qualidadePorSemana: pattern.qualityPerWeek,
            mixDeTreinos: pattern.typeMix,
            paceLeveHabitualSegKm: pattern.easyPace ?? null,
            longaoHabitual: pattern.longRun ?? null,
            treinosTipicos: Object.fromEntries(
              Object.entries(pattern.typicalQuality).map(([type, typical]) => [
                type,
                {
                  km: typical?.km,
                  paceSegKm: typical?.pace,
                  paceDeTiroSegKm: typical?.repPace ?? null,
                  repeticoes: typical?.reps,
                },
              ]),
            ),
            ajusteAplicado: patternNote ?? null,
          }
        : null,
      meta: {
        titulo: goal.title,
        provaKm: goal.targetDistance / 1000,
        dataAlvo: goal.targetDate,
        paceObjetivo: this.formatPace(paces.goal),
        diasPorSemana: goal.daysPerWeek,
        diaLongao: goal.longRunDay,
        tempoAlvo: goal.targetTime ? formatRaceTime(goal.targetTime) : null,
        tempoProjetado: assessment
          ? formatRaceTime(assessment.predictedTime)
          : null,
        melhoraNecessariaPct: assessment
          ? Math.round(assessment.requiredImprovement * 100)
          : null,
        ganhoMaximoPct: assessment
          ? Math.round(assessment.maxImprovement * 100)
          : null,
        vereditoMeta: assessment?.verdict ?? null,
        paceRealista: assessment
          ? this.formatPace(assessment.realisticPace)
          : null,
      },
      paces: {
        intervaloSegKm: paces.interval,
        limiarSegKm: paces.threshold,
        leveSegKm: paces.easy,
      },
      semanas: summaries.map((summary, index) => ({
        semana: summary.weekStart.slice(0, 10),
        fase: summary.phase,
        volumeKm: summary.weeklyKm,
        longaoKm: summary.longKm,
        treinosDeQualidade: summary.workouts,
        sessoes: (plans[index]?.sessions ?? []).map((s) => ({
          dia: s.day,
          tipo: s.type,
          km: Math.round((s.plannedDistance / 1000) * 10) / 10,
          paceSegKm: Math.round(s.plannedPace),
        })),
      })),
    });

    const review = await this.aiService.generatePlanReview(context);
    if (!review) return;

    for (const week of review.weeks) {
      const index = summaries.findIndex((s) =>
        s.weekStart.startsWith(week.weekStart.slice(0, 10)),
      );
      if (index < 0) continue;

      const plan = plans[index];

      const coachNotes =
        index === 0
          ? [patternNote, targetNote, review.overview, week.rationale]
              .filter((part): part is string => !!part)
              .join('\n\n')
          : week.rationale;

      await this.planRepository.update(plan.id, {
        focus: week.focus?.slice(0, 120),
        coachNotes: coachNotes?.slice(0, 1200),
      });

      const sessions = (plan.sessions ?? []).sort(
        (a, b) => a.dayOrder - b.dayOrder,
      );

      for (let i = 0; i < sessions.length; i++) {
        const session = sessions[i];
        const tip =
          week.tips.find((t) => t.day === session.day) ?? week.tips[i];
        if (!tip?.text) continue;
        const base = session.notes ?? '';
        await this.sessionRepository.update(session.id, {
          notes: `${base} Dica do Coach: ${tip.text}`.slice(0, 500),
        });
      }
    }
  }
}
