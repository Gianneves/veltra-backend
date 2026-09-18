import type { AthleteLevel } from './athlete-profile.service';
import { repSizesFromText } from './activity-features';

export type QualityType = 'interval' | 'tempo' | 'fartlek';

export interface WorkoutPreferences {
  primaryType?: QualityType;
  secondaryType?: QualityType;
  typicalReps?: Partial<Record<QualityType, string[]>>;
  typicalMainKm?: Partial<Record<QualityType, number>>;
}
export type PlanPhase = 'base' | 'build' | 'peak' | 'taper';
export type PaceRef = 'interval' | 'threshold' | 'goal';

export interface QualityWorkout {
  key: string;
  type: QualityType;
  label: string;
  mainKm?: number;
  mainMinutes?: number;
  hardMinutes?: number;
  paceRef: PaceRef;
  paceAdjust: number;
  notes: string;
}

export interface WeekWorkouts {
  primary: QualityWorkout;
  secondary?: QualityWorkout;
}

export function resolvePhase(
  weekIndex: number,
  totalWeeks: number,
  fastStart = false,
): PlanPhase {
  const weeksLeft = totalWeeks - 1 - weekIndex;
  if (weeksLeft <= 1) return 'taper';

  const baseWeeks = Math.max(
    1,
    Math.round(totalWeeks * (fastStart ? 0.1 : 0.25)),
  );
  if (weekIndex < baseWeeks) return 'base';

  const peakWeeks = Math.max(2, Math.round(totalWeeks * 0.15));
  if (weekIndex >= totalWeeks - 2 - peakWeeks) return 'peak';

  return 'build';
}

const WORKOUTS: Record<string, QualityWorkout> = {
  'easy-strides': {
    key: 'easy-strides',
    type: 'interval',
    label: 'Retas (strides)',
    mainKm: 1.2,
    paceRef: 'interval',
    paceAdjust: 10,
    notes:
      '8 retas de 20s acelerando (não é sprint), com 40s de trote entre elas. Foque na postura e frequência de passada.',
  },
  'fartlek-6x2': {
    key: 'fartlek-6x2',
    type: 'fartlek',
    label: '6x(2min forte / 2min leve)',
    hardMinutes: 12,
    paceRef: 'interval',
    paceAdjust: 15,
    notes:
      'Fartlek 6x(2min forte / 2min leve). O forte é por esforço (7-8/10), sem travar no pace.',
  },
  'fartlek-8x1': {
    key: 'fartlek-8x1',
    type: 'fartlek',
    label: '8x(1min forte / 1min leve)',
    hardMinutes: 8,
    paceRef: 'interval',
    paceAdjust: 10,
    notes:
      'Fartlek 8x(1min forte / 1min leve). O forte é por esforço (8/10), sem travar no pace.',
  },
  'fartlek-10x1': {
    key: 'fartlek-10x1',
    type: 'fartlek',
    label: '10x(1min forte / 1min leve)',
    hardMinutes: 10,
    paceRef: 'interval',
    paceAdjust: 5,
    notes:
      'Fartlek 10x(1min forte / 1min leve). O forte é por esforço (8/10), solto e ritmado.',
  },
  'fartlek-10x2': {
    key: 'fartlek-10x2',
    type: 'fartlek',
    label: '10x(2min forte / 1min leve)',
    hardMinutes: 20,
    paceRef: 'interval',
    paceAdjust: 8,
    notes:
      'Fartlek 10x(2min forte / 1min leve). O forte é por esforço (8/10), sem travar no pace.',
  },
  'fartlek-12x1': {
    key: 'fartlek-12x1',
    type: 'fartlek',
    label: '12x(1min forte / 1min leve)',
    hardMinutes: 12,
    paceRef: 'interval',
    paceAdjust: 5,
    notes:
      'Fartlek 12x(1min forte / 1min leve). Forte controlado (8/10), foco em ritmo e cadência.',
  },
  'interval-6x400': {
    key: 'interval-6x400',
    type: 'interval',
    label: '6x400m',
    mainKm: 2.4,
    paceRef: 'interval',
    paceAdjust: 0,
    notes: '6x400m no pace {pace}/km com 1:30 de trote entre as repetições.',
  },
  'interval-8x400': {
    key: 'interval-8x400',
    type: 'interval',
    label: '8x400m',
    mainKm: 3.2,
    paceRef: 'interval',
    paceAdjust: 0,
    notes: '8x400m no pace {pace}/km com 1:30 de trote entre as repetições.',
  },
  'interval-4x800': {
    key: 'interval-4x800',
    type: 'interval',
    label: '4x800m',
    mainKm: 3.2,
    paceRef: 'interval',
    paceAdjust: 2,
    notes: '4x800m no pace {pace}/km com 2:00 de trote entre as repetições.',
  },
  'interval-5x800': {
    key: 'interval-5x800',
    type: 'interval',
    label: '5x800m',
    mainKm: 4,
    paceRef: 'interval',
    paceAdjust: 2,
    notes: '5x800m no pace {pace}/km com 2:00 de trote entre as repetições.',
  },
  'interval-6x800': {
    key: 'interval-6x800',
    type: 'interval',
    label: '6x800m',
    mainKm: 4.8,
    paceRef: 'interval',
    paceAdjust: 3,
    notes: '6x800m no pace {pace}/km com 2:00 de trote entre as repetições.',
  },
  'interval-8x800': {
    key: 'interval-8x800',
    type: 'interval',
    label: '8x800m',
    mainKm: 6.4,
    paceRef: 'interval',
    paceAdjust: 4,
    notes: '8x800m no pace {pace}/km com 2:00 de trote entre as repetições.',
  },
  'interval-4x1000': {
    key: 'interval-4x1000',
    type: 'interval',
    label: '4x1000m',
    mainKm: 4,
    paceRef: 'interval',
    paceAdjust: 4,
    notes: '4x1000m no pace {pace}/km com 2:30 de trote entre as repetições.',
  },
  'interval-5x1000': {
    key: 'interval-5x1000',
    type: 'interval',
    label: '5x1000m',
    mainKm: 5,
    paceRef: 'interval',
    paceAdjust: 5,
    notes: '5x1000m no pace {pace}/km com 2:30 de trote entre as repetições.',
  },
  'interval-3x1600': {
    key: 'interval-3x1600',
    type: 'interval',
    label: '3x1600m',
    mainKm: 4.8,
    paceRef: 'interval',
    paceAdjust: 6,
    notes: '3x1600m no pace {pace}/km com 3:00 de trote entre as repetições.',
  },
  'interval-4x1200': {
    key: 'interval-4x1200',
    type: 'interval',
    label: '4x1200m',
    mainKm: 4.8,
    paceRef: 'interval',
    paceAdjust: 5,
    notes: '4x1200m no pace {pace}/km com 2:30 de trote entre as repetições.',
  },
  'interval-3x2000': {
    key: 'interval-3x2000',
    type: 'interval',
    label: '3x2000m',
    mainKm: 6,
    paceRef: 'interval',
    paceAdjust: 8,
    notes: '3x2000m no pace {pace}/km com 3:00 de trote entre as repetições.',
  },
  'tempo-12': {
    key: 'tempo-12',
    type: 'tempo',
    label: 'Tempo 12min',
    mainMinutes: 12,
    paceRef: 'threshold',
    paceAdjust: 0,
    notes:
      'Tempo run: {mainMin}min contínuos no pace {pace}/km — ritmo forte e controlado (limiar).',
  },
  'tempo-15': {
    key: 'tempo-15',
    type: 'tempo',
    label: 'Tempo 15min',
    mainMinutes: 15,
    paceRef: 'threshold',
    paceAdjust: 0,
    notes:
      'Tempo run: {mainMin}min contínuos no pace {pace}/km — ritmo forte e controlado (limiar).',
  },
  'tempo-18': {
    key: 'tempo-18',
    type: 'tempo',
    label: 'Tempo 18min',
    mainMinutes: 18,
    paceRef: 'threshold',
    paceAdjust: 0,
    notes:
      'Tempo run: {mainMin}min contínuos no pace {pace}/km — ritmo forte e controlado (limiar).',
  },
  'tempo-20': {
    key: 'tempo-20',
    type: 'tempo',
    label: 'Tempo 20min',
    mainMinutes: 20,
    paceRef: 'threshold',
    paceAdjust: 0,
    notes:
      'Tempo run: {mainMin}min contínuos no pace {pace}/km — ritmo forte e controlado (limiar).',
  },
  'tempo-25': {
    key: 'tempo-25',
    type: 'tempo',
    label: 'Tempo 25min',
    mainMinutes: 25,
    paceRef: 'threshold',
    paceAdjust: 0,
    notes:
      'Tempo run: {mainMin}min contínuos no pace {pace}/km — ritmo forte e controlado (limiar).',
  },
  'tempo-30': {
    key: 'tempo-30',
    type: 'tempo',
    label: 'Tempo 30min',
    mainMinutes: 30,
    paceRef: 'threshold',
    paceAdjust: 0,
    notes:
      'Tempo run: {mainMin}min contínuos no pace {pace}/km — ritmo forte e controlado (limiar).',
  },
  'tempo-35': {
    key: 'tempo-35',
    type: 'tempo',
    label: 'Tempo 35min',
    mainMinutes: 35,
    paceRef: 'threshold',
    paceAdjust: 0,
    notes:
      'Tempo run: {mainMin}min contínuos no pace {pace}/km — ritmo forte e controlado (limiar).',
  },
  'tempo-2x10': {
    key: 'tempo-2x10',
    type: 'tempo',
    label: '2x10min tempo',
    mainMinutes: 20,
    paceRef: 'threshold',
    paceAdjust: 0,
    notes: '2x10min no pace {pace}/km com 3:00 de trote entre os blocos.',
  },
  'tempo-2x15': {
    key: 'tempo-2x15',
    type: 'tempo',
    label: '2x15min tempo',
    mainMinutes: 30,
    paceRef: 'threshold',
    paceAdjust: 0,
    notes: '2x15min no pace {pace}/km com 3:00 de trote entre os blocos.',
  },
  'tempo-2x20': {
    key: 'tempo-2x20',
    type: 'tempo',
    label: '2x20min tempo',
    mainMinutes: 40,
    paceRef: 'threshold',
    paceAdjust: 0,
    notes: '2x20min no pace {pace}/km com 4:00 de trote entre os blocos.',
  },
  'sharp-6x200': {
    key: 'sharp-6x200',
    type: 'interval',
    label: '6x200m',
    mainKm: 1.2,
    paceRef: 'interval',
    paceAdjust: -5,
    notes:
      '6x200m no pace {pace}/km com 1:00 de trote. Sinta a velocidade, sem forçar.',
  },
  'activation-4x400': {
    key: 'activation-4x400',
    type: 'interval',
    label: '4x400m ativação',
    mainKm: 1.6,
    paceRef: 'goal',
    paceAdjust: 0,
    notes:
      'Ativação: 4x400m no pace da prova ({goalPace}/km) com 1:30 de trote. Termine leve.',
  },
};

const ROTATIONS: Record<AthleteLevel, Record<PlanPhase, string[]>> = {
  beginner: {
    base: ['easy-strides', 'fartlek-6x2', 'fartlek-8x1'],
    build: ['fartlek-8x1', 'interval-6x400', 'fartlek-10x1', 'interval-4x800'],
    peak: ['interval-6x400', 'interval-5x800', 'fartlek-8x1'],
    taper: ['sharp-6x200'],
  },
  novice: {
    base: ['fartlek-8x1', 'tempo-12', 'fartlek-6x2', 'easy-strides'],
    build: [
      'interval-8x400',
      'fartlek-10x2',
      'interval-5x800',
      'interval-4x1000',
    ],
    peak: ['interval-6x800', 'fartlek-10x1', 'interval-5x1000'],
    taper: ['sharp-6x200', 'activation-4x400'],
  },
  intermediate: {
    base: ['fartlek-10x1', 'tempo-18', 'fartlek-8x1', 'tempo-2x10'],
    build: [
      'interval-6x400',
      'fartlek-12x1',
      'interval-5x800',
      'interval-4x1000',
      'interval-3x1600',
    ],
    peak: ['interval-5x1000', 'tempo-2x15', 'interval-6x800'],
    taper: ['sharp-6x200', 'activation-4x400'],
  },
  advanced: {
    base: ['fartlek-12x1', 'tempo-30', 'fartlek-10x2', 'tempo-2x15'],
    build: [
      'interval-8x400',
      'interval-6x800',
      'interval-5x1000',
      'tempo-35',
      'interval-4x1200',
      'interval-3x2000',
    ],
    peak: ['interval-5x1000', 'tempo-2x20', 'interval-8x800'],
    taper: ['sharp-6x200', 'activation-4x400'],
  },
};

const SECONDARY: Record<AthleteLevel, Record<PlanPhase, string[]>> = {
  beginner: { base: [], build: [], peak: [], taper: [] },
  novice: {
    base: ['tempo-12', 'fartlek-6x2'],
    build: ['tempo-15', 'fartlek-8x1'],
    peak: ['tempo-15', 'fartlek-8x1'],
    taper: [],
  },
  intermediate: {
    base: ['tempo-18', 'fartlek-8x1', 'tempo-2x10'],
    build: ['tempo-20', 'fartlek-10x1', 'tempo-25'],
    peak: ['tempo-25', 'fartlek-10x1', 'tempo-2x15'],
    taper: [],
  },
  advanced: {
    base: ['tempo-25', 'fartlek-10x1', 'tempo-30'],
    build: ['tempo-30', 'fartlek-12x1', 'tempo-2x15'],
    peak: ['tempo-35', 'fartlek-12x1', 'tempo-2x20'],
    taper: [],
  },
};

export function raceSpecificWorkout(raceKm: number): QualityWorkout {
  if (raceKm <= 11) {
    return {
      key: 'race-specific-5x1000',
      type: 'interval',
      label: '5x1000m pace de prova',
      mainKm: 5,
      paceRef: 'goal',
      paceAdjust: 0,
      notes:
        '5x1000m no pace da prova ({goalPace}/km) com 2:00 de trote entre as repetições.',
    };
  }

  if (raceKm <= 22) {
    return {
      key: 'race-specific-3x3k',
      type: 'interval',
      label: '3x3000m pace de prova',
      mainKm: 9,
      paceRef: 'goal',
      paceAdjust: 0,
      notes:
        '3x3000m no pace da prova ({goalPace}/km) com 4:00 de trote entre os blocos.',
    };
  }

  return {
    key: 'race-specific-4x3k',
    type: 'interval',
    label: '4x3000m pace de prova',
    mainKm: 12,
    paceRef: 'goal',
    paceAdjust: 0,
    notes:
      '4x3000m no pace da prova ({goalPace}/km) com 4:00 de trote entre os blocos.',
  };
}

export function phaseWorkoutPool(
  level: AthleteLevel,
  phase: PlanPhase,
): QualityWorkout[] {
  return ROTATIONS[level][phase].map((key) => WORKOUTS[key]);
}

export function workoutsOfType(type: QualityType): QualityWorkout[] {
  return Object.values(WORKOUTS).filter((workout) => workout.type === type);
}

export function secondaryWorkoutPool(
  level: AthleteLevel,
  phase: PlanPhase,
): QualityWorkout[] {
  return SECONDARY[level][phase].map((key) => WORKOUTS[key]);
}

export function selectWeekWorkouts(opts: {
  level: AthleteLevel;
  phase: PlanPhase;
  phaseWeekIndex: number;
  globalWeekIndex: number;
  raceKm: number;
  hasSecondaryDay: boolean;
  deload: boolean;
  preferences?: WorkoutPreferences;
}): WeekWorkouts {
  const {
    level,
    phase,
    phaseWeekIndex,
    globalWeekIndex,
    raceKm,
    hasSecondaryDay,
    deload,
    preferences,
  } = opts;

  if (deload) {
    return {
      primary:
        level === 'beginner'
          ? WORKOUTS['easy-strides']
          : WORKOUTS['fartlek-6x2'],
    };
  }

  const isRaceSpecificWeek =
    (phase === 'peak' || (phase === 'build' && globalWeekIndex > 0)) &&
    (level === 'intermediate' || level === 'advanced') &&
    globalWeekIndex % 2 === 1;

  if (isRaceSpecificWeek) {
    const primary = raceSpecificWorkout(raceKm);
    return {
      primary,
      secondary: hasSecondaryDay
        ? pickSecondary(level, phase, phaseWeekIndex, primary, preferences)
        : undefined,
    };
  }

  const pool = orderWorkoutPool(
    phaseWorkoutPool(level, phase),
    preferences,
    preferences?.primaryType,
  );
  const workout = pool[phaseWeekIndex % pool.length];
  const secondary = hasSecondaryDay
    ? pickSecondary(level, phase, phaseWeekIndex, workout, preferences)
    : undefined;

  return { primary: workout, secondary };
}

export function orderWorkoutPool(
  pool: QualityWorkout[],
  preferences: WorkoutPreferences | undefined,
  preferredType: QualityType | undefined,
): QualityWorkout[] {
  if (!preferredType) return pool;

  const score = (workout: QualityWorkout) =>
    workoutFamiliarity(workout, preferences);
  const sortFamiliar = (list: QualityWorkout[]) =>
    [...list].sort((a, b) => score(b) - score(a));

  const preferred = sortFamiliar(
    pool.filter((workout) => workout.type === preferredType),
  );
  const others = sortFamiliar(
    pool.filter((workout) => workout.type !== preferredType),
  );

  const ordered = [...preferred, ...others];
  return ordered.length > 0 ? ordered : pool;
}

function workoutFamiliarity(
  workout: QualityWorkout,
  preferences?: WorkoutPreferences,
): number {
  if (!preferences) return 0;

  const typicalReps = preferences.typicalReps?.[workout.type] ?? [];
  const repMatch =
    typicalReps.length > 0 &&
    repSizesFromText(`${workout.label} ${workout.notes}`).some((size) =>
      typicalReps.includes(size),
    )
      ? 2
      : 0;

  const typicalMainKm = preferences.typicalMainKm?.[workout.type];
  const mainKm = workout.mainKm;

  if (!typicalMainKm || !mainKm) return repMatch;

  const gap = Math.abs(mainKm - typicalMainKm) / Math.max(typicalMainKm, 1);
  return repMatch + Math.max(0, 1 - gap);
}

function pickSecondary(
  level: AthleteLevel,
  phase: PlanPhase,
  phaseWeekIndex: number,
  primary: QualityWorkout,
  preferences?: WorkoutPreferences,
): QualityWorkout | undefined {
  const candidates = secondaryWorkoutPool(level, phase).filter(
    (workout) => workout.type !== primary.type,
  );
  if (candidates.length === 0) return undefined;

  const ordered = orderWorkoutPool(
    candidates,
    preferences,
    preferences?.secondaryType,
  );

  return ordered[phaseWeekIndex % ordered.length];
}
