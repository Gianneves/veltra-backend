import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { Activity } from 'src/activities/entities/activity.entity';
import type { Goal } from 'src/goals/entities/goal.entity';

export type AthleteLevel = 'beginner' | 'novice' | 'intermediate' | 'advanced';

export interface AthleteProfile {
  level: AthleteLevel;
  hasData: boolean;
  recentWeeklyKm: number;
  peakWeeklyKm: number;
  typicalWeeklyKm: number;
  longestRunKm: number;
  longestRunPace?: number;
  bestShortPace?: number;
  bestMediumPace?: number;
  bestLongPace?: number;
  runsPerWeek: number;
}

const EFFORT_WINDOW_DAYS = 180;
const LONG_RUN_WINDOW_DAYS = 90;
const MIN_PACE_SEC_PER_KM = 150;
const MAX_PACE_SEC_PER_KM = 600;

@Injectable()
export class AthleteProfileService {
  constructor(
    @InjectRepository(Activity)
    private readonly activityRepository: Repository<Activity>,
  ) {}

  async build(
    userId: string,
    goal?: Goal,
    now: Date = new Date(),
  ): Promise<AthleteProfile> {
    const effortSince = this.daysAgo(now, EFFORT_WINDOW_DAYS);

    const activities = await this.activityRepository.find({
      where: {
        user: { id: userId },
        start_date: MoreThanOrEqual(effortSince),
      },
      order: { start_date: 'DESC' },
    });

    const runs = activities.filter(
      (a) =>
        (a.type === 'Run' || a.sport_type === 'Run') &&
        a.distance >= 1000 &&
        a.moving_time > 0,
    );

    const longSince = this.daysAgo(now, LONG_RUN_WINDOW_DAYS);
    const longRuns = runs.filter(
      (a) => a.start_date && a.start_date >= longSince,
    );

    const longest = longRuns.reduce<Activity | undefined>(
      (best, a) => (!best || a.distance > best.distance ? a : best),
      undefined,
    );

    const longestRunKm = longest ? longest.distance / 1000 : 0;
    const longestRunPace = longest ? this.paceOf(longest) : undefined;

    const goalLongestKm = goal?.longestRunDistance
      ? goal.longestRunDistance / 1000
      : 0;
    const weeklyTotals = this.weeklyTotals(runs, now);
    const recentWeeklyKm = this.median(weeklyTotals.slice(0, 4));
    const peakWeeklyKm =
      weeklyTotals.length > 0 ? Math.max(...weeklyTotals) : 0;
    const typicalWeeklyKm = longestRunKm > 0 ? longestRunKm / 0.42 : 0;

    const effectiveLongestKm = Math.max(longestRunKm, goalLongestKm);
    const effectiveWeeklyKm = Math.max(recentWeeklyKm, goalLongestKm * 2.2);

    return {
      level: this.classify(effectiveLongestKm, effectiveWeeklyKm),
      hasData: runs.length >= 3,
      recentWeeklyKm: this.round(recentWeeklyKm, 1),
      peakWeeklyKm: this.round(peakWeeklyKm, 1),
      typicalWeeklyKm: this.round(typicalWeeklyKm, 1),
      longestRunKm: this.round(longestRunKm, 1),
      longestRunPace,
      bestShortPace: this.bestPace(runs, 3000, 5500),
      bestMediumPace: this.bestPace(runs, 5500, 10500),
      bestLongPace: this.bestPace(runs, 10500, Infinity),
      runsPerWeek: this.runsPerWeek(runs, now),
    };
  }

  private classify(longestKm: number, weeklyKm: number): AthleteLevel {
    if (longestKm >= 25 || weeklyKm >= 60) return 'advanced';
    if (longestKm >= 15 || weeklyKm >= 35) return 'intermediate';
    if (longestKm >= 8 || weeklyKm >= 18) return 'novice';
    return 'beginner';
  }

  private bestPace(
    runs: Activity[],
    minMeters: number,
    maxMeters: number,
  ): number | undefined {
    let best: number | undefined;

    for (const run of runs) {
      if (run.distance < minMeters || run.distance > maxMeters) continue;
      const pace = this.paceOf(run);
      if (pace === undefined) continue;
      if (best === undefined || pace < best) best = pace;
    }

    return best === undefined ? undefined : Math.round(best);
  }

  private paceOf(activity: Activity): number | undefined {
    if (!activity.distance || !activity.moving_time) return undefined;
    const pace = activity.moving_time / (activity.distance / 1000);
    if (
      !Number.isFinite(pace) ||
      pace < MIN_PACE_SEC_PER_KM ||
      pace > MAX_PACE_SEC_PER_KM
    ) {
      return undefined;
    }
    return pace;
  }

  private weeklyTotals(runs: Activity[], now: Date): number[] {
    const currentWeek = this.weekStart(now);
    const totals: number[] = [];

    for (let i = 1; i <= 12; i++) {
      const start = new Date(currentWeek);
      start.setDate(start.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);

      const weekRuns = runs.filter(
        (a) => a.start_date && a.start_date >= start && a.start_date < end,
      );

      totals.push(weekRuns.reduce((sum, a) => sum + a.distance, 0) / 1000);
    }

    return totals;
  }

  private median(weeklyTotals: number[]): number {
    const totals = weeklyTotals.filter((value) => value > 0);
    if (totals.length === 0) return 0;

    totals.sort((a, b) => a - b);
    const mid = Math.floor(totals.length / 2);
    return totals.length % 2 === 0
      ? (totals[mid - 1] + totals[mid]) / 2
      : totals[mid];
  }

  private runsPerWeek(runs: Activity[], now: Date): number {
    const currentWeek = this.weekStart(now);
    const since = new Date(currentWeek);
    since.setDate(since.getDate() - 7 * 4);

    const recent = runs.filter((a) => a.start_date && a.start_date >= since);

    return this.round(recent.length / 4, 1);
  }

  private weekStart(date: Date): Date {
    const start = new Date(date);
    start.setDate(date.getDate() - date.getDay());
    start.setHours(0, 0, 0, 0);
    return start;
  }

  private daysAgo(date: Date, days: number): Date {
    const since = new Date(date);
    since.setDate(since.getDate() - days);
    return since;
  }

  private round(value: number, decimals: number): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }
}
