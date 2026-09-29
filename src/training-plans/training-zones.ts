export type TrainingZone = 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5';

const ZONE_RATIOS: Record<TrainingZone, [number, number]> = {
  Z1: [0.5, 0.6],
  Z2: [0.6, 0.7],
  Z3: [0.7, 0.8],
  Z4: [0.8, 0.9],
  Z5: [0.9, 1],
};

export function zoneForSessionType(type: string): TrainingZone | undefined {
  switch (type) {
    case 'easy':
    case 'recovery':
    case 'long_run':
      return 'Z2';
    case 'tempo':
    case 'fartlek':
      return 'Z3';
    case 'interval':
    case 'race':
      return 'Z4';
    default:
      return undefined;
  }
}

export function heartRateRange(
  zone: TrainingZone,
  maxHeartRate: number,
): { min: number; max: number } {
  const [minRatio, maxRatio] = ZONE_RATIOS[zone];
  return {
    min: Math.round(maxHeartRate * minRatio),
    max: Math.round(maxHeartRate * maxRatio),
  };
}

export function formatZone(zone: TrainingZone, maxHeartRate?: number): string {
  if (!maxHeartRate || maxHeartRate <= 0) return zone;

  const range = heartRateRange(zone, maxHeartRate);
  return `${zone} (FC ${range.min}-${range.max} bpm)`;
}
