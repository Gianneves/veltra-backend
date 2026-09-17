import { TrainingPlansService } from './training-plans.service';
import { resolvePhase } from './workout-library';
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
});
