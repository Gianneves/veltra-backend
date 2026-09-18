import type { Activity } from 'src/activities/entities/activity.entity';
import {
  closestReference,
  predictRacePace,
  type PaceReference,
} from 'src/training-plans/race-target';

export const RECORD_DISTANCES_KM = [3, 5, 10, 15, 21.0975, 42.195] as const;

const MIN_PACE_SEC_PER_KM = 150;
const MAX_PACE_SEC_PER_KM = 600;
const PREDICTION_WINDOW_DAYS = 90;
const CONSISTENCY_WEEKS_TARGET = 12;
const CENTURY_KM_TARGET = 100;
const MARATHON_KM = 42.195;
const FIVE_KM_METERS = 5000;
const FIVE_KM_TARGET_SECONDS = 20 * 60;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface BestEffort {
  distanceKm: number;
  timeSeconds: number;
  paceSecondsPerKm: number;
  activityId: string;
  activityName: string;
  achievedAt: string | null;
}

export interface TimePrediction {
  distanceKm: number;
  timeSeconds: number;
  paceSecondsPerKm: number;
  basedOnDistanceKm: number;
  basedOnTimeSeconds: number;
}

export type TrophyCategory = 'milestone' | 'distance' | 'consistency' | 'speed';

export type TrophyProgressUnit = 'km' | 'weeks' | 'seconds' | 'runs';

export interface TrophyProgress {
  current: number;
  target: number;
  unit: TrophyProgressUnit;
  higherIsBetter: boolean;
}

export interface Trophy {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: TrophyCategory;
  earned: boolean;
  earnedDate: string | null;
  progress: TrophyProgress | null;
}

function paceOf(run: Activity): number | undefined {
  if (!run.distance || !run.moving_time) return undefined;

  const pace = run.moving_time / (run.distance / 1000);
  if (
    !Number.isFinite(pace) ||
    pace < MIN_PACE_SEC_PER_KM ||
    pace > MAX_PACE_SEC_PER_KM
  ) {
    return undefined;
  }

  return pace;
}

function dateOf(run: Activity): Date | undefined {
  return run.start_date ?? run.start_date_local ?? undefined;
}

function toIso(date: Date | undefined): string | null {
  return date ? date.toISOString() : null;
}

function bestPaceInRange(
  runs: Activity[],
  minMeters: number,
  maxMeters: number,
): number | undefined {
  let best: number | undefined;

  for (const run of runs) {
    if (run.distance < minMeters || run.distance > maxMeters) continue;
    const pace = paceOf(run);
    if (pace === undefined) continue;
    if (best === undefined || pace < best) best = pace;
  }

  return best;
}

export function buildBestEfforts(runs: Activity[]): BestEffort[] {
  const efforts: BestEffort[] = [];

  for (const distanceKm of RECORD_DISTANCES_KM) {
    let bestRun: Activity | undefined;
    let bestPace: number | undefined;

    for (const run of runs) {
      if (run.distance < distanceKm * 1000) continue;
      const pace = paceOf(run);
      if (pace === undefined) continue;
      if (bestPace === undefined || pace < bestPace) {
        bestPace = pace;
        bestRun = run;
      }
    }

    if (!bestRun || bestPace === undefined) continue;

    efforts.push({
      distanceKm,
      timeSeconds: bestPace * distanceKm,
      paceSecondsPerKm: bestPace,
      activityId: bestRun.id,
      activityName: bestRun.name,
      achievedAt: toIso(dateOf(bestRun)),
    });
  }

  return efforts;
}

function buildRecentReferences(runs: Activity[], now: Date): PaceReference[] {
  const since = new Date(now);
  since.setDate(since.getDate() - PREDICTION_WINDOW_DAYS);

  const recent = runs.filter((run) => {
    const date = dateOf(run);
    return date !== undefined && date >= since;
  });

  const references: PaceReference[] = [];

  const shortPace = bestPaceInRange(recent, 3000, 5500);
  if (shortPace !== undefined) references.push({ km: 4, pace: shortPace });

  const mediumPace = bestPaceInRange(recent, 5500, 10500);
  if (mediumPace !== undefined) references.push({ km: 7.5, pace: mediumPace });

  const longPace = bestPaceInRange(recent, 10500, Infinity);
  if (longPace !== undefined) references.push({ km: 12, pace: longPace });

  return references;
}

export function buildPredictions(
  runs: Activity[],
  now: Date = new Date(),
): TimePrediction[] {
  const references = buildRecentReferences(runs, now);
  if (references.length === 0) return [];

  const predictions: TimePrediction[] = [];

  for (const distanceKm of RECORD_DISTANCES_KM) {
    const pace = predictRacePace(references, distanceKm);
    const reference = closestReference(references, distanceKm);
    if (pace === undefined || reference === undefined) continue;

    predictions.push({
      distanceKm,
      timeSeconds: pace * distanceKm,
      paceSecondsPerKm: pace,
      basedOnDistanceKm: reference.km,
      basedOnTimeSeconds: reference.pace * reference.km,
    });
  }

  return predictions;
}

function weekStart(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function weeklyStreak(runs: Activity[]): {
  weeks: number;
  earnedAt: Date | undefined;
} {
  const firstRunByWeek = new Map<number, Date>();

  for (const run of runs) {
    const date = dateOf(run);
    if (!date) continue;

    const start = weekStart(date).getTime();
    const current = firstRunByWeek.get(start);
    if (!current || date < current) firstRunByWeek.set(start, date);
  }

  const weeks = [...firstRunByWeek.keys()].sort((a, b) => a - b);

  let best = 0;
  let current = 0;
  let earnedAt: Date | undefined;

  for (let i = 0; i < weeks.length; i++) {
    if (i > 0 && weeks[i] - weeks[i - 1] === WEEK_MS) {
      current++;
    } else {
      current = 1;
    }

    if (current > best) best = current;
    if (current === CONSISTENCY_WEEKS_TARGET && !earnedAt) {
      earnedAt = firstRunByWeek.get(weeks[i]);
    }
  }

  return { weeks: best, earnedAt };
}

function bestFiveKm(
  runs: Activity[],
): { seconds: number; run: Activity } | undefined {
  let best: { seconds: number; run: Activity } | undefined;

  for (const run of runs) {
    if (run.distance < FIVE_KM_METERS) continue;
    const pace = paceOf(run);
    if (pace === undefined) continue;

    const seconds = pace * (FIVE_KM_METERS / 1000);
    if (!best || seconds < best.seconds) best = { seconds, run };
  }

  return best;
}

export function buildTrophies(runs: Activity[]): Trophy[] {
  const ordered = [...runs].sort((a, b) => {
    const dateA = dateOf(a)?.getTime() ?? 0;
    const dateB = dateOf(b)?.getTime() ?? 0;
    return dateA - dateB;
  });

  const totalKm = ordered.reduce((sum, run) => sum + run.distance, 0) / 1000;
  const longestKm = ordered.reduce(
    (longest, run) => Math.max(longest, run.distance / 1000),
    0,
  );

  let cumulativeKm = 0;
  let centuryDate: Date | undefined;
  for (const run of ordered) {
    cumulativeKm += run.distance / 1000;
    if (cumulativeKm >= CENTURY_KM_TARGET) {
      centuryDate = dateOf(run);
      break;
    }
  }

  const marathonRun = ordered.find((run) => run.distance >= MARATHON_KM * 1000);

  const streak = weeklyStreak(ordered);
  const fiveKm = bestFiveKm(ordered);

  const firstRun = ordered[0];

  return [
    {
      id: 'first-step',
      name: 'Primeiro Passo',
      description: 'Complete sua primeira corrida',
      icon: 'footprints',
      category: 'milestone',
      earned: Boolean(firstRun),
      earnedDate: toIso(firstRun ? dateOf(firstRun) : undefined),
      progress: {
        current: Math.min(ordered.length, 1),
        target: 1,
        unit: 'runs',
        higherIsBetter: true,
      },
    },
    {
      id: 'century',
      name: 'Centenário',
      description: 'Acumule 100 km de corrida',
      icon: 'trophy',
      category: 'distance',
      earned: centuryDate !== undefined,
      earnedDate: toIso(centuryDate),
      progress: {
        current: Math.min(Math.round(totalKm * 10) / 10, CENTURY_KM_TARGET),
        target: CENTURY_KM_TARGET,
        unit: 'km',
        higherIsBetter: true,
      },
    },
    {
      id: 'marathoner',
      name: 'Maratonista',
      description: 'Complete uma maratona (42,195 km)',
      icon: 'medal',
      category: 'distance',
      earned: marathonRun !== undefined,
      earnedDate: toIso(marathonRun ? dateOf(marathonRun) : undefined),
      progress: {
        current: Math.min(Math.round(longestKm * 10) / 10, MARATHON_KM),
        target: MARATHON_KM,
        unit: 'km',
        higherIsBetter: true,
      },
    },
    {
      id: 'consistent',
      name: 'Consistente',
      description: 'Corra em 12 semanas seguidas',
      icon: 'flame',
      category: 'consistency',
      earned: streak.weeks >= CONSISTENCY_WEEKS_TARGET,
      earnedDate: toIso(streak.earnedAt),
      progress: {
        current: streak.weeks,
        target: CONSISTENCY_WEEKS_TARGET,
        unit: 'weeks',
        higherIsBetter: true,
      },
    },
    {
      id: 'sprinter',
      name: 'Velocista',
      description: 'Corra 5 km abaixo de 20 minutos',
      icon: 'zap',
      category: 'speed',
      earned: fiveKm !== undefined && fiveKm.seconds < FIVE_KM_TARGET_SECONDS,
      earnedDate: toIso(
        fiveKm && fiveKm.seconds < FIVE_KM_TARGET_SECONDS
          ? dateOf(fiveKm.run)
          : undefined,
      ),
      progress: {
        current: fiveKm ? fiveKm.seconds : 0,
        target: FIVE_KM_TARGET_SECONDS,
        unit: 'seconds',
        higherIsBetter: false,
      },
    },
  ];
}
