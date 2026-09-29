import { VolumeAdjustmentService } from './volume-adjustment.service';
import type { TrainingPlan } from './entities/training-plan.entity';
import type { TrainingSession } from './entities/training-session.entity';

function startOfDay(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

function currentWeekStart(): Date {
  const start = startOfDay(new Date());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function makeSession(
  overrides: Partial<TrainingSession> = {},
): TrainingSession {
  return {
    id: `session-${Math.random()}`,
    planId: 'plan-1',
    day: 'Ter',
    dayOrder: 1,
    type: 'easy',
    plannedDistance: 10000,
    plannedPace: 420,
    notes: '',
    completed: false,
    ...overrides,
  } as TrainingSession;
}

function makePlan(
  sessions: TrainingSession[],
  overrides: Partial<TrainingPlan> = {},
): TrainingPlan {
  return {
    id: 'plan-1',
    userId: 'user-1',
    weekStart: currentWeekStart().toISOString(),
    plannedWeeklyKm: sessions
      .filter((s) => s.type !== 'rest')
      .reduce((sum, s) => sum + (s.plannedDistance ?? 0), 0),
    sessions,
    ...overrides,
  } as TrainingPlan;
}

function createService() {
  const planRepository = {
    findOne: jest.fn(() => Promise.resolve<TrainingPlan | null>(null)),
    update: jest.fn(() => Promise.resolve({ affected: 1 })),
  };
  const sessionRepository = {
    save: jest.fn((items: TrainingSession[]) => Promise.resolve(items)),
  };

  const service = new VolumeAdjustmentService(
    planRepository as any,
    sessionRepository as any,
  );

  return { service, planRepository, sessionRepository };
}

describe('VolumeAdjustmentService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 16, 10, 0, 0));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const trigger = makeSession({
    dayOrder: (new Date().getDay() + 6) % 7,
    completed: true,
    actualDistance: 12000,
  });

  it('não age em excesso trivial (menos de 1 km)', async () => {
    const { service, planRepository, sessionRepository } = createService();
    planRepository.findOne.mockResolvedValue(
      makePlan([
        makeSession({ dayOrder: 2, completed: true, actualDistance: 10800 }),
        makeSession({ dayOrder: 3, plannedDistance: 10000 }),
        makeSession({ dayOrder: 4, plannedDistance: 10000 }),
      ]),
    );

    await service.adjustForOvershoot({
      ...trigger,
      plannedDistance: 10000,
      actualDistance: 10800,
    });

    expect(sessionRepository.save).not.toHaveBeenCalled();
    expect(planRepository.update).not.toHaveBeenCalled();
  });

  it('não age quando excesso proporcional é <= 15%', async () => {
    const { service, planRepository, sessionRepository } = createService();
    planRepository.findOne.mockResolvedValue(
      makePlan([
        makeSession({ dayOrder: 2, completed: true, actualDistance: 13200 }),
        makeSession({ dayOrder: 3, plannedDistance: 10000 }),
        makeSession({ dayOrder: 4, plannedDistance: 10000 }),
      ]),
    );

    await service.adjustForOvershoot({
      ...trigger,
      plannedDistance: 12000,
      actualDistance: 13200,
    });

    expect(sessionRepository.save).not.toHaveBeenCalled();
  });

  it('corta easy futura quando a projeção excede o teto (5%)', async () => {
    const { service, planRepository, sessionRepository } = createService();
    const easy = makeSession({ dayOrder: 3, plannedDistance: 10000 });
    const longRun = makeSession({
      dayOrder: 4,
      type: 'long_run',
      plannedDistance: 10000,
    });
    planRepository.findOne.mockResolvedValue(
      makePlan([
        makeSession({
          dayOrder: 2,
          completed: true,
          actualDistance: 12000,
        }),
        easy,
        longRun,
      ]),
    );

    await service.adjustForOvershoot({
      ...trigger,
      plannedDistance: 10000,
      actualDistance: 12000,
    });

    expect(easy.plannedDistance).toBe(9500);
    expect(easy.adjusted).toBe(true);
    expect(easy.adjustmentNote).toContain('0.5 km a menos');
    expect(longRun.plannedDistance).toBe(10000);
    expect(longRun.adjusted).toBeFalsy();

    const saved = sessionRepository.save.mock.calls[0][0];
    expect(saved.some((s) => s.id === easy.id)).toBe(true);
    const updateArg = planRepository.update.mock.calls[0][1];
    expect(updateArg.volumeAdjusted).toBe(true);
    expect(updateArg.volumeAdjustedReason).toContain('além do planejado');
  });

  it('é idempotente em disparos repetidos', async () => {
    const { service, planRepository, sessionRepository } = createService();
    const easy = makeSession({ dayOrder: 3, plannedDistance: 10000 });
    const longRun = makeSession({
      dayOrder: 4,
      type: 'long_run',
      plannedDistance: 10000,
    });
    planRepository.findOne.mockResolvedValue(
      makePlan([
        makeSession({
          dayOrder: 2,
          completed: true,
          actualDistance: 12000,
        }),
        easy,
        longRun,
      ]),
    );

    const overshoot = {
      ...trigger,
      plannedDistance: 10000,
      actualDistance: 12000,
    };

    await service.adjustForOvershoot(overshoot);
    expect(sessionRepository.save).toHaveBeenCalledTimes(1);
    sessionRepository.save.mockClear();
    planRepository.update.mockClear();

    await service.adjustForOvershoot(overshoot);

    expect(sessionRepository.save).not.toHaveBeenCalled();
    expect(planRepository.update).not.toHaveBeenCalled();
  });

  it('não age em planos de outras semanas', async () => {
    const { service, planRepository, sessionRepository } = createService();
    const lastWeek = new Date(currentWeekStart());
    lastWeek.setDate(lastWeek.getDate() - 7);
    planRepository.findOne.mockResolvedValue(
      makePlan(
        [
          makeSession({ dayOrder: 2, completed: true, actualDistance: 12000 }),
          makeSession({ dayOrder: 3, plannedDistance: 10000 }),
        ],
        { weekStart: lastWeek.toISOString() },
      ),
    );

    await service.adjustForOvershoot({
      ...trigger,
      plannedDistance: 10000,
      actualDistance: 12000,
    });

    expect(sessionRepository.save).not.toHaveBeenCalled();
  });

  it('corta easy até o mínimo e depois o longão', async () => {
    const { service, planRepository, sessionRepository } = createService();
    const easy = makeSession({ dayOrder: 3, plannedDistance: 10000 });
    const longRun = makeSession({
      dayOrder: 4,
      type: 'long_run',
      plannedDistance: 10000,
    });
    planRepository.findOne.mockResolvedValue(
      makePlan([
        makeSession({
          dayOrder: 2,
          completed: true,
          actualDistance: 20000,
          plannedDistance: 10000,
        }),
        easy,
        longRun,
      ]),
    );

    await service.adjustForOvershoot({
      ...trigger,
      plannedDistance: 10000,
      actualDistance: 20000,
    });

    expect(easy.plannedDistance).toBe(3000);
    expect(longRun.plannedDistance).toBe(8500);
    expect(sessionRepository.save).toHaveBeenCalled();
  });

  it('limita corte de qualidade a 10%', async () => {
    const { service, planRepository } = createService();
    const easy = makeSession({ dayOrder: 3, plannedDistance: 10000 });
    const interval = makeSession({
      dayOrder: 4,
      type: 'interval',
      plannedDistance: 12000,
    });
    planRepository.findOne.mockResolvedValue(
      makePlan([
        makeSession({
          dayOrder: 2,
          completed: true,
          actualDistance: 20000,
          plannedDistance: 10000,
        }),
        easy,
        interval,
      ]),
    );

    await service.adjustForOvershoot({
      ...trigger,
      plannedDistance: 10000,
      actualDistance: 20000,
    });

    expect(easy.plannedDistance).toBe(3000);
    expect(interval.plannedDistance).toBe(10800);
  });

  it('nunca altera race nem rest', async () => {
    const { service, planRepository, sessionRepository } = createService();
    const easy = makeSession({ dayOrder: 3, plannedDistance: 10000 });
    const race = makeSession({
      dayOrder: 4,
      type: 'race',
      plannedDistance: 21000,
    });
    const rest = makeSession({
      dayOrder: 5,
      type: 'rest',
      plannedDistance: 0,
    });
    planRepository.findOne.mockResolvedValue(
      makePlan(
        [
          makeSession({
            dayOrder: 2,
            completed: true,
            actualDistance: 20000,
            plannedDistance: 10000,
          }),
          easy,
          race,
          rest,
        ],
        { plannedWeeklyKm: 30000 },
      ),
    );

    await service.adjustForOvershoot({
      ...trigger,
      plannedDistance: 10000,
      actualDistance: 20000,
    });

    expect(race.plannedDistance).toBe(21000);
    expect(race.adjusted).toBeFalsy();
    expect(rest.plannedDistance).toBe(0);
    expect(
      sessionRepository.save.mock.calls[0][0].some(
        (s) => s.type === 'race' || s.type === 'rest',
      ),
    ).toBe(false);
  });

  it('usa baseline calculado quando plannedWeeklyKm está ausente', async () => {
    const { service, planRepository } = createService();
    const easy = makeSession({ dayOrder: 3, plannedDistance: 10000 });
    const other = makeSession({ dayOrder: 4, plannedDistance: 8000 });
    const plan = makePlan([
      makeSession({
        dayOrder: 2,
        completed: true,
        actualDistance: 12000,
        plannedDistance: 10000,
      }),
      easy,
      other,
    ]);
    plan.plannedWeeklyKm = null;
    planRepository.findOne.mockResolvedValue(plan);

    await service.adjustForOvershoot({
      ...trigger,
      plannedDistance: 10000,
      actualDistance: 12000,
    });

    expect(easy.plannedDistance).toBe(9400);
    expect(other.plannedDistance).toBe(8000);
  });
});
