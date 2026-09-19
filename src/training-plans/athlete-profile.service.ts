import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { Activity } from 'src/activities/entities/activity.entity';
import type { Goal } from 'src/goals/entities/goal.entity';
import {
  calculateAge,
  predictedMaxHeartRate,
} from 'src/health/age-policy';
import { User } from 'src/users/entities/user.entity';
import { buildActivityFeatures } from './activity-features';
import {
  TrainingPattern,
  buildTrainingPattern,
  emptyTrainingPattern,
} from './training-pattern';

export type AthleteLevel = 'beginner' | 'novice' | 'intermediate' | 'advanced';

export interface RecentForm {
  windowStart: string;
  windowEnd: string;
  weeks: number;
  hasData: boolean;
  runs: number;
  weeklyKm: number;
  peakWeeklyKm: number;
  runsPerWeek: number;
  longestKm: number;
}

export interface ThreeKmTest {
  time: number;
  pace: number;
  level: AthleteLevel;
}

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
  maxHeartRate?: number;
  birthDate?: string;
  age?: number;
  predictedMaxHeartRate?: number;
  runsPerWeek: number;
  pattern: TrainingPattern;
  recentForm: RecentForm;
  threeKm?: ThreeKmTest;
}

const EFFORT_WINDOW_DAYS = 180;
const RECENT_WINDOW_WEEKS = 3;
const RECENT_MIN_RUNS = 3;
const MIN_PACE_SEC_PER_KM = 150;
const MAX_PACE_SEC_PER_KM = 600;

@Injectable()
export class AthleteProfileService {
  constructor(
    @InjectRepository(Activity)
    private readonly activityRepository: Repository<Activity>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async getAge(
    userId: string,
    now: Date = new Date(),
  ): Promise<number | undefined> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'birthDate'],
    });

    return calculateAge(user?.birthDate, now);
  }

  async build(
    userId: string,
    goal?: Goal,
    now: Date = new Date(),
    options?: { recentOnly?: boolean },
  ): Promise<AthleteProfile> {
    const effortSince = this.daysAgo(now, EFFORT_WINDOW_DAYS);
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'birthDate'],
    });
    const age = calculateAge(user?.birthDate, now);

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

    const recentRuns = this.recentRunsOf(runs, now);
    const recentForm = this.recentFormOf(recentRuns, now);
    const useRecent = recentForm.hasData;
    const ignoreHistory = !!options?.recentOnly && !useRecent;

    const basisRuns = ignoreHistory ? [] : useRecent ? recentRuns : runs;

    const longest = basisRuns.reduce<Activity | undefined>(
      (best, a) => (!best || a.distance > best.distance ? a : best),
      undefined,
    );
    const longestRunKm = longest ? longest.distance / 1000 : 0;
    const longestRunPace = longest ? this.paceOf(longest) : undefined;

    const goalLongestKm = goal?.longestRunDistance
      ? goal.longestRunDistance / 1000
      : 0;
    const weeklyTotals = this.weeklyTotals(basisRuns, now);
    const recentWeeklyKm = useRecent
      ? recentForm.weeklyKm
      : this.median(weeklyTotals.slice(0, 4));
    const peakWeeklyKm = useRecent
      ? recentForm.peakWeeklyKm
      : weeklyTotals.length > 0
        ? Math.max(...weeklyTotals)
        : 0;
    const typicalWeeklyKm = longestRunKm > 0 ? longestRunKm / 0.42 : 0;

    const pattern =
      basisRuns.length > 0
        ? buildTrainingPattern(
            basisRuns.map((run) => buildActivityFeatures(run)),
            {
              now: useRecent ? this.weekStart(now) : now,
              weeks: useRecent ? RECENT_WINDOW_WEEKS : undefined,
            },
          )
        : emptyTrainingPattern();

    const effectiveLongestKm = Math.max(longestRunKm, goalLongestKm);
    const effectiveWeeklyKm = Math.max(recentWeeklyKm, goalLongestKm * 2.2);
    const levelFromVolume = this.classify(
      effectiveLongestKm,
      effectiveWeeklyKm,
    );
    const threeKmLevel = this.classifyFromThreeKm(goal?.threeKmTime);
    const threeKm =
      goal?.threeKmTime && goal.threeKmTime > 0 && threeKmLevel
        ? {
            time: goal.threeKmTime,
            pace: this.round(goal.threeKmTime / 3, 1),
            level: threeKmLevel,
          }
        : undefined;
    const level = ignoreHistory
      ? (threeKm?.level ?? levelFromVolume)
      : threeKm
        ? this.conservativeLevel(levelFromVolume, threeKm.level)
        : levelFromVolume;
    const maxHeartRate = runs.reduce(
      (best, run) =>
        run.max_heartrate && run.max_heartrate > best
          ? run.max_heartrate
          : best,
      0,
    );

    return {
      level,
      hasData: !ignoreHistory && runs.length >= 3,
      recentWeeklyKm: this.round(recentWeeklyKm, 1),
      peakWeeklyKm: this.round(peakWeeklyKm, 1),
      typicalWeeklyKm: this.round(typicalWeeklyKm, 1),
      longestRunKm: this.round(longestRunKm, 1),
      longestRunPace,
      bestShortPace: this.bestPace(basisRuns, 3000, 5500),
      bestMediumPace: this.bestPace(basisRuns, 5500, 10500),
      bestLongPace: this.bestPace(basisRuns, 10500, Infinity),
      maxHeartRate: maxHeartRate > 0 ? maxHeartRate : undefined,
      birthDate: user?.birthDate ?? undefined,
      age,
      predictedMaxHeartRate: predictedMaxHeartRate(age),
      runsPerWeek: useRecent
        ? recentForm.runsPerWeek
        : ignoreHistory
          ? 0
          : this.runsPerWeek(runs, now),
      pattern,
      recentForm,
      threeKm,
    };
  }

  private recentWindowStart(now: Date): Date {
    const start = this.weekStart(now);
    start.setDate(start.getDate() - RECENT_WINDOW_WEEKS * 7);
    return start;
  }

  private recentRunsOf(runs: Activity[], now: Date): Activity[] {
    const windowStart = this.recentWindowStart(now);
    const currentWeek = this.weekStart(now);

    return runs.filter(
      (a) =>
        a.start_date &&
        a.start_date >= windowStart &&
        a.start_date < currentWeek,
    );
  }

  private recentFormOf(recentRuns: Activity[], now: Date): RecentForm {
    const windowStart = this.recentWindowStart(now);
    const windowEnd = this.weekStart(now);
    const weeklyKm = new Array<number>(RECENT_WINDOW_WEEKS).fill(0);

    for (const run of recentRuns) {
      if (!run.start_date) continue;

      const index = Math.floor(
        (this.weekStart(run.start_date).getTime() - windowStart.getTime()) /
          (7 * 24 * 60 * 60 * 1000),
      );

      if (index >= 0 && index < RECENT_WINDOW_WEEKS) {
        weeklyKm[index] += run.distance / 1000;
      }
    }

    const longest = recentRuns.reduce<Activity | undefined>(
      (best, a) => (!best || a.distance > best.distance ? a : best),
      undefined,
    );
    const sorted = [...weeklyKm].sort((a, b) => a - b);
    const middle = sorted[Math.floor(sorted.length / 2)] ?? 0;

    return {
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      weeks: RECENT_WINDOW_WEEKS,
      hasData: recentRuns.length >= RECENT_MIN_RUNS,
      runs: recentRuns.length,
      weeklyKm: this.round(middle, 1),
      peakWeeklyKm: this.round(Math.max(...weeklyKm), 1),
      runsPerWeek: this.round(recentRuns.length / RECENT_WINDOW_WEEKS, 1),
      longestKm: this.round(longest ? longest.distance / 1000 : 0, 1),
    };
  }

  private conservativeLevel(
    volumeLevel: AthleteLevel,
    testLevel: AthleteLevel,
  ): AthleteLevel {
    const order: AthleteLevel[] = [
      'beginner',
      'novice',
      'intermediate',
      'advanced',
    ];

    return order.indexOf(volumeLevel) <= order.indexOf(testLevel)
      ? volumeLevel
      : testLevel;
  }

  private classifyFromThreeKm(threeKmTime?: number): AthleteLevel | undefined {
    if (!threeKmTime || threeKmTime <= 0) return undefined;

    const pace = threeKmTime / 3;
    if (pace >= 420) return 'beginner';
    if (pace >= 350) return 'novice';
    if (pace >= 290) return 'intermediate';
    return 'advanced';
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
