import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TrainingPlan } from './entities/training-plan.entity';
import { TrainingSession } from './entities/training-session.entity';

const TRIGGER_MIN_OVERSHOOT_KM = 1;
const TRIGGER_OVERSHOOT_RATIO = 0.15;
const WEEK_TOLERANCE = 0.05;
const MIN_EASY_M = 3000;
const LONG_FLOOR_RATIO = 0.6;
const QUALITY_MAX_CUT_RATIO = 0.1;

const TYPE_PRIORITY: Record<string, number> = {
  recovery: 0,
  easy: 0,
  long_run: 1,
  interval: 2,
  tempo: 2,
  fartlek: 2,
};

export interface OvershootInput {
  planId: string;
  day: string;
  type: string;
  plannedDistance?: number | null;
  actualDistance?: number | null;
}

@Injectable()
export class VolumeAdjustmentService {
  constructor(
    @InjectRepository(TrainingPlan)
    private readonly planRepository: Repository<TrainingPlan>,
    @InjectRepository(TrainingSession)
    private readonly sessionRepository: Repository<TrainingSession>,
  ) {}

  async adjustForOvershoot(session: OvershootInput): Promise<void> {
    const plan = await this.planRepository.findOne({
      where: { id: session.planId },
      relations: ['sessions'],
    });
    if (!plan) return;

    const currentWeekStart = this.getWeekStart(new Date());
    if (plan.weekStart !== currentWeekStart.toISOString()) return;

    const plannedKm = (session.plannedDistance ?? 0) / 1000;
    const actualKm = (session.actualDistance ?? 0) / 1000;
    const overshootKm = actualKm - plannedKm;

    if (plannedKm <= 0) return;
    if (overshootKm < TRIGGER_MIN_OVERSHOOT_KM) return;
    if (overshootKm / plannedKm <= TRIGGER_OVERSHOOT_RATIO) return;

    const sessions = plan.sessions ?? [];

    const baselineM =
      plan.plannedWeeklyKm && plan.plannedWeeklyKm > 0
        ? plan.plannedWeeklyKm
        : this.sumDistance(sessions.filter((item) => item.type !== 'rest'));

    if (baselineM <= 0) return;

    const { bankedM, remainingM, remainingSessions } = this.partitionWeek(
      plan,
      sessions,
    );

    const projectedM = bankedM + remainingM;
    const ceilingM = Math.round(baselineM * (1 + WEEK_TOLERANCE));
    const overM = projectedM - ceilingM;

    if (overM <= 0) return;

    const cuts = this.distributeCut(remainingSessions, overM);
    if (cuts.length === 0) return;

    const dayLabel = session.day;
    const sessionType = session.type;
    const reason =
      `Você correu ${overshootKm.toFixed(1)} km além do planejado em ` +
      `${dayLabel} (${sessionType}). Reduzimos os treinos restantes da semana para ` +
      `proteger a recuperação e evitar excesso de volume.`;

    for (const cut of cuts) {
      cut.session.plannedDistance = Math.max(
        cut.floor,
        (cut.session.plannedDistance ?? 0) - cut.amount,
      );
      cut.session.adjusted = true;
      cut.session.adjustmentNote = `Ajustado automaticamente por excesso de volume (${(cut.amount / 1000).toFixed(1)} km a menos).`;
    }

    await this.sessionRepository.save(cuts.map((cut) => cut.session));

    await this.planRepository.update(plan.id, {
      volumeAdjusted: true,
      volumeAdjustedReason: reason,
      volumeAdjustedAt: new Date(),
    });
  }

  private partitionWeek(
    plan: TrainingPlan,
    sessions: TrainingSession[],
  ): {
    bankedM: number;
    remainingM: number;
    remainingSessions: TrainingSession[];
  } {
    const today = this.startOfDay(new Date());
    let bankedM = 0;
    let remainingM = 0;
    const remainingSessions: TrainingSession[] = [];

    for (const item of sessions) {
      if (item.type === 'rest') continue;

      if (
        item.completed &&
        item.actualDistance !== null &&
        item.actualDistance !== undefined
      ) {
        bankedM += item.actualDistance;
        continue;
      }

      if (this.sessionDate(plan, item) < today) continue;

      if (item.type === 'race') {
        remainingM += item.plannedDistance ?? 0;
        continue;
      }

      remainingM += item.plannedDistance ?? 0;
      remainingSessions.push(item);
    }

    return { bankedM, remainingM, remainingSessions };
  }

  private distributeCut(
    remaining: TrainingSession[],
    overM: number,
  ): { session: TrainingSession; amount: number; floor: number }[] {
    const ordered = [...remaining].sort(
      (a, b) => (TYPE_PRIORITY[a.type] ?? 1) - (TYPE_PRIORITY[b.type] ?? 1),
    );

    let left = overM;
    const cuts: { session: TrainingSession; amount: number; floor: number }[] =
      [];

    for (const session of ordered) {
      if (left <= 0) break;

      const floor = this.floorFor(session);
      const maxCut = Math.max(0, (session.plannedDistance ?? 0) - floor);
      if (maxCut <= 0) continue;

      const amount = Math.min(maxCut, Math.floor(left / 100) * 100);
      if (amount <= 0) continue;

      cuts.push({ session, amount, floor });
      left -= amount;
    }

    return cuts;
  }

  private floorFor(session: TrainingSession): number {
    switch (session.type) {
      case 'long_run':
        return Math.max(
          MIN_EASY_M,
          Math.round((session.plannedDistance ?? 0) * LONG_FLOOR_RATIO),
        );
      case 'interval':
      case 'tempo':
      case 'fartlek':
        return Math.round(
          (session.plannedDistance ?? 0) * (1 - QUALITY_MAX_CUT_RATIO),
        );
      default:
        return MIN_EASY_M;
    }
  }

  private sumDistance(sessions: TrainingSession[]): number {
    return sessions.reduce((sum, item) => sum + (item.plannedDistance ?? 0), 0);
  }

  private sessionDate(plan: TrainingPlan, session: TrainingSession): Date {
    const date = new Date(plan.weekStart);
    date.setDate(date.getDate() + (session.dayOrder ?? 0));
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private getWeekStart(date: Date): Date {
    const start = this.startOfDay(date);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return start;
  }

  private startOfDay(date: Date): Date {
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    return day;
  }
}
