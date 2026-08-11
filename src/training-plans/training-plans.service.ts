import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TrainingPlan } from './entities/training-plan.entity';
import { TrainingSession } from './entities/training-session.entity';
import type { Goal } from 'src/goals/entities/goal.entity';

export interface generateFromGoalResult {
  plans: TrainingPlan[];
}

type AthleteLevel = 'beginner' | 'novice' | 'intermediate' | 'advanced';

const DAY_ORDER: Record<string, number> = {
  Dom: 0,
  Seg: 1,
  Ter: 2,
  Qua: 3,
  Qui: 4,
  Sex: 5,
  Sáb: 6,
};

const SHORT_TO_FULL: Record<string, string> = {
  Dom: 'Domingo',
  Seg: 'Segunda',
  Ter: 'Terça',
  Qua: 'Quarta',
  Qui: 'Quinta',
  Sex: 'Sexta',
  Sáb: 'Sábado',
};

const FULL_TO_SHORT: Record<string, string> = {
  Domingo: 'Dom',
  Segunda: 'Seg',
  Terça: 'Ter',
  Quarta: 'Qua',
  Quinta: 'Qui',
  Sexta: 'Sex',
  Sábado: 'Sáb',
};

@Injectable()
export class TrainingPlansService {
  constructor(
    @InjectRepository(TrainingPlan)
    private readonly planRepository: Repository<TrainingPlan>,
    @InjectRepository(TrainingSession)
    private readonly sessionRepository: Repository<TrainingSession>,
  ) {}

  async findCurrent(userId: string) {
    const now = new Date();
    const weekStart = this.getWeekStart(now);

    const plan = await this.planRepository.findOne({
      where: { userId, weekStart: weekStart.toISOString() },
      relations: ['sessions'],
      order: { sessions: { dayOrder: 'ASC' } as any },
    });

    return plan;
  }

  async findAll(userId: string) {
    return this.planRepository.find({
      where: { userId },
      relations: ['sessions'],
      order: { weekStart: 'ASC', sessions: { dayOrder: 'ASC' } as any },
    });
  }

  async findByWeek(userId: string, weekStart: string) {
    return this.planRepository.findOne({
      where: { userId, weekStart },
      relations: ['sessions'],
      order: { sessions: { dayOrder: 'ASC' } as any },
    });
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

  async generateFromGoal(goal: Goal): Promise<generateFromGoalResult> {
    const userId = goal.userId;
    const today = new Date();
    const targetDate = new Date(goal.targetDate);
    const totalDays = Math.ceil(
      (targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
    const totalWeeks = Math.max(Math.ceil(totalDays / 7), 2);

    const runDays =
      goal.runDays && goal.runDays.length > 0
        ? goal.runDays
        : ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
    const longRunDay = goal.longRunDay || 'Sáb';
    const daysPerWeek = goal.daysPerWeek || runDays.length;

    const level = this.classifyLevel(goal.longestRunDistance);
    const threeKmPace = goal.threeKmTime / 3000;
    const estMarathonPace = this.estimatePace(threeKmPace, 42195, 3000);
    const est10kPace = this.estimatePace(threeKmPace, 10000, 3000);

    const peakWeeklyKm = this.peakWeeklyVolume(goal.targetDistance, level);
    const startWeeklyKm = Math.max(8, peakWeeklyKm * 0.55);

    const plans: TrainingPlan[] = [];

    for (let weekIndex = 0; weekIndex < totalWeeks; weekIndex++) {
      const weekDate = new Date(today);
      weekDate.setDate(today.getDate() + weekIndex * 7);
      const weekStart = this.getWeekStart(weekDate);

      const progress = weekIndex / (totalWeeks - 1);
      const linearFactor =
        startWeeklyKm +
        (peakWeeklyKm - startWeeklyKm) * Math.pow(progress, 0.8);
      const isDeload =
        weekIndex % 4 === 3 && weekIndex > 0 && weekIndex < totalWeeks - 2;
      const isTaper = weekIndex >= totalWeeks - 2;
      const weeklyKm = isTaper
        ? linearFactor * 0.6
        : isDeload
          ? linearFactor * 0.7
          : linearFactor;
      const weeklyMeters = weeklyKm * 1000;

      const plan = this.planRepository.create({
        userId,
        goalId: goal.id,
        weekStart: weekStart.toISOString(),
      });
      const savedPlan = await this.planRepository.save(plan);

      const sessionDays = this.buildSessionDays(
        runDays,
        longRunDay,
        daysPerWeek,
        weekIndex,
      );
      const longRunKm = Math.min(
        weeklyKm * 0.33,
        this.maxLongRun(goal.targetDistance, level),
      );
      const otherKm = weeklyKm - longRunKm;
      const runDayCount = sessionDays.filter((d) => d.type !== 'rest').length;
      const perRunKm = runDayCount > 1 ? otherKm / (runDayCount - 1) : 0;

      const totalRuns = sessionDays.filter((d) => d.type !== 'rest').length;
      const speedCount = Math.max(1, Math.round(totalRuns * 0.2));

      let speedAssigned = 0;
      const sessions: TrainingSession[] = [];

      for (const dayInfo of sessionDays) {
        const dayName = dayInfo.day;
        const isLong = dayName === longRunDay;
        const isRest = dayInfo.type === 'rest';

        let distanceMeters: number;
        let type: string;
        let paceSeconds: number;
        let notes: string | undefined;

        if (isRest) {
          distanceMeters = 0;
          type = 'rest';
          paceSeconds = 0;
          notes = 'Dia de descanso ativo';
        } else if (isLong) {
          distanceMeters = Math.round(longRunKm * 1000);
          type = 'long_run';
          paceSeconds = Math.round(estMarathonPace + 40);
          const distKm = (distanceMeters / 1000).toFixed(1);
          notes = `Longão de ${distKm}km — ritmo de conversa, mantenha abaixo de ${this.formatPace(paceSeconds)}/km`;
        } else {
          const isSpeed = speedAssigned < speedCount;
          if (isSpeed) {
            const intervalDist = Math.round(perRunKm * 800);
            const repMeters = this.chooseRepDistance(intervalDist);
            const numReps = Math.max(2, Math.round(intervalDist / repMeters));
            const actualDist = numReps * repMeters;
            distanceMeters = actualDist;
            type = 'interval';
            paceSeconds = Math.round(threeKmPace - 10);
            const paceStr = this.formatPace(paceSeconds);
            notes = `${numReps}x${repMeters}m no pace ${paceStr}/km com 1:30 de descanso`;
            speedAssigned++;
          } else {
            distanceMeters = Math.round(perRunKm * 1000);
            type = 'easy';
            paceSeconds = Math.round(estMarathonPace + 60);
            if (paceSeconds > 420) paceSeconds = 420;
            const distKm = (distanceMeters / 1000).toFixed(1);
            notes = `Corrida leve de ${distKm}km — ritmo de conversa`;
          }
        }

        const session = this.sessionRepository.create({
          planId: savedPlan.id,
          day: dayName,
          dayOrder: DAY_ORDER[dayName] ?? 0,
          type,
          plannedDistance: Math.max(0, distanceMeters),
          plannedPace: paceSeconds,
          notes,
          completed: false,
        });
        sessions.push(session);
      }

      savedPlan.sessions = await this.sessionRepository.save(sessions);
      plans.push(savedPlan);
    }

    return { plans };
  }

  private classifyLevel(longestRunDistance?: number | null): AthleteLevel {
    if (!longestRunDistance || longestRunDistance < 5000) return 'beginner';
    if (longestRunDistance < 10000) return 'novice';
    if (longestRunDistance < 21097) return 'intermediate';
    return 'advanced';
  }

  private estimatePace(
    referencePaceSecPerM: number,
    targetDist: number,
    refDist: number,
  ): number {
    const refTime = referencePaceSecPerM * refDist;
    const estimatedTime = refTime * Math.pow(targetDist / refDist, 1.06);
    return estimatedTime / targetDist;
  }

  private peakWeeklyVolume(
    targetDistance: number,
    level: AthleteLevel,
  ): number {
    const goalKm = targetDistance / 1000;

    const volumes: Record<AthleteLevel, Record<string, number>> = {
      beginner: { '5': 18, '10': 25, '21.1': 35, '42.2': 45 },
      novice: { '5': 22, '10': 30, '21.1': 40, '42.2': 55 },
      intermediate: { '5': 25, '10': 35, '21.1': 50, '42.2': 65 },
      advanced: { '5': 28, '10': 40, '21.1': 60, '42.2': 80 },
    };

    const thresholds = [42.2, 21.1, 10, 5];
    for (const t of thresholds) {
      if (goalKm >= t) return volumes[level][String(t)];
    }
    return Math.max(15, goalKm * 1.5);
  }

  private maxLongRun(targetDistance: number, level: AthleteLevel): number {
    const goalKm = targetDistance / 1000;
    const caps: Record<AthleteLevel, Record<string, number>> = {
      beginner: { '5': 8, '10': 10, '21.1': 14, '42.2': 20 },
      novice: { '5': 10, '10': 12, '21.1': 18, '42.2': 26 },
      intermediate: { '5': 12, '10': 14, '21.1': 22, '42.2': 32 },
      advanced: { '5': 14, '10': 16, '21.1': 26, '42.2': 35 },
    };

    const thresholds = [42.2, 21.1, 10, 5];
    for (const t of thresholds) {
      if (goalKm >= t) return caps[level][String(t)];
    }
    return Math.min(goalKm * 0.6, caps[level]['5']);
  }

  private chooseRepDistance(totalIntervalMeters: number): number {
    if (totalIntervalMeters < 2400) return 400;
    if (totalIntervalMeters < 5000) return 800;
    return 1000;
  }

  private formatPace(secondsPerKm: number): string {
    const min = Math.floor(secondsPerKm / 60);
    const sec = secondsPerKm % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }

  private buildSessionDays(
    runDays: string[],
    longRunDay: string,
    daysPerWeek: number,
    weekIndex: number,
  ) {
    const allDays = [
      'Domingo',
      'Segunda',
      'Terça',
      'Quarta',
      'Quinta',
      'Sexta',
      'Sábado',
    ];

    const shortRunDays = runDays.map((d) => FULL_TO_SHORT[d] || d);
    const shortLongRun = FULL_TO_SHORT[longRunDay] || longRunDay;

    const days: { day: string; type: 'run' | 'rest' }[] = [];

    for (const fullDay of allDays) {
      const short = FULL_TO_SHORT[fullDay];
      if (short === shortLongRun || shortRunDays.includes(short)) {
        days.push({ day: short, type: 'run' });
      } else {
        days.push({ day: short, type: 'rest' });
      }
    }

    const runCount = days.filter((d) => d.type === 'run').length;
    if (runCount > daysPerWeek) {
      const nonLongRunDays = days.filter(
        (d) => d.day !== shortLongRun && d.type === 'run',
      );
      const toRemove = runCount - daysPerWeek;
      const seed = weekIndex * 7;
      for (let i = 0; i < toRemove; i++) {
        const idx = (seed + i) % nonLongRunDays.length;
        nonLongRunDays[idx].type = 'rest';
        nonLongRunDays.splice(idx, 1);
      }
    }

    return days;
  }

  private getWeekStart(date: Date): Date {
    const start = new Date(date);
    start.setDate(date.getDate() - date.getDay());
    start.setHours(0, 0, 0, 0);
    return start;
  }
}
