export type AdherenceVerdict = 'no_plano' | 'proximo' | 'diferente';

export interface Adherence {
  distanceDiff: number;
  paceDiff: number;
  verdict: AdherenceVerdict;
}

export function assessAdherence(opts: {
  plannedDistance?: number | null;
  plannedPace?: number | null;
  actualDistance?: number | null;
  actualPace?: number | null;
}): Adherence | null {
  const { plannedDistance, plannedPace, actualDistance, actualPace } = opts;

  if (
    !plannedDistance ||
    plannedDistance <= 0 ||
    !plannedPace ||
    plannedPace <= 0 ||
    actualDistance == null ||
    actualDistance <= 0 ||
    actualPace == null ||
    actualPace <= 0
  ) {
    return null;
  }

  const distanceDiff = (actualDistance - plannedDistance) / plannedDistance;
  const paceDiff = (actualPace - plannedPace) / plannedPace;

  const absDistance = Math.abs(distanceDiff);
  const absPace = Math.abs(paceDiff);

  let verdict: AdherenceVerdict;
  if (absDistance <= 0.1 && absPace <= 0.05) {
    verdict = 'no_plano';
  } else if (absDistance <= 0.2 || absPace <= 0.1) {
    verdict = 'proximo';
  } else {
    verdict = 'diferente';
  }

  return { distanceDiff, paceDiff, verdict };
}
