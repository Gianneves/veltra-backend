import {
  ActivityFeatures,
  RepSet,
  RunType,
  classifyRunType,
} from './activity-features';

export type PatternConfidence = 'low' | 'medium' | 'high';
export type QualityRunType = 'interval' | 'tempo' | 'fartlek';

export interface TypicalQuality {
  count: number;
  km: number;
  pace: number;
  repPace?: number;
  reps: string[];
  repSets: RepSet[];
}

export interface TrainingPattern {
  hasData: boolean;
  confidence: PatternConfidence;
  sampleSize: number;
  weeksAnalyzed: number;
  runsPerWeek: number;
  qualityPerWeek: number;
  weekdayRate: Record<string, number>;
  preferredRunDays: string[];
  preferredLongRunDay?: string;
  qualityDayRate: Record<string, number>;
  preferredQualityDays: string[];
  typeMix: Record<RunType, number>;
  typicalQuality: Partial<Record<QualityRunType, TypicalQuality>>;
  easyPace?: number;
  easyKm?: number;
  longRun?: { km: number; pace: number };
  maxHeartRate?: number;
}

const DAY_SHORTS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MIN_DISTANCE_KM = 1;
const MIN_PACE = 150;
const MAX_PACE = 600;
const DEFAULT_WINDOW_WEEKS = 12;

export function emptyTrainingPattern(): TrainingPattern {
  return {
    hasData: false,
    confidence: 'low',
    sampleSize: 0,
    weeksAnalyzed: 0,
    runsPerWeek: 0,
    qualityPerWeek: 0,
    weekdayRate: {},
    preferredRunDays: [],
    qualityDayRate: {},
    preferredQualityDays: [],
    typeMix: { interval: 0, tempo: 0, fartlek: 0, easy: 0, long: 0 },
    typicalQuality: {},
  };
}

export function buildTrainingPattern(
  allFeatures: ActivityFeatures[],
  options?: { now?: Date; weeks?: number },
): TrainingPattern {
  const now = options?.now ?? new Date();
  const windowWeeks = options?.weeks ?? DEFAULT_WINDOW_WEEKS;

  const windowStart = startOfDay(new Date(now));
  windowStart.setDate(windowStart.getDate() - windowWeeks * 7);

  const features = allFeatures.filter(
    (item) =>
      item.distanceKm >= MIN_DISTANCE_KM &&
      item.pace >= MIN_PACE &&
      item.pace <= MAX_PACE &&
      item.localDate >= windowStart,
  );

  if (features.length === 0) return emptyTrainingPattern();

  const distances = features
    .map((item) => item.distanceKm)
    .sort((a, b) => a - b);
  const longKm = Math.max(6, percentile(distances, 0.8));

  const classified = features.map((item) => ({
    features: item,
    type: classifyRunType(item, { longKm }),
  }));

  const weekStarts = classified.map((item) =>
    weekStartOf(item.features.localDate),
  );
  const weekCount = countWeeks(weekStarts);
  const weeksAnalyzed = Math.max(1, Math.min(weekCount, windowWeeks));

  const runsByWeek = new Map<string, number>();
  const qualityByWeek = new Map<string, number>();
  const weekdayWeeks = new Map<string, Set<string>>(
    DAY_SHORTS.map((d) => [d, new Set()]),
  );
  const weekdayRuns = new Map<string, number>(DAY_SHORTS.map((d) => [d, 0]));
  const qualityByDay = new Map<string, number>(DAY_SHORTS.map((d) => [d, 0]));
  const longByDay = new Map<string, number>(DAY_SHORTS.map((d) => [d, 0]));

  let qualityCount = 0;
  let longCount = 0;
  let lapCoverage = 0;

  for (const { features: item, type } of classified) {
    const day = DAY_SHORTS[item.localDate.getDay()] ?? 'Dom';
    const key = isoDay(weekStartOf(item.localDate));

    runsByWeek.set(key, (runsByWeek.get(key) ?? 0) + 1);
    weekdayWeeks.get(day)!.add(key);
    weekdayRuns.set(day, (weekdayRuns.get(day) ?? 0) + 1);
    if (item.lapCount > 0) lapCoverage += 1;

    if (type === 'interval' || type === 'tempo' || type === 'fartlek') {
      qualityCount += 1;
      qualityByDay.set(day, (qualityByDay.get(day) ?? 0) + 1);
      qualityByWeek.set(key, (qualityByWeek.get(key) ?? 0) + 1);
    }

    if (type === 'long') {
      longCount += 1;
      longByDay.set(day, (longByDay.get(day) ?? 0) + 1);
    }
  }

  const weekdayRate: Record<string, number> = {};
  for (const day of DAY_SHORTS) {
    weekdayRate[day] = round3(
      (weekdayWeeks.get(day)?.size ?? 0) / weeksAnalyzed,
    );
  }

  const perWeekRuns = weekSeries(weekStarts, windowWeeks, runsByWeek);
  const perWeekQuality = weekSeries(weekStarts, windowWeeks, qualityByWeek);

  return {
    hasData: features.length >= 3,
    confidence: confidenceOf({
      sampleSize: features.length,
      weeksAnalyzed,
      lapCoverage: lapCoverage / features.length,
    }),
    sampleSize: features.length,
    weeksAnalyzed,
    runsPerWeek: round1(median(perWeekRuns)),
    qualityPerWeek: round1(median(perWeekQuality)),
    weekdayRate,
    preferredRunDays: DAY_SHORTS.filter((day) => weekdayRate[day] >= 0.5),
    preferredLongRunDay: pickLongRunDay(longByDay, longCount),
    qualityDayRate: qualityDayRate(qualityByDay, qualityCount),
    preferredQualityDays: pickQualityDays(qualityByDay, qualityCount),
    typeMix: typeMixOf(classified.map((item) => item.type)),
    typicalQuality: typicalQualityOf(classified),
    easyPace: easyPaceOf(classified),
    easyKm: easyKmOf(classified),
    longRun: longRunOf(classified),
    maxHeartRate: maxHeartRateOf(features),
  };
}

function confidenceOf(opts: {
  sampleSize: number;
  weeksAnalyzed: number;
  lapCoverage: number;
}): PatternConfidence {
  if (
    opts.sampleSize >= 24 &&
    opts.weeksAnalyzed >= 8 &&
    opts.lapCoverage >= 0.5
  ) {
    return 'high';
  }

  if (opts.sampleSize >= 10 && opts.weeksAnalyzed >= 4) return 'medium';

  return 'low';
}

function pickLongRunDay(
  longByDay: Map<string, number>,
  longCount: number,
): string | undefined {
  if (longCount < 2) return undefined;

  let best: { day: string; count: number } | undefined;

  for (const day of DAY_SHORTS) {
    const count = longByDay.get(day) ?? 0;
    if (count === 0) continue;
    if (!best || count > best.count) best = { day, count };
  }

  return best && best.count >= 2 ? best.day : undefined;
}

function qualityDayRate(
  qualityByDay: Map<string, number>,
  qualityCount: number,
): Record<string, number> {
  const rate: Record<string, number> = {};
  if (qualityCount === 0) return rate;

  for (const day of DAY_SHORTS) {
    rate[day] = round3((qualityByDay.get(day) ?? 0) / qualityCount);
  }

  return rate;
}

function pickQualityDays(
  qualityByDay: Map<string, number>,
  qualityCount: number,
): string[] {
  if (qualityCount < 2) return [];

  return DAY_SHORTS.filter((day) => {
    const count = qualityByDay.get(day) ?? 0;
    return count >= 2 && count / qualityCount >= 0.15;
  }).sort((a, b) => {
    const diff = (qualityByDay.get(b) ?? 0) - (qualityByDay.get(a) ?? 0);
    return diff || DAY_SHORTS.indexOf(a) - DAY_SHORTS.indexOf(b);
  });
}

function typeMixOf(types: RunType[]): Record<RunType, number> {
  const mix: Record<RunType, number> = {
    interval: 0,
    tempo: 0,
    fartlek: 0,
    easy: 0,
    long: 0,
  };

  if (types.length === 0) return mix;

  for (const type of types) mix[type] += 1;
  for (const key of Object.keys(mix) as RunType[]) {
    mix[key] = round3(mix[key] / types.length);
  }

  return mix;
}

function typicalQualityOf(
  classified: { features: ActivityFeatures; type: RunType }[],
): Partial<Record<QualityRunType, TypicalQuality>> {
  const result: Partial<Record<QualityRunType, TypicalQuality>> = {};

  for (const qualityType of [
    'interval',
    'tempo',
    'fartlek',
  ] as QualityRunType[]) {
    const runs = classified.filter((item) => item.type === qualityType);
    if (runs.length === 0) continue;

    const repPaces = runs
      .map((item) => item.features.hardLapMedianPace)
      .filter((value): value is number => value !== undefined);

    result[qualityType] = {
      count: runs.length,
      km: round1(median(runs.map((item) => item.features.distanceKm))),
      pace: Math.round(median(runs.map((item) => item.features.pace))),
      repPace: repPaces.length > 0 ? Math.round(median(repPaces)) : undefined,
      reps: topRepSizes(runs.map((item) => item.features.repSizes)),
      repSets: topRepSets(runs.map((item) => item.features.repSets)),
    };
  }

  return result;
}

function topRepSets(repLists: RepSet[][]): RepSet[] {
  const counts = new Map<string, { set: RepSet; count: number }>();

  for (const reps of repLists) {
    for (const rep of reps) {
      const key = `${rep.count}x${rep.size}`;
      const current = counts.get(key);
      if (current) {
        current.count += 1;
      } else {
        counts.set(key, { set: rep, count: 1 });
      }
    }
  }

  return [...counts.values()]
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.set.count * b.set.sizeKm - a.set.count * a.set.sizeKm,
    )
    .slice(0, 2)
    .map((entry) => entry.set);
}

function topRepSizes(repLists: string[][]): string[] {
  const counts = new Map<string, number>();

  for (const reps of repLists) {
    for (const rep of reps) {
      counts.set(rep, (counts.get(rep) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([rep]) => rep);
}

function easyPaceOf(
  classified: { features: ActivityFeatures; type: RunType }[],
): number | undefined {
  const runs = classified.filter((item) => item.type === 'easy');
  if (runs.length < 2) return undefined;

  return Math.round(median(runs.map((item) => item.features.pace)));
}

function easyKmOf(
  classified: { features: ActivityFeatures; type: RunType }[],
): number | undefined {
  const runs = classified.filter((item) => item.type === 'easy');
  if (runs.length < 2) return undefined;

  return round1(median(runs.map((item) => item.features.distanceKm)));
}

function maxHeartRateOf(features: ActivityFeatures[]): number | undefined {
  const values = features
    .map((item) => item.maxHeartRate)
    .filter((value): value is number => value !== undefined && value > 0);

  if (values.length === 0) return undefined;

  return Math.max(...values);
}

function longRunOf(
  classified: { features: ActivityFeatures; type: RunType }[],
): { km: number; pace: number } | undefined {
  const runs = classified.filter((item) => item.type === 'long');
  if (runs.length === 0) return undefined;

  return {
    km: round1(median(runs.map((item) => item.features.distanceKm))),
    pace: Math.round(median(runs.map((item) => item.features.pace))),
  };
}

function weekSeries(
  weekStarts: Date[],
  weeks: number,
  counts: Map<string, number>,
): number[] {
  if (weekStarts.length === 0) return [0];

  const latest = weekStarts.reduce((best, current) =>
    current > best ? current : best,
  );
  const series: number[] = [];

  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(latest);
    start.setDate(start.getDate() - i * 7);
    series.push(counts.get(isoDay(start)) ?? 0);
  }

  return series;
}

function countWeeks(weekStarts: Date[]): number {
  if (weekStarts.length === 0) return 0;

  const earliest = weekStarts.reduce((best, current) =>
    current < best ? current : best,
  );
  const latest = weekStarts.reduce((best, current) =>
    current > best ? current : best,
  );

  return (
    Math.round(
      (latest.getTime() - earliest.getTime()) / (7 * 24 * 60 * 60 * 1000),
    ) + 1
  );
}

function weekStartOf(date: Date): Date {
  const start = startOfDay(date);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function startOfDay(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

function isoDay(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  const index = (sorted.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
