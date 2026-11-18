import { BadRequestException } from '@nestjs/common';
import { TrainingPlansService } from './training-plans.service';
import { qualityMainScale, resolvePhase } from './workout-library';
import { TrainingPattern, emptyTrainingPattern } from './training-pattern';
import { Goal } from 'src/goals/entities/goal.entity';
import type { Activity } from 'src/activities/entities/activity.entity';
import type { AthleteProfile } from './athlete-profile.service';
import { TrainingPlan } from './entities/training-plan.entity';
import { TrainingSession } from './entities/training-session.entity';

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
    recentForm: {
      windowStart: '2026-08-23T03:00:00.000Z',
      windowEnd: '2026-09-13T03:00:00.000Z',
      weeks: 3,
      hasData: false,
      runs: 0,
      weeklyKm: 0,
      peakWeeklyKm: 0,
      runsPerWeek: 0,
      longestKm: 0,
    },
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

  return {
    service,
    planRepository,
    sessionRepository,
    athleteProfileService,
  };
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

  it('pede o perfil recente (recentOnly) ao regenerar o plano', async () => {
    const goal = makeGoal();
    const mocks = createMocks(makeProfile());

    await mocks.service.regenerateFromGoal(goal, { startDate: START });

    expect(mocks.athleteProfileService.build).toHaveBeenCalledWith(
      'user-1',
      goal,
      expect.any(Date),
      { recentOnly: true },
    );
  });

  it('adiciona nota de calibração das últimas 3 semanas', async () => {
    const goal = makeGoal({ targetDistance: 10000, threeKmTime: 1200 });
    const profile = makeProfile({
      recentForm: {
        windowStart: '2026-08-23T03:00:00.000Z',
        windowEnd: '2026-09-13T03:00:00.000Z',
        weeks: 3,
        hasData: true,
        runs: 9,
        weeklyKm: 28.5,
        peakWeeklyKm: 32,
        runsPerWeek: 3,
        longestKm: 12,
      },
      threeKm: { time: 1200, pace: 400, level: 'novice' },
    });

    const { planRepository } = await generate(goal, profile);

    expect(allCoachNotes(planRepository)).toContain(
      'Plano calibrado pelas suas últimas 3 semanas de treino',
    );
  });

  it('usa o teste de 3 km quando não há corridas nas últimas 3 semanas', async () => {
    const goal = makeGoal({ targetDistance: 21097, threeKmTime: 1260 });
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
      threeKm: { time: 1260, pace: 420, level: 'beginner' },
    });

    const { planRepository, plans } = await generate(goal, profile);
    const sessions = allSessions(plans).filter((s) => s.type !== 'rest');

    expect(allCoachNotes(planRepository)).toContain(
      'Sem corridas nas últimas 3 semanas',
    );
    expect(sessions.length).toBeGreaterThan(0);
  });
});

describe('updateSessionsBatch', () => {
  async function rejectionOf(
    promise: Promise<unknown>,
  ): Promise<{ code?: string; message?: string }> {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      return (error as BadRequestException).getResponse() as {
        code?: string;
        message?: string;
      };
    }
    throw new Error('esperava uma recusa');
  }

  interface BatchRow {
    id: string;
    day: string;
    dayOrder: number;
    type: string;
    plannedDistance: number;
    plannedPace: number;
    planId?: string;
    completed?: boolean;
    activityId?: string | null;
    actualDistance?: number | null;
    actualPace?: number | null;
    actualMovingTime?: number | null;
    matchScore?: number | null;
    matchMethod?: string | null;
    matchedAt?: Date | null;
  }

  function batchMocks(
    initial: BatchRow[],
    options: { age?: number; plannedWeeklyKm?: number } = {},
  ) {
    const store = new Map<string, BatchRow>(
      initial.map((s) => [s.id, { ...s, planId: 'plan-1' }]),
    );
    const initialVolume = initial
      .filter((s) => s.type !== 'rest')
      .reduce((sum, s) => sum + (s.plannedDistance ?? 0), 0);
    const plan = {
      id: 'plan-1',
      userId: 'user-1',
      plannedWeeklyKm: options.plannedWeeklyKm ?? initialVolume,
    };
    const planRepository = {
      findOne: jest.fn(
        ({
          where,
        }: {
          where: { id?: string; userId?: string };
        }): Promise<typeof plan | null> =>
          Promise.resolve(
            where?.id === plan.id && where?.userId === plan.userId
              ? plan
              : null,
          ),
      ),
      save: jest.fn((item: typeof plan) => {
        Object.assign(plan, item);
        return Promise.resolve(item);
      }),
    };
    const sessionRepository = {
      find: jest.fn(
        (): Promise<BatchRow[]> => Promise.resolve([...store.values()]),
      ),
      findOne: jest.fn(
        ({
          where,
        }: {
          where: { id?: string; day?: string };
        }): Promise<BatchRow | null> =>
          Promise.resolve(
            where?.id
              ? (store.get(where.id) ?? null)
              : ([...store.values()].find((s) => s.day === where?.day) ?? null),
          ),
      ),
      save: jest.fn(
        (s: BatchRow | BatchRow[]): Promise<BatchRow | BatchRow[]> => {
          const items = Array.isArray(s) ? s : [s];
          for (const item of items) store.set(item.id, { ...item });
          return Promise.resolve(Array.isArray(s) ? items : { ...s });
        },
      ),
    };
    const athleteProfileService = {
      getAge: jest.fn(
        (): Promise<number | undefined> => Promise.resolve(options.age),
      ),
    };
    const manager = {
      getRepository: (entity: unknown) =>
        entity === TrainingPlan ? planRepository : sessionRepository,
    };
    // Serializa as transações como a trava `pessimistic_write` do Postgres: a
    // segunda só lê o estado depois de a primeira terminar.
    let queue: Promise<unknown> = Promise.resolve();
    const dataSource = {
      transaction: jest.fn(
        <T>(fn: (manager: typeof manager) => Promise<T>): Promise<T> => {
          const run = queue.then(() => fn(manager));
          queue = run.then(
            () => undefined,
            () => undefined,
          );
          return run;
        },
      ),
    };
    const service = new TrainingPlansService(
      planRepository as any,
      sessionRepository as any,
      {} as any,
      {} as any,
      athleteProfileService as any,
      {} as any,
      {} as any,
      dataSource as any,
    );
    return {
      service,
      store,
      plan,
      sessionRepository,
      planRepository,
      dataSource,
      athleteProfileService,
    };
  }

  it('aplica swap de dias em lote de forma atômica', async () => {
    const { service, store } = batchMocks([
      {
        id: 'a',
        day: 'Ter',
        dayOrder: 1,
        type: 'easy',
        plannedDistance: 8000,
        plannedPace: 360,
      },
      {
        id: 'b',
        day: 'Qui',
        dayOrder: 3,
        type: 'tempo',
        plannedDistance: 6000,
        plannedPace: 340,
      },
    ]);

    const updated = await service.updateSessionsBatch('plan-1', 'user-1', [
      { sessionId: 'a', day: 'Qui' },
      { sessionId: 'b', day: 'Ter' },
    ]);

    expect(updated).toHaveLength(2);
    expect(store.get('a')?.day).toBe('Qui');
    expect(store.get('a')?.dayOrder).toBe(3);
    expect(store.get('b')?.day).toBe('Ter');
  });

  it('rejeita lote que criaria dia duplicado sem aplicar nada', async () => {
    const { service, store, sessionRepository } = batchMocks([
      {
        id: 'a',
        day: 'Ter',
        dayOrder: 1,
        type: 'easy',
        plannedDistance: 8000,
        plannedPace: 360,
      },
      {
        id: 'b',
        day: 'Qui',
        dayOrder: 3,
        type: 'tempo',
        plannedDistance: 6000,
        plannedPace: 340,
      },
    ]);

    const promise = service.updateSessionsBatch('plan-1', 'user-1', [
      { sessionId: 'a', day: 'Qui' },
    ]);

    await expect(promise).rejects.toBeInstanceOf(BadRequestException);
    await expect(promise).rejects.toMatchObject({
      response: { code: 'DAY_COLLISION' },
    });
    expect(sessionRepository.save).not.toHaveBeenCalled();
    expect(store.get('a')?.day).toBe('Ter');
  });

  function completedRow(): BatchRow {
    return {
      id: 'a',
      day: 'Ter',
      dayOrder: 1,
      type: 'easy',
      plannedDistance: 8000,
      plannedPace: 360,
      completed: true,
      activityId: 'activity-9',
      actualDistance: 8100,
      actualPace: 358,
      actualMovingTime: 2900,
      matchScore: 0.93,
      matchMethod: 'auto',
      matchedAt: new Date('2026-09-15T10:00:00.000Z'),
    };
  }

  function expectRestCleared(saved?: BatchRow): void {
    expect(saved?.type).toBe('rest');
    expect(saved?.completed).toBe(false);
    expect(saved?.activityId).toBeNull();
    expect(saved?.actualDistance).toBeNull();
    expect(saved?.actualPace).toBeNull();
    expect(saved?.actualMovingTime).toBeNull();
    expect(saved?.matchScore).toBeNull();
    expect(saved?.matchMethod).toBeNull();
    expect(saved?.matchedAt).toBeNull();
    expect(saved?.plannedDistance).toBe(0);
    expect(saved?.plannedPace).toBe(0);
  }

  it('converte sessão concluída em descanso limpando conclusão, vínculo e realizados', async () => {
    const { service, store } = batchMocks([completedRow()]);

    await service.updateSession('plan-1', 'a', 'user-1', { type: 'rest' });

    expectRestCleared(store.get('a'));
  });

  it('lote converte sessão concluída em descanso limpando conclusão e realizados', async () => {
    const { service, store } = batchMocks([completedRow()]);

    await service.updateSessionsBatch('plan-1', 'user-1', [
      { sessionId: 'a', type: 'rest' },
    ]);

    expectRestCleared(store.get('a'));
  });

  it('converter descanso em treino devolve a sessão planejada, sem conclusão', async () => {
    const { service, store } = batchMocks([
      {
        id: 'a',
        day: 'Qua',
        dayOrder: 2,
        type: 'rest',
        plannedDistance: 0,
        plannedPace: 0,
        completed: false,
        activityId: null,
        actualDistance: null,
        actualPace: null,
      },
    ]);

    await service.updateSession('plan-1', 'a', 'user-1', {
      type: 'easy',
      plannedDistance: 5000,
      plannedPace: 360,
    });

    const saved = store.get('a');
    expect(saved?.type).toBe('easy');
    expect(saved?.plannedDistance).toBe(5000);
    expect(saved?.plannedPace).toBe(360);
    expect(saved?.completed).toBe(false);
    expect(saved?.actualDistance).toBeNull();
    expect(saved?.activityId).toBeNull();
  });

  it('converter descanso legado em treino pelo lote não devolve conclusão', async () => {
    const { service, store } = batchMocks([
      {
        id: 'a',
        day: 'Qua',
        dayOrder: 2,
        type: 'rest',
        plannedDistance: 0,
        plannedPace: 0,
        completed: true,
        activityId: 'activity-9',
        actualDistance: 9000,
        actualPace: 380,
        actualMovingTime: 3420,
        matchScore: 0.91,
        matchMethod: 'auto',
        matchedAt: new Date('2026-09-16T10:00:00.000Z'),
      },
    ]);

    await service.updateSessionsBatch('plan-1', 'user-1', [
      {
        sessionId: 'a',
        type: 'easy',
        plannedDistance: 5000,
        plannedPace: 360,
      },
    ]);

    const saved = store.get('a');
    expect(saved?.type).toBe('easy');
    expect(saved?.plannedDistance).toBe(5000);
    expect(saved?.plannedPace).toBe(360);
    expect(saved?.completed).toBe(false);
    expect(saved?.activityId).toBeNull();
    expect(saved?.actualDistance).toBeNull();
    expect(saved?.matchScore).toBeNull();
    expect(saved?.matchedAt).toBeNull();
  });

  it('rejeita dia duplicado no PUT individual', async () => {
    const { service } = batchMocks([
      {
        id: 'a',
        day: 'Ter',
        dayOrder: 1,
        type: 'easy',
        plannedDistance: 8000,
        plannedPace: 360,
      },
      {
        id: 'b',
        day: 'Qui',
        dayOrder: 3,
        type: 'tempo',
        plannedDistance: 6000,
        plannedPace: 340,
      },
    ]);

    const promise = service.updateSession('plan-1', 'a', 'user-1', {
      day: 'Qui',
    });

    await expect(promise).rejects.toBeInstanceOf(BadRequestException);
    await expect(promise).rejects.toMatchObject({
      response: { code: 'DAY_COLLISION' },
    });
  });

  it('recusa edição individual que estoura o volume semanal da idade sem gravar nada', async () => {
    const { service, store, plan, sessionRepository, planRepository } =
      batchMocks(
        [
          {
            id: 'rest',
            day: 'Seg',
            dayOrder: 0,
            type: 'rest',
            plannedDistance: 0,
            plannedPace: 0,
          },
          {
            id: 'a',
            day: 'Ter',
            dayOrder: 1,
            type: 'easy',
            plannedDistance: 6000,
            plannedPace: 360,
          },
          {
            id: 'b',
            day: 'Qui',
            dayOrder: 3,
            type: 'long_run',
            plannedDistance: 6000,
            plannedPace: 380,
          },
          {
            id: 'c',
            day: 'Sáb',
            dayOrder: 5,
            type: 'easy',
            plannedDistance: 6000,
            plannedPace: 360,
          },
        ],
        { age: 12, plannedWeeklyKm: 18000 },
      );

    const promise = service.updateSession('plan-1', 'rest', 'user-1', {
      type: 'easy',
      plannedDistance: 5000,
      plannedPace: 400,
    });

    const response = await rejectionOf(promise);
    expect(response.code).toBe('AGE_POLICY');
    expect(response.message).toContain('23,0 km de volume planejado');
    expect(response.message).toContain('limite é 20 km');

    expect(sessionRepository.save).not.toHaveBeenCalled();
    expect(planRepository.save).not.toHaveBeenCalled();
    expect(plan.plannedWeeklyKm).toBe(18000);
    expect(store.get('rest')?.type).toBe('rest');
    expect(store.get('rest')?.plannedDistance).toBe(0);
  });

  it('lote recusa qualidade acima do limite da idade sem gravar nada', async () => {
    const { service, store, sessionRepository, planRepository } = batchMocks(
      [
        {
          id: 'a',
          day: 'Ter',
          dayOrder: 1,
          type: 'tempo',
          plannedDistance: 5000,
          plannedPace: 340,
        },
        {
          id: 'b',
          day: 'Qui',
          dayOrder: 3,
          type: 'easy',
          plannedDistance: 4000,
          plannedPace: 380,
        },
        {
          id: 'c',
          day: 'Sáb',
          dayOrder: 5,
          type: 'easy',
          plannedDistance: 4000,
          plannedPace: 380,
        },
      ],
      { age: 15 },
    );

    const promise = service.updateSessionsBatch('plan-1', 'user-1', [
      { sessionId: 'b', type: 'interval' },
      { sessionId: 'c', type: 'fartlek' },
    ]);

    const response = await rejectionOf(promise);
    expect(response.code).toBe('AGE_POLICY');
    expect(response.message).toContain('3 sessões de qualidade');
    expect(response.message).toContain('limite é 1');

    expect(sessionRepository.save).not.toHaveBeenCalled();
    expect(planRepository.save).not.toHaveBeenCalled();
    expect(store.get('b')?.type).toBe('easy');
    expect(store.get('c')?.type).toBe('easy');
  });

  it('aceita distância acima do teto com acknowledgeAgePolicy', async () => {
    const { service, store, plan } = batchMocks(
      [
        {
          id: 'a',
          day: 'Ter',
          dayOrder: 1,
          type: 'easy',
          plannedDistance: 5000,
          plannedPace: 380,
        },
      ],
      { age: 12 },
    );

    const saved = await service.updateSession('plan-1', 'a', 'user-1', {
      plannedDistance: 8000,
      acknowledgeAgePolicy: true,
    });

    expect(saved?.plannedDistance).toBe(8000);
    expect(store.get('a')?.plannedDistance).toBe(8000);
    expect(plan.plannedWeeklyKm).toBe(8000);
  });

  it('mantém as recusas de volume e qualidade mesmo com acknowledgeAgePolicy', async () => {
    const volume = batchMocks(
      [
        {
          id: 'rest',
          day: 'Seg',
          dayOrder: 0,
          type: 'rest',
          plannedDistance: 0,
          plannedPace: 0,
        },
        {
          id: 'a',
          day: 'Ter',
          dayOrder: 1,
          type: 'easy',
          plannedDistance: 6000,
          plannedPace: 360,
        },
        {
          id: 'b',
          day: 'Qui',
          dayOrder: 3,
          type: 'long_run',
          plannedDistance: 6000,
          plannedPace: 380,
        },
        {
          id: 'c',
          day: 'Sáb',
          dayOrder: 5,
          type: 'easy',
          plannedDistance: 6000,
          plannedPace: 360,
        },
      ],
      { age: 12, plannedWeeklyKm: 18000 },
    );

    const volumeResponse = await rejectionOf(
      volume.service.updateSession('plan-1', 'rest', 'user-1', {
        type: 'easy',
        plannedDistance: 5000,
        plannedPace: 400,
        acknowledgeAgePolicy: true,
      }),
    );
    expect(volumeResponse.code).toBe('AGE_POLICY');
    expect(volumeResponse.message).toContain('volume planejado');
    expect(volume.sessionRepository.save).not.toHaveBeenCalled();

    const quality = batchMocks(
      [
        {
          id: 'a',
          day: 'Ter',
          dayOrder: 1,
          type: 'tempo',
          plannedDistance: 5000,
          plannedPace: 340,
        },
        {
          id: 'b',
          day: 'Qui',
          dayOrder: 3,
          type: 'easy',
          plannedDistance: 4000,
          plannedPace: 380,
        },
        {
          id: 'c',
          day: 'Sáb',
          dayOrder: 5,
          type: 'easy',
          plannedDistance: 4000,
          plannedPace: 380,
        },
      ],
      { age: 15 },
    );

    const qualityResponse = await rejectionOf(
      quality.service.updateSessionsBatch('plan-1', 'user-1', [
        { sessionId: 'b', type: 'interval', acknowledgeAgePolicy: true },
        { sessionId: 'c', type: 'fartlek', acknowledgeAgePolicy: true },
      ]),
    );
    expect(qualityResponse.code).toBe('AGE_POLICY');
    expect(qualityResponse.message).toContain('sessões de qualidade');
    expect(quality.sessionRepository.save).not.toHaveBeenCalled();
  });

  it('serializa duas edições concorrentes no mesmo plano e a segunda vê o estado da primeira', async () => {
    const { service, store } = batchMocks(
      [
        {
          id: 'a',
          day: 'Ter',
          dayOrder: 1,
          type: 'easy',
          plannedDistance: 8000,
          plannedPace: 360,
        },
        {
          id: 'b',
          day: 'Qui',
          dayOrder: 3,
          type: 'easy',
          plannedDistance: 6000,
          plannedPace: 360,
        },
      ],
      { plannedWeeklyKm: 14000 },
    );

    const results = await Promise.allSettled([
      service.updateSession('plan-1', 'a', 'user-1', { day: 'Sáb' }),
      service.updateSession('plan-1', 'b', 'user-1', { day: 'Sáb' }),
    ]);

    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({
      response: { code: 'DAY_COLLISION' },
    });

    expect(store.get('a')?.day).toBe('Sáb');
    expect(store.get('b')?.day).toBe('Qui');
  });

  it('grava plannedWeeklyKm com o volume do estado final após edição individual e após lote', async () => {
    const { service, plan } = batchMocks(
      [
        {
          id: 'a',
          day: 'Ter',
          dayOrder: 1,
          type: 'easy',
          plannedDistance: 8000,
          plannedPace: 360,
        },
        {
          id: 'b',
          day: 'Qui',
          dayOrder: 3,
          type: 'easy',
          plannedDistance: 6000,
          plannedPace: 360,
        },
      ],
      { plannedWeeklyKm: 999 },
    );

    await service.updateSession('plan-1', 'a', 'user-1', {
      plannedDistance: 9000,
    });
    expect(plan.plannedWeeklyKm).toBe(15000);

    await service.updateSessionsBatch('plan-1', 'user-1', [
      { sessionId: 'b', plannedDistance: 5000 },
    ]);
    expect(plan.plannedWeeklyKm).toBe(14000);
  });

  it('não aplica limites de idade na edição sem birthDate', async () => {
    const { service, store } = batchMocks([
      {
        id: 'a',
        day: 'Ter',
        dayOrder: 1,
        type: 'easy',
        plannedDistance: 30000,
        plannedPace: 360,
      },
      {
        id: 'b',
        day: 'Qui',
        dayOrder: 3,
        type: 'easy',
        plannedDistance: 20000,
        plannedPace: 360,
      },
    ]);

    const updated = await service.updateSessionsBatch('plan-1', 'user-1', [
      { sessionId: 'a', type: 'interval' },
      { sessionId: 'b', type: 'fartlek' },
    ]);

    expect(updated).toHaveLength(2);
    expect(store.get('a')?.type).toBe('interval');
    expect(store.get('b')?.type).toBe('fartlek');
  });
});

describe('leitura de plano', () => {
  const weekStart = (() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return start;
  })();

  function readMocks() {
    const legacyRest = {
      id: 'rest-1',
      planId: 'plan-1',
      day: 'Qua',
      dayOrder: 2,
      type: 'rest',
      plannedDistance: 0,
      plannedPace: 0,
      completed: true,
      activityId: 'activity-9',
      actualDistance: 9000,
      actualPace: 380,
      actualMovingTime: 3420,
      matchScore: 0.91,
      matchMethod: 'auto',
      matchedAt: new Date('2026-09-16T10:00:00.000Z'),
    } as TrainingSession;
    const sessions = [
      legacyRest,
      {
        id: 'easy-1',
        planId: 'plan-1',
        day: 'Ter',
        dayOrder: 1,
        type: 'easy',
        plannedDistance: 8000,
        plannedPace: 360,
        completed: false,
      },
      {
        id: 'tempo-1',
        planId: 'plan-1',
        day: 'Qui',
        dayOrder: 3,
        type: 'tempo',
        plannedDistance: 5000,
        plannedPace: 340,
        completed: false,
      },
    ] as TrainingSession[];
    const plan = {
      id: 'plan-1',
      userId: 'user-1',
      weekStart: weekStart.toISOString(),
      plannedWeeklyKm: 999,
      sessions,
    } as TrainingPlan;
    const planRepository = {
      findOne: jest.fn(() => Promise.resolve(plan)),
      find: jest.fn(() => Promise.resolve([plan])),
      save: jest.fn((item: TrainingPlan) => Promise.resolve(item)),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
    };
    const sessionRepository = {
      save: jest.fn((session: TrainingSession) => Promise.resolve(session)),
    };
    const service = new TrainingPlansService(
      planRepository as any,
      sessionRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, planRepository, sessionRepository };
  }

  function readByPath(
    service: TrainingPlansService,
    path: 'current' | 'list' | 'week',
  ): Promise<TrainingPlan | null | undefined> {
    if (path === 'current') return service.findCurrent('user-1');
    if (path === 'list') {
      return service.findAll('user-1').then((plans) => plans[0]);
    }
    return service.findByWeek('user-1', weekStart.toISOString());
  }

  it('normaliza descanso legado nos três caminhos de leitura', async () => {
    for (const path of ['current', 'list', 'week'] as const) {
      const { service, planRepository, sessionRepository } = readMocks();

      const plan = await readByPath(service, path);
      const rest = plan?.sessions.find((session) => session.id === 'rest-1');

      expect(rest?.completed).toBe(false);
      expect(rest?.activityId).toBeNull();
      expect(rest?.actualDistance).toBeNull();
      expect(rest?.actualPace).toBeNull();
      expect(rest?.actualMovingTime).toBeNull();
      expect(rest?.matchScore).toBeNull();
      expect(rest?.matchMethod).toBeNull();
      expect(rest?.matchedAt).toBeNull();
      expect(rest?.plannedDistance).toBe(0);
      expect(rest?.plannedPace).toBe(0);
      expect(sessionRepository.save).not.toHaveBeenCalled();
      expect(planRepository.save).not.toHaveBeenCalled();
      expect(planRepository.update).not.toHaveBeenCalled();
    }
  });

  it('devolve plannedWeeklyKm como a soma das distâncias planejadas não-descanso, em metros', async () => {
    for (const path of ['current', 'list', 'week'] as const) {
      const { service } = readMocks();

      const plan = await readByPath(service, path);

      expect(plan?.plannedWeeklyKm).toBe(13000);
    }
  });
});
