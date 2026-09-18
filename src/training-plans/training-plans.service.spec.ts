import { TrainingPlansService } from './training-plans.service';
import { qualityMainScale, resolvePhase } from './workout-library';
import { TrainingPattern, emptyTrainingPattern } from './training-pattern';
import { Goal } from 'src/goals/entities/goal.entity';
import type { Activity } from 'src/activities/entities/activity.entity';
import type { AthleteProfile } from './athlete-profile.service';
import type { TrainingPlan } from './entities/training-plan.entity';
import type { TrainingSession } from './entities/training-session.entity';

let planCounter = 0;
let sessionCounter = 0;

const START = new Date('2026-09-14T12:00:00.000Z');
const GOAL_END = '2026-12-06T15:00:00.000Z';

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-1',
    userId: 'user-1',
    title: 'Meta de teste',
    targetDistance: 10000,
    targetDate: GOAL_END,
    discipline: 'Corrida de rua',
    currentProgress: 0,
    status: 'active',
    runDays: ['Seg', 'Ter', 'Qui', 'Sex', 'Sáb'],
    longRunDay: 'Sáb',
    daysPerWeek: 5,
    threeKmTime: 1200,
    longestRunDistance: 10000,
    longestRunTime: 3600,
    milestones: [],
    ...overrides,
  } as Goal;
}

function makeProfile(overrides: Partial<AthleteProfile> = {}): AthleteProfile {
  return {
    level: 'intermediate',
    hasData: true,
    recentWeeklyKm: 40,
    peakWeeklyKm: 45,
    typicalWeeklyKm: 45,
    longestRunKm: 16,
    longestRunPace: 370,
    bestShortPace: 334,
    bestMediumPace: 348,
    bestLongPace: 365,
    runsPerWeek: 4,
    pattern: emptyTrainingPattern(),
    ...overrides,
  };
}

function makePattern(
  overrides: Partial<TrainingPattern> = {},
): TrainingPattern {
  return {
    hasData: true,
    confidence: 'high',
    sampleSize: 40,
    weeksAnalyzed: 12,
    runsPerWeek: 4,
    qualityPerWeek: 2,
    weekdayRate: {
      Dom: 0.9,
      Seg: 0,
      Ter: 0.9,
      Qua: 0.1,
      Qui: 0.9,
      Sex: 0.8,
      Sáb: 0.2,
    },
    preferredRunDays: ['Dom', 'Ter', 'Qui', 'Sex'],
    preferredLongRunDay: 'Dom',
    qualityDayRate: { Ter: 0.5, Qui: 0.5 },
    preferredQualityDays: ['Ter', 'Qui'],
    typeMix: {
      interval: 0.35,
      tempo: 0.2,
      fartlek: 0.1,
      easy: 0.25,
      long: 0.1,
    },
    typicalQuality: {
      interval: {
        count: 12,
        km: 9.5,
        pace: 345,
        repPace: 320,
        reps: ['800m'],
        repSets: [{ count: 5, size: '800m', sizeKm: 0.8 }],
      },
      tempo: {
        count: 6,
        km: 10,
        pace: 355,
        repPace: 340,
        reps: [],
        repSets: [],
      },
    },
    easyPace: 385,
    longRun: { km: 17, pace: 380 },
    ...overrides,
  };
}

function createMocks(profile: AthleteProfile) {
  planCounter = 0;
  sessionCounter = 0;

  const planRepository = {
    create: jest.fn((data: Partial<TrainingPlan>) => ({
      ...data,
      id: `plan-${++planCounter}`,
    })),
    save: jest.fn((plan: TrainingPlan) => Promise.resolve(plan)),
    find: jest.fn(() => Promise.resolve([] as TrainingPlan[])),
    findOne: jest.fn(() => Promise.resolve(null)),
    update: jest.fn(() => Promise.resolve(undefined)),
    delete: jest.fn(() => Promise.resolve(undefined)),
  };

  const sessionRepository = {
    create: jest.fn((data: Partial<TrainingSession>) => ({
      ...data,
      id: `session-${++sessionCounter}`,
    })),
    save: jest.fn((sessions: TrainingSession | TrainingSession[]) =>
      Promise.resolve(sessions),
    ),
    findOne: jest.fn(() => Promise.resolve(null)),
    update: jest.fn(() => Promise.resolve(undefined)),
    delete: jest.fn(() => Promise.resolve(undefined)),
  };

  const goalRepository = {
    findOne: jest.fn(() => Promise.resolve(null)),
    find: jest.fn(() => Promise.resolve([])),
    update: jest.fn(),
    delete: jest.fn(),
  };

  const activityRepository = {
    find: jest.fn(() => Promise.resolve([] as Activity[])),
    findOne: jest.fn(() => Promise.resolve(null)),
  };

  const athleteProfileService = {
    build: jest.fn(() => Promise.resolve(profile)),
  };

  const aiService = {
    generatePlanReview: jest.fn(() => Promise.resolve(null)),
  };

  const activityMatcher = {
    matchActivity: jest.fn(() => Promise.resolve({ matched: false })),
    unlinkSessionsForActivity: jest.fn(() => Promise.resolve(0)),
    linkActivityToSession: jest.fn(() => Promise.resolve(null)),
    isManuallyLinked: jest.fn(() => Promise.resolve(false)),
  };

  const service = new TrainingPlansService(
    planRepository as any,
    sessionRepository as any,
    goalRepository as any,
    activityRepository as any,
    athleteProfileService as any,
    aiService as any,
    activityMatcher as any,
  );

  return { service, planRepository, sessionRepository };
}

async function generate(goal: Goal, profile: AthleteProfile) {
  const mocks = createMocks(profile);
  const { plans } = await mocks.service.regenerateFromGoal(goal, {
    startDate: START,
  });
  return { plans, ...mocks };
}

function raceSession(plans: TrainingPlan[]): TrainingSession | undefined {
  return allSessions(plans).find((s) => s.type === 'race');
}

function targetNoteFrom(planRepository: {
  update: jest.Mock;
}): string | undefined {
  const calls = planRepository.update.mock.calls as Array<
    [string, { coachNotes?: string }]
  >;

  return calls.find(([, patch]) =>
    patch?.coachNotes?.includes('Meta de tempo'),
  )?.[1].coachNotes;
}

function allCoachNotes(planRepository: {
  update: jest.Mock;
}): string | undefined {
  const calls = planRepository.update.mock.calls as Array<
    [string, { coachNotes?: string }]
  >;

  return calls
    .map(([, patch]) => patch?.coachNotes)
    .filter((notes): notes is string => !!notes)
    .join('\n');
}

function weekVolume(plan: TrainingPlan): number {
  return (plan.sessions ?? [])
    .filter((s) => s.type !== 'rest' && s.type !== 'race')
    .reduce((total, s) => total + s.plannedDistance, 0);
}

function allSessions(plans: TrainingPlan[]): TrainingSession[] {
  return plans.flatMap((p) => p.sessions ?? []);
}

describe('resolvePhase', () => {
  it('encurta a fase de base para atletas experientes', () => {
    expect(resolvePhase(1, 12, false)).toBe('base');
    expect(resolvePhase(1, 12, true)).toBe('build');
  });

  it('reserva taper para as duas últimas semanas', () => {
    expect(resolvePhase(9, 12, true)).toBe('peak');
    expect(resolvePhase(10, 12, true)).toBe('taper');
    expect(resolvePhase(11, 12, true)).toBe('taper');
  });
});

describe('TrainingPlansService', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('gera plano cauteloso para iniciante sem histórico', async () => {
    const goal = makeGoal({
      threeKmTime: 1320,
      longestRunDistance: undefined,
      daysPerWeek: 4,
      runDays: ['Seg', 'Qua', 'Sex', 'Sáb'],
    });
    const profile = makeProfile({
      level: 'beginner',
      hasData: false,
      recentWeeklyKm: 0,
      typicalWeeklyKm: 0,
      longestRunKm: 0,
      longestRunPace: undefined,
      bestShortPace: undefined,
      bestMediumPace: undefined,
      bestLongPace: undefined,
      runsPerWeek: 0,
    });

    const { plans } = await generate(goal, profile);
    const sessions = allSessions(plans).filter((s) => s.type !== 'rest');

    expect(plans.length).toBeGreaterThan(0);
    expect(sessions.length).toBeGreaterThan(0);

    for (const session of sessions) {
      expect(Number.isFinite(session.plannedPace)).toBe(true);
      expect(session.plannedPace).toBeGreaterThanOrEqual(150);
      expect(session.plannedPace).toBeLessThanOrEqual(600);
      expect(session.plannedDistance).toBeGreaterThanOrEqual(2000);
    }

    expect(sessions.some((s) => s.type === 'tempo')).toBe(false);
    expect(sessions.some((s) => s.type === 'interval')).toBe(true);
  });

  it('não regride o longão de atleta experiente e gera paces realistas', async () => {
    const goal = makeGoal({
      targetDistance: 21097,
      longestRunDistance: 20000,
      threeKmTime: 1180,
    });
    const profile = makeProfile({
      level: 'intermediate',
      recentWeeklyKm: 40,
      longestRunKm: 20.7,
      bestShortPace: 334,
      bestMediumPace: 345,
      bestLongPace: 360,
    });

    const { plans } = await generate(goal, profile);
    const sessions = allSessions(plans);

    const longRunsByWeek = plans.map((plan) =>
      (plan.sessions ?? []).find((s) => s.type === 'long_run'),
    );

    expect(longRunsByWeek[0]).toBeDefined();
    expect(longRunsByWeek[0]!.plannedDistance).toBeGreaterThanOrEqual(20000);
    expect(longRunsByWeek[1]!.plannedDistance).toBeGreaterThanOrEqual(20000);
    expect(longRunsByWeek[2]!.plannedDistance).toBeGreaterThanOrEqual(20000);

    const intervals = sessions.filter((s) => s.type === 'interval');
    expect(intervals.length).toBeGreaterThan(0);

    for (const session of intervals) {
      expect(session.plannedPace).toBeGreaterThanOrEqual(300);
      expect(session.plannedPace).toBeLessThanOrEqual(400);
      expect(session.notes ?? '').not.toMatch(/-\d+:\d/);
    }
  });

  it('aplica deload a cada 4 semanas', async () => {
    const { plans } = await generate(
      makeGoal({ targetDistance: 42195, longestRunDistance: 25000 }),
      makeProfile({ level: 'intermediate', longestRunKm: 25 }),
    );

    expect(plans.length).toBeGreaterThanOrEqual(8);

    for (const deloadIndex of [3, 7]) {
      expect(weekVolume(plans[deloadIndex])).toBeLessThan(
        weekVolume(plans[deloadIndex - 1]),
      );
    }
  });

  it('rotaciona estímulos de qualidade ao longo do plano', async () => {
    const { plans } = await generate(
      makeGoal({ targetDistance: 21097, longestRunDistance: 18000 }),
      makeProfile({ level: 'intermediate', longestRunKm: 18 }),
    );

    const quality = allSessions(plans).filter((s) =>
      ['interval', 'tempo', 'fartlek'].includes(s.type),
    );
    const types = new Set(quality.map((s) => s.type));

    expect(types.size).toBeGreaterThanOrEqual(2);
    expect(types.has('interval')).toBe(true);
    expect(types.has('fartlek') || types.has('tempo')).toBe(true);

    for (const plan of plans) {
      const weekQuality = (plan.sessions ?? []).filter((s) =>
        ['interval', 'tempo', 'fartlek'].includes(s.type),
      );
      const weekTypes = new Set(weekQuality.map((s) => s.type));
      expect(weekTypes.size).toBe(weekQuality.length);
    }
  });

  it('adiciona blocos no pace da prova dentro do longão', async () => {
    const { plans } = await generate(
      makeGoal({ targetDistance: 21097, longestRunDistance: 20000 }),
      makeProfile({ level: 'intermediate', longestRunKm: 20 }),
    );

    const longRuns = allSessions(plans).filter((s) => s.type === 'long_run');
    const withBlocks = longRuns.filter((s) =>
      (s.notes ?? '').includes('pace da prova'),
    );

    expect(withBlocks.length).toBeGreaterThan(0);
  });

  it('reduz volume no taper e marca o dia da prova', async () => {
    const goal = makeGoal({
      targetDistance: 10000,
      targetDate: '2026-10-11T23:00:00.000Z',
      longestRunDistance: 16000,
    });

    const { plans } = await generate(
      goal,
      makeProfile({ level: 'intermediate', longestRunKm: 16 }),
    );

    const last = plans[plans.length - 1];
    expect(weekVolume(last)).toBeLessThan(weekVolume(plans[0]));

    const raceSessions = allSessions(plans).filter((s) => s.type === 'race');
    expect(raceSessions).toHaveLength(1);
    expect(raceSessions[0].plannedDistance).toBe(10000);
    expect(raceSessions[0].day).toBe('Dom');
  });

  it('gera semanas sem sessões faltando para dias de treino', async () => {
    const goal = makeGoal({
      targetDistance: 42195,
      longestRunDistance: 25000,
      daysPerWeek: 5,
    });

    const { plans } = await generate(
      goal,
      makeProfile({ level: 'advanced', longestRunKm: 25 }),
    );

    for (const plan of plans) {
      expect((plan.sessions ?? []).length).toBe(7);
    }
  });

  it('aceita meta de tempo conservadora e registra o veredito', async () => {
    const targetTime = 8500;
    const goal = makeGoal({ targetDistance: 21097, targetTime });
    const profile = makeProfile();

    const { plans, planRepository } = await generate(goal, profile);
    const race = raceSession(plans);

    expect(race).toBeDefined();
    const targetPace = targetTime / 21.097;
    expect(Math.abs(race!.plannedPace - targetPace)).toBeLessThanOrEqual(1);
    expect(targetNoteFrom(planRepository)).toContain('conservadora');
  });

  it('aceita meta de tempo realista usando o pace alvo', async () => {
    const profile = makeProfile();
    const { plans: baselinePlans } = await generate(
      makeGoal({ targetDistance: 21097 }),
      profile,
    );
    const predictedTime = raceSession(baselinePlans)!.plannedPace * 21.097;
    const targetTime = Math.round(predictedTime * 0.98);

    const { plans, planRepository } = await generate(
      makeGoal({ targetDistance: 21097, targetTime }),
      profile,
    );
    const race = raceSession(plans);

    const targetPace = targetTime / 21.097;
    expect(Math.abs(race!.plannedPace - targetPace)).toBeLessThanOrEqual(1);
    expect(targetNoteFrom(planRepository)).toContain('realista');
  });

  it('limita meta de tempo agressiva ao ganho realista e avisa', async () => {
    const profile = makeProfile();
    const { plans: baselinePlans } = await generate(
      makeGoal({ targetDistance: 21097 }),
      profile,
    );
    const predictedTime = raceSession(baselinePlans)!.plannedPace * 21.097;
    const targetTime = Math.round(predictedTime * 0.94);

    const { plans, planRepository } = await generate(
      makeGoal({ targetDistance: 21097, targetTime }),
      profile,
    );
    const race = raceSession(plans);

    const targetPace = targetTime / 21.097;
    expect(race!.plannedPace).toBeGreaterThan(targetPace);
    expect(targetNoteFrom(planRepository)).toContain('agressiva');
  });

  it('segue os dias de qualidade e o longão do histórico quando o formulário não define', async () => {
    const goal = makeGoal({
      targetDistance: 21097,
      longestRunDistance: 18000,
      runDays: [],
      longRunDay: undefined,
      daysPerWeek: 3,
    });
    const profile = makeProfile({
      level: 'intermediate',
      longestRunKm: 18,
      pattern: makePattern(),
    });

    const { plans } = await generate(goal, profile);
    const firstWeek = plans[0].sessions ?? [];

    const qualityDays = firstWeek
      .filter((s) => ['interval', 'tempo', 'fartlek'].includes(s.type))
      .map((s) => s.day)
      .sort();
    expect(qualityDays).toEqual(['Qui', 'Ter']);

    const longRun = firstWeek.find((s) => s.type === 'long_run');
    expect(longRun?.day).toBe('Dom');

    expect(firstWeek.filter((s) => s.type === 'rest').length).toBeGreaterThan(
      0,
    );
  });

  it('limita a qualidade semanal à mediana do histórico', async () => {
    const goal = makeGoal({
      targetDistance: 21097,
      longestRunDistance: 18000,
      runDays: [],
      longRunDay: undefined,
    });
    const profile = makeProfile({
      level: 'intermediate',
      longestRunKm: 18,
      pattern: makePattern({ qualityPerWeek: 1 }),
    });

    const { plans } = await generate(goal, profile);

    for (const plan of plans) {
      const quality = (plan.sessions ?? []).filter((s) =>
        ['interval', 'tempo', 'fartlek'].includes(s.type),
      );
      expect(quality.length).toBeLessThanOrEqual(1);
    }
  });

  it('usa o pace de tiro observado no histórico', async () => {
    const goal = makeGoal({ targetDistance: 10000 });
    const profile = makeProfile();
    const pattern = makePattern({
      typicalQuality: {
        interval: {
          count: 10,
          km: 9,
          pace: 350,
          repPace: 300,
          reps: ['800m'],
        },
      },
    });

    const { plans: baselinePlans } = await generate(goal, profile);
    const { plans } = await generate(goal, makeProfile({ pattern }));

    const relevant = (session: TrainingSession) =>
      session.type === 'interval' &&
      !(session.notes ?? '').includes('pace da prova');

    const baselineIntervals = allSessions(baselinePlans).filter(relevant);
    const intervals = allSessions(plans).filter(relevant);

    expect(baselineIntervals.length).toBeGreaterThan(0);
    expect(intervals.length).toBeGreaterThan(0);

    for (const session of intervals) {
      expect(session.plannedPace).toBeLessThanOrEqual(330);
    }

    expect(
      Math.min(...baselineIntervals.map((s) => s.plannedPace)),
    ).toBeGreaterThan(330);
  });

  it('ajusta o volume da qualidade ao histórico e explica a estrutura', async () => {
    const goal = makeGoal({ targetDistance: 21097, longestRunDistance: 18000 });
    const pattern = makePattern({
      typicalQuality: {
        interval: {
          count: 12,
          km: 6,
          pace: 350,
          repPace: 320,
          reps: ['800m'],
        },
      },
    });
    const profile = makeProfile({ level: 'intermediate', longestRunKm: 18 });

    const { plans, planRepository } = await generate(
      goal,
      makeProfile({ ...profile, pattern }),
    );

    const intervals = allSessions(plans).filter(
      (s) =>
        s.type === 'interval' && !(s.notes ?? '').includes('pace da prova'),
    );

    expect(intervals.length).toBeGreaterThan(0);
    for (const session of intervals) {
      expect(session.plannedDistance).toBeLessThanOrEqual(8200);
    }

    const notes = allCoachNotes(planRepository);
    expect(notes).toContain('histórico');
    expect(notes).toContain('longão');
  });

  it('escala a qualidade para respeitar o teto de 20%', () => {
    expect(qualityMainScale(50, 8, 0.2)).toBe(1);
    expect(qualityMainScale(50, 20, 0.2)).toBeCloseTo(0.5, 5);
    expect(qualityMainScale(50, 0, 0.2)).toBe(1);
  });

  it('mantém a progressão semanal dentro de 10% e reentrada segura após deload', async () => {
    const goal = makeGoal({
      targetDistance: 21097,
      longestRunDistance: 18000,
    });
    const profile = makeProfile({
      recentWeeklyKm: 40,
      peakWeeklyKm: 45,
      longestRunKm: 18,
      pattern: makePattern({ longRun: { km: 17, pace: 380 }, easyKm: 8 }),
    });

    const { plans } = await generate(goal, profile);
    const volumes = plans.map((plan) => weekVolume(plan) / 1000);
    const longs = plans.map(
      (plan) =>
        (plan.sessions ?? []).find((session) => session.type === 'long_run')
          ?.plannedDistance ?? 0,
    );
    const deloadIndexes = [3, 7];
    const taperStart = plans.length - 2;

    expect(longs[0] / 1000).toBeCloseTo(17, 0);

    for (let i = 1; i < taperStart; i++) {
      if (deloadIndexes.includes(i)) {
        expect(volumes[i]).toBeLessThan(volumes[i - 1]);
        continue;
      }

      const afterDeload = deloadIndexes.includes(i - 1);
      const reference = afterDeload ? volumes[i - 2] : volumes[i - 1];
      const allowed = reference * (afterDeload ? 1.05 : 1.1) + 0.4;
      expect(volumes[i]).toBeLessThanOrEqual(allowed);

      if (!afterDeload) {
        expect(longs[i]).toBeLessThanOrEqual(longs[i - 1] * 1.1 + 50);
      }
    }
  });

  it('limita o volume forte da qualidade a 20% da semana', async () => {
    const goal = makeGoal({
      targetDistance: 21097,
      longestRunDistance: 18000,
    });
    const pattern = makePattern({
      longRun: { km: 17, pace: 380 },
      easyKm: 8,
      typicalQuality: {
        interval: {
          count: 12,
          km: 20,
          pace: 345,
          repPace: 300,
          reps: ['1km'],
          repSets: [{ count: 10, size: '1km', sizeKm: 1 }],
        },
      },
    });
    const profile = makeProfile({
      recentWeeklyKm: 40,
      peakWeeklyKm: 45,
      longestRunKm: 18,
      pattern,
    });

    const { plans } = await generate(goal, profile);
    const taperStart = plans.length - 2;

    for (let i = 0; i < taperStart; i++) {
      const weekKm = weekVolume(plans[i]) / 1000;
      let hardKm = 0;

      for (const session of plans[i].sessions ?? []) {
        if (session.type !== 'interval') continue;
        const match = (session.notes ?? '').match(
          /(\d+) repetições de ([\d.,]+)(km|m)/,
        );
        if (!match) continue;

        const reps = Number(match[1]);
        const size = Number(match[2].replace(',', '.'));
        hardKm += match[3] === 'km' ? reps * size : (reps * size) / 1000;
      }

      expect(hardKm).toBeLessThanOrEqual(weekKm * 0.2 + 0.6);
    }
  });

  it('reaproveita a estrutura de tiros do atleta e evolui por fase', async () => {
    const goal = makeGoal({
      targetDistance: 21097,
      longestRunDistance: 18000,
    });
    const pattern = makePattern({
      longRun: { km: 17, pace: 380 },
      easyKm: 8,
      typicalQuality: {
        interval: {
          count: 12,
          km: 10,
          pace: 345,
          repPace: 300,
          reps: ['600m'],
          repSets: [{ count: 6, size: '600m', sizeKm: 0.6 }],
        },
      },
    });
    const profile = makeProfile({
      recentWeeklyKm: 60,
      peakWeeklyKm: 70,
      longestRunKm: 18,
      pattern,
    });

    const { plans } = await generate(goal, profile);
    const repeats = allSessions(plans)
      .filter((session) => session.type === 'interval')
      .map(
        (session) =>
          (session.notes ?? '').match(/(\d+) repetições de 600m/)?.[1],
      )
      .filter((value): value is string => !!value)
      .map(Number);

    expect(repeats.length).toBeGreaterThan(0);
    expect(repeats).toContain(6);
    expect(repeats.some((reps) => reps > 6)).toBe(true);
  });

  it('não reaproveita estrutura de tiro que não é esforço de qualidade', async () => {
    const goal = makeGoal({
      targetDistance: 21097,
      longestRunDistance: 18000,
    });
    const pattern = makePattern({
      typicalQuality: {
        interval: {
          count: 8,
          km: 8,
          pace: 380,
          repPace: 380,
          reps: ['600m'],
          repSets: [{ count: 6, size: '600m', sizeKm: 0.6 }],
        },
      },
    });

    const { plans } = await generate(goal, makeProfile({ pattern }));
    const historySessions = allSessions(plans).filter((session) =>
      (session.notes ?? '').includes('repetições de 600m'),
    );

    expect(historySessions).toHaveLength(0);
  });

  it('preserva a distância típica das corridas leves ajustando a qualidade', async () => {
    const goal = makeGoal({
      targetDistance: 21097,
      longestRunDistance: 18000,
    });
    const pattern = makePattern({
      easyKm: 8,
      typicalQuality: {
        interval: {
          count: 12,
          km: 20,
          pace: 345,
          repPace: 300,
          reps: ['1km'],
          repSets: [{ count: 10, size: '1km', sizeKm: 1 }],
        },
        tempo: {
          count: 6,
          km: 12,
          pace: 355,
          repPace: 340,
          reps: [],
          repSets: [],
        },
      },
    });
    const profile = makeProfile({
      recentWeeklyKm: 40,
      peakWeeklyKm: 45,
      longestRunKm: 18,
      pattern,
    });

    const { plans } = await generate(goal, profile);
    const taperStart = plans.length - 2;
    const deloadIndexes = [3, 7];
    const easyDistances = plans
      .filter(
        (_, index) => index < taperStart && !deloadIndexes.includes(index),
      )
      .flatMap((plan) =>
        (plan.sessions ?? [])
          .filter((session) => session.type === 'easy')
          .map((session) => session.plannedDistance / 1000),
      );

    expect(easyDistances.length).toBeGreaterThan(0);
    expect(Math.min(...easyDistances)).toBeGreaterThanOrEqual(6.9);
  });

  it('monta plano coerente sem histórico respeitando dias e longão do formulário', async () => {
    const goal = makeGoal({
      targetDistance: 21097,
      longestRunDistance: undefined,
      longestRunTime: undefined,
      runDays: [],
      longRunDay: 'Dom',
      daysPerWeek: 5,
    });
    const profile = makeProfile({
      hasData: false,
      recentWeeklyKm: 0,
      peakWeeklyKm: 0,
      longestRunKm: 0,
      bestShortPace: undefined,
      bestMediumPace: undefined,
      bestLongPace: undefined,
      runsPerWeek: 0,
      pattern: emptyTrainingPattern(),
    });

    const { plans } = await generate(goal, profile);
    const firstWeek = plans[0].sessions ?? [];
    const trainingDays = firstWeek.filter((session) => session.type !== 'rest');

    expect(trainingDays).toHaveLength(5);
    expect(firstWeek.find((session) => session.type === 'long_run')?.day).toBe(
      'Dom',
    );

    for (const session of trainingDays) {
      expect(session.plannedPace).toBeGreaterThanOrEqual(150);
      expect(session.plannedDistance).toBeGreaterThan(0);
    }
  });

  it('inclui zona e pace nas sessões quando há FC máxima observada', async () => {
    const goal = makeGoal({ targetDistance: 10000 });
    const profile = makeProfile({
      maxHeartRate: 190,
      pattern: makePattern(),
    });

    const { plans } = await generate(goal, profile);
    const sessions = allSessions(plans).filter(
      (session) => session.type !== 'rest',
    );
    const easy = sessions.filter((session) => session.type === 'easy');
    const intervals = sessions.filter((session) => session.type === 'interval');

    expect(easy.length).toBeGreaterThan(0);
    expect(
      easy.every((session) => (session.notes ?? '').includes('Z2 (FC')),
    ).toBe(true);

    expect(intervals.length).toBeGreaterThan(0);
    expect(
      intervals.some((session) => (session.notes ?? '').includes('Z4 (FC')),
    ).toBe(true);
    expect(
      intervals.some((session) =>
        (session.notes ?? '').includes('Pace médio por tiro'),
      ),
    ).toBe(true);
  });
});
