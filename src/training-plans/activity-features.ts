import type { Activity } from 'src/activities/entities/activity.entity';

export type ActivityShape = 'interval' | 'long' | 'steady';
export type RunType = 'interval' | 'tempo' | 'fartlek' | 'easy' | 'long';

export interface ActivityFeatures {
  distanceKm: number;
  pace: number;
  movingTime: number;
  name: string;
  shape: ActivityShape;
  paceVariability: number;
  hardLaps: number;
  fastLapStreak: number;
  hardLapMedianPace?: number;
  lapCount: number;
  maxSpeedRatio: number;
  repSizes: string[];
  repSets: RepSet[];
  averageHeartRate?: number;
  maxHeartRate?: number;
  localDate: Date;
}

const FAST_LAP_RATIO = 0.95;

export function buildActivityFeatures(activity: Activity): ActivityFeatures {
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

  const fastThreshold = pace > 0 ? pace * FAST_LAP_RATIO : 0;
  const fastLaps = lapPaces.filter(
    (value) => fastThreshold > 0 && value <= fastThreshold,
  );
  const fastLapStreak = longestStreak(
    lapPaces.map((value) => fastThreshold > 0 && value <= fastThreshold),
  );
  const hardLapMedianPace = fastLaps.length > 0 ? median(fastLaps) : undefined;

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
    fastLapStreak,
    hardLapMedianPace,
    lapCount: lapPaces.length,
    maxSpeedRatio,
    repSizes: repSizesFromText(activity.name ?? ''),
    repSets: repSetsFromText(activity.name ?? ''),
    averageHeartRate: activity.average_heartrate ?? undefined,
    maxHeartRate: activity.max_heartrate ?? undefined,
    localDate,
  };
}

export function classifyRunType(
  features: ActivityFeatures,
  options?: { longKm?: number },
): RunType {
  const longKm = options?.longKm ?? 12;
  const name = normalizeText(features.name);

  if (/fartlek|jogo|brincadeira/.test(name)) return 'fartlek';

  if (
    features.repSizes.length > 0 ||
    /tiro|interval|serie|canivete|escada|vo2|repeticao/.test(name)
  ) {
    return 'interval';
  }

  if (/tempo|limiar|threshold|ritmo forte|progressiv|parede/.test(name)) {
    return 'tempo';
  }

  if (/long|fundo/.test(name)) return 'long';

  if (/regenerativ|recupera|leve|easy|solt|trote/.test(name)) {
    return features.distanceKm >= longKm ? 'long' : 'easy';
  }

  if (features.shape === 'interval') return 'interval';
  if (features.fastLapStreak >= 2) return 'tempo';
  if (features.distanceKm >= longKm) return 'long';

  return 'easy';
}

export function repPatternsFromText(text: string): string[] {
  const matches: string[] = text.match(/\d+\s*x\s*\d+/gi) ?? [];
  return matches.map((rep) => rep.replace(/\s+/g, ''));
}

export function repSizesFromText(text: string): string[] {
  const normalized = normalizeText(text);
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

export interface RepSet {
  count: number;
  size: string;
  sizeKm: number;
}

export function repSetsFromText(text: string): RepSet[] {
  const normalized = normalizeText(text);
  const sets: RepSet[] = [];

  for (const match of normalized.matchAll(
    /(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(km|m)?/g,
  )) {
    const count = Number(match[1]);
    const value = Number(match[2].replace(',', '.'));
    const unit = match[3] ?? (value >= 100 ? 'm' : '');
    if (!unit || count <= 0 || count > 50) continue;

    const sizeKm = unit === 'km' ? value : value / 1000;
    if (sizeKm < 0.1 || sizeKm > 10) continue;

    const size =
      sizeKm >= 1
        ? `${Number(sizeKm.toFixed(2))}km`
        : `${Math.round(sizeKm * 1000)}m`;

    sets.push({ count, size, sizeKm });
  }

  return sets;
}

export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function longestStreak(flags: boolean[]): number {
  let best = 0;
  let current = 0;

  for (const flag of flags) {
    current = flag ? current + 1 : 0;
    if (current > best) best = current;
  }

  return best;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
