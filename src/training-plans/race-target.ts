import type { AthleteLevel, AthleteProfile } from './athlete-profile.service';

export interface PaceReference {
  km: number;
  pace: number;
}

export type RaceTargetVerdict =
  | 'conservadora'
  | 'realista'
  | 'agressiva'
  | 'improvavel';

export interface RaceTargetAssessment {
  targetPace: number;
  targetTime: number;
  predictedPace: number;
  predictedTime: number;
  realisticPace: number;
  requiredImprovement: number;
  maxImprovement: number;
  verdict: RaceTargetVerdict;
}

const IMPROVEMENT_BY_LEVEL: Record<AthleteLevel, number> = {
  beginner: 0.08,
  novice: 0.06,
  intermediate: 0.04,
  advanced: 0.03,
};

export function buildRaceReferences(
  profile: AthleteProfile,
  threeKmPace?: number,
): PaceReference[] {
  const refs: PaceReference[] = [];

  if (threeKmPace) refs.push({ km: 3, pace: threeKmPace });
  if (profile.bestShortPace) refs.push({ km: 4, pace: profile.bestShortPace });
  if (profile.bestMediumPace) {
    refs.push({ km: 7.5, pace: profile.bestMediumPace });
  }
  if (profile.bestLongPace) refs.push({ km: 12, pace: profile.bestLongPace });

  return refs;
}

export function closestReference(
  refs: PaceReference[],
  raceKm: number,
): PaceReference | undefined {
  return refs.reduce<PaceReference | undefined>((best, current) => {
    if (!best) return current;
    return Math.abs(Math.log(current.km / raceKm)) <
      Math.abs(Math.log(best.km / raceKm))
      ? current
      : best;
  }, undefined);
}

export function predictRacePace(
  refs: PaceReference[],
  raceKm: number,
): number | undefined {
  const ref = closestReference(refs, raceKm);
  if (!ref) return undefined;
  return ref.pace * Math.pow(raceKm / ref.km, 0.06);
}

export function maxImprovementFor(
  level: AthleteLevel,
  totalWeeks: number,
): number {
  const scale = Math.min(1, Math.max(totalWeeks, 1) / 12);
  return Math.max(0.01, IMPROVEMENT_BY_LEVEL[level] * scale);
}

export function assessRaceTarget(opts: {
  targetTime: number;
  raceKm: number;
  predictedPace: number;
  level: AthleteLevel;
  totalWeeks: number;
}): RaceTargetAssessment {
  const { targetTime, raceKm, predictedPace, level, totalWeeks } = opts;

  const targetPace = targetTime / raceKm;
  const predictedTime = predictedPace * raceKm;
  const maxImprovement = maxImprovementFor(level, totalWeeks);
  const requiredImprovement = Math.max(
    0,
    (predictedTime - targetTime) / predictedTime,
  );
  const realisticPace = Math.max(
    targetPace,
    predictedPace * (1 - maxImprovement),
  );

  let verdict: RaceTargetVerdict;
  if (requiredImprovement <= 0) {
    verdict = 'conservadora';
  } else if (requiredImprovement <= maxImprovement) {
    verdict = 'realista';
  } else if (requiredImprovement <= maxImprovement + 0.03) {
    verdict = 'agressiva';
  } else {
    verdict = 'improvavel';
  }

  return {
    targetPace,
    targetTime,
    predictedPace,
    predictedTime,
    realisticPace,
    requiredImprovement,
    maxImprovement,
    verdict,
  };
}

export function formatRaceTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}
