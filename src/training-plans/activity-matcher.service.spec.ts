import { Activity } from 'src/activities/entities/activity.entity';
import { ActivityMatcherService } from './activity-matcher.service';
import type { TrainingPlan } from './entities/training-plan.entity';
import type { TrainingSession } from './entities/training-session.entity';

function makeLaps(paces: number[][]) {
  return paces.flat().map((pace, index) => ({
    distance: 400 + (index % 3) * 100,
    moving_time: Math.round((pace * (400 + (index % 3) * 100)) / 1000),
    elapsed_time: Math.round((pace * (400 + (index % 3) * 100)) / 1000),
  }));
}

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  const laps = overrides.laps ?? makeLaps([[250], [420]]);
  return {
    id: 'activity-1',
    activityStravaId: 123456,
    distance: 8000,
    moving_time: 3200,
    elapsed_time: 3300,
    name: 'Corrida',
    type: 'Run',
    sport_type: 'Run',
    start_date_local: new Date(2026, 8, 15, 7, 0),
    laps,
    ...overrides,
  } as Activity;
}

function makeSession(
  overrides: Partial<TrainingSession> = {},
): TrainingSession {
  return {
    id: 'session-1',
    planId: 'plan-1',
    day: 'Ter',
    dayOrder: 1,
    type: 'long_run',
    plannedDistance: 16000,
    plannedPace: 400,
    notes: 'Longão de 16.0km em ritmo de conversa (7:10/km).',
    completed: false,
    ...overrides,
  } as TrainingSession;
}

function createService(options?: {
  plans?: TrainingPlan[];
  sessions?: TrainingSession[];
  aiPick?: { sessionId: string; reason?: string } | null;
}) {
  const planRepository = {
    find: jest.fn(() => Promise.resolve(options?.plans ?? [])),
    findOne: jest.fn(() => Promise.resolve(null)),
  };
  const sessionRepository = {
    find: jest.fn(() => Promise.resolve(options?.sessions ?? [])),
    save: jest.fn((session: TrainingSession) => Promise.resolve(session)),
    count: jest.fn(() => Promise.resolve(0)),
  };
  const activityRepository = {
    findOne: jest.fn(() => Promise.resolve(null)),
  };
  const aiService = {
    classifyActivityMatch: jest.fn(() =>
      Promise.resolve(options?.aiPick ?? null),
    ),
  };
  const volumeAdjustment = {
    adjustForOvershoot: jest.fn(() => Promise.resolve()),
  };

  const service = new ActivityMatcherService(
    planRepository as any,
    sessionRepository as any,
    activityRepository as any,
    aiService as any,
    volumeAdjustment as any,
  );

  return {
    service,
    planRepository,
    sessionRepository,
    aiService,
    volumeAdjustment,
  };
}

describe('ActivityMatcherService', () => {
  describe('buildFeatures', () => {
    it('classifica intervalado por variabilidade das voltas', () => {
      const { service } = createService();
      const laps = Array.from({ length: 6 }).flatMap(() => [
        { distance: 400, moving_time: 100, elapsed_time: 120 },
        { distance: 400, moving_time: 168, elapsed_time: 180 },
      ]);

      const features = service.buildFeatures(
        makeActivity({ laps, distance: 8000, moving_time: 3200 }),
      );

      expect(features.shape).toBe('interval');
      expect(features.hardLaps).toBeGreaterThanOrEqual(3);
      expect(features.paceVariability).toBeGreaterThan(0.08);
    });

    it('classifica longão por distância com voltas estáveis', () => {
      const { service } = createService();
      const laps = Array.from({ length: 6 }).map(() => ({
        distance: 3000,
        moving_time: 1080,
        elapsed_time: 1080,
      }));

      const features = service.buildFeatures(
        makeActivity({ laps, distance: 18000, moving_time: 6480 }),
      );

      expect(features.shape).toBe('long');
    });

    it('classifica treino leve/contínuo como steady', () => {
      const { service } = createService();
      const laps = Array.from({ length: 5 }).map(() => ({
        distance: 1000,
        moving_time: 360,
        elapsed_time: 360,
      }));

      const features = service.buildFeatures(
        makeActivity({ laps, distance: 5000, moving_time: 1800 }),
      );

      expect(features.shape).toBe('steady');
    });
  });

  describe('matchActivity', () => {
    const weekStart = new Date(2026, 8, 14); // segunda local

    it('vincula automaticamente longão no mesmo dia', async () => {
      const session = makeSession();
      const plan = {
        id: 'plan-1',
        userId: 'user-1',
        weekStart: weekStart.toISOString(),
        sessions: [session],
      } as TrainingPlan;

      const { service, sessionRepository } = createService({ plans: [plan] });
      const activity = makeActivity({
        name: 'Longão',
        distance: 16100,
        moving_time: 5900,
      });

      const result = await service.matchActivity('user-1', activity);

      expect(result.matched).toBe(true);
      expect(result.method).toBe('auto');
      expect(result.sessionId).toBe('session-1');
      expect(session.completed).toBe(true);
      expect(session.activityId).toBe('activity-1');
      expect(session.actualDistance).toBe(16100);
      expect(sessionRepository.save).toHaveBeenCalled();
    });

    it('não vincula corrida em dia de descanso', async () => {
      const session = makeSession({
        type: 'rest',
        plannedDistance: 0,
        plannedPace: 0,
        notes: 'Descanso',
      });
      const plan = {
        id: 'plan-1',
        userId: 'user-1',
        weekStart: weekStart.toISOString(),
        sessions: [session],
      } as TrainingPlan;

      const { service } = createService({ plans: [plan] });
      const result = await service.matchActivity('user-1', makeActivity());

      expect(result.matched).toBe(false);
    });

    it('usa IA quando o score está na zona cinzenta', async () => {
      const first = makeSession({ id: 'session-1' });
      const second = makeSession({ id: 'session-2', type: 'tempo' });
      const plan = {
        id: 'plan-1',
        userId: 'user-1',
        weekStart: weekStart.toISOString(),
        sessions: [first, second],
      } as TrainingPlan;

      const { service, aiService } = createService({
        plans: [plan],
        aiPick: { sessionId: 'session-2', reason: 'tempo sustentado' },
      });

      jest
        .spyOn(service, 'scoreSession')
        .mockReturnValueOnce({ session: first, score: 0.55, reasons: [] })
        .mockReturnValueOnce({ session: second, score: 0.53, reasons: [] });

      const result = await service.matchActivity('user-1', makeActivity());

      expect(aiService.classifyActivityMatch).toHaveBeenCalled();
      expect(result.matched).toBe(true);
      expect(result.method).toBe('ai');
      expect(result.sessionId).toBe('session-2');
    });

    it('não vincula intervalado a treino contínuo no mesmo dia', async () => {
      const tempo = makeSession({
        id: 'session-tempo',
        day: 'Ter',
        dayOrder: 1,
        type: 'tempo',
        plannedDistance: 6500,
        plannedPace: 365,
        notes: 'Tempo run: 18min contínuos no pace 6:05/km.',
      });
      const plan = {
        id: 'plan-1',
        userId: 'user-1',
        weekStart: weekStart.toISOString(),
        sessions: [tempo],
      } as TrainingPlan;

      const { service } = createService({ plans: [plan], aiPick: null });

      const laps = Array.from({ length: 6 }).flatMap(() => [
        { distance: 800, moving_time: 277, elapsed_time: 300 },
        { distance: 400, moving_time: 180, elapsed_time: 190 },
      ]);

      const activity = makeActivity({
        name: '5x800',
        distance: 9740,
        moving_time: 3374,
        laps,
      });

      const features = service.buildFeatures(activity);
      expect(features.shape).toBe('interval');

      const candidate = service.scoreSession(
        tempo,
        features,
        new Date(2026, 8, 15),
      );
      expect(candidate.score).toBeLessThanOrEqual(0.45);

      const result = await service.matchActivity('user-1', activity);
      expect(result.matched).toBe(false);
    });

    it('não vincula 5x800 a fartlek dois dias depois', async () => {
      const tempo = makeSession({
        id: 'session-tempo',
        day: 'Ter',
        dayOrder: 1,
        type: 'tempo',
        plannedDistance: 6500,
        plannedPace: 365,
        notes: 'Tempo run: 18min contínuos no pace 6:05/km.',
      });
      const fartlek = makeSession({
        id: 'session-fartlek',
        day: 'Qui',
        dayOrder: 3,
        type: 'fartlek',
        plannedDistance: 5600,
        plannedPace: 355,
        notes: 'Fartlek 10x(1min forte / 1min leve).',
      });
      const nextWeekStart = new Date(weekStart);
      nextWeekStart.setDate(nextWeekStart.getDate() + 7);

      const distantInterval = makeSession({
        id: 'session-distant',
        day: 'Qui',
        dayOrder: 3,
        type: 'interval',
        plannedDistance: 14800,
        plannedPace: 356,
        notes: '3x3000m no pace da prova (5:56/km).',
      });

      const plan = {
        id: 'plan-1',
        userId: 'user-1',
        weekStart: weekStart.toISOString(),
        sessions: [tempo, fartlek],
      } as TrainingPlan;
      const nextPlan = {
        id: 'plan-2',
        userId: 'user-1',
        weekStart: nextWeekStart.toISOString(),
        sessions: [distantInterval],
      } as TrainingPlan;

      const { service } = createService({ plans: [plan, nextPlan] });

      const laps = [
        { distance: 2790, moving_time: 1080, elapsed_time: 1080 },
        ...Array.from({ length: 5 }).flatMap(() => [
          { distance: 800, moving_time: 258, elapsed_time: 258 },
          { distance: 20, moving_time: 90, elapsed_time: 90 },
        ]),
        { distance: 2880, moving_time: 1080, elapsed_time: 1080 },
      ];

      const activity = makeActivity({
        name: '5x800',
        distance: 9740,
        moving_time: 3374,
        average_speed: 2.886,
        max_speed: 4.2,
        laps,
      });

      const result = await service.matchActivity('user-1', activity);

      expect(result.matched).toBe(false);
    });

    it('vincula quando a estrutura de repetições bate, mesmo dias depois', async () => {
      const tempo = makeSession({
        id: 'session-tempo',
        day: 'Ter',
        dayOrder: 1,
        type: 'tempo',
        plannedDistance: 6500,
        plannedPace: 365,
        notes: 'Tempo run: 18min contínuos no pace 6:05/km.',
      });
      const interval = makeSession({
        id: 'session-interval',
        day: 'Qui',
        dayOrder: 3,
        type: 'interval',
        plannedDistance: 14800,
        plannedPace: 356,
        notes: 'Aquecimento 2km + 5x800m no pace 5:56/km com 2:00 de trote.',
      });
      const plan = {
        id: 'plan-1',
        userId: 'user-1',
        weekStart: weekStart.toISOString(),
        sessions: [tempo, interval],
      } as TrainingPlan;

      const { service } = createService({ plans: [plan] });

      const laps = [
        { distance: 2790, moving_time: 1080, elapsed_time: 1080 },
        ...Array.from({ length: 5 }).map(() => ({
          distance: 800,
          moving_time: 258,
          elapsed_time: 258,
        })),
        { distance: 2880, moving_time: 1080, elapsed_time: 1080 },
      ];

      const activity = makeActivity({
        name: '5x800',
        distance: 9740,
        moving_time: 3374,
        average_speed: 2.886,
        max_speed: 4.2,
        laps,
      });

      const result = await service.matchActivity('user-1', activity);

      expect(result.matched).toBe(true);
      expect(result.method).toBe('auto');
      expect(result.sessionId).toBe('session-interval');
    });

    it('não vincula corrida longa a treino curto no mesmo dia', async () => {
      const strides = makeSession({
        id: 'session-strides',
        day: 'Ter',
        dayOrder: 1,
        type: 'interval',
        plannedDistance: 1200,
        plannedPace: 380,
        notes: '8 retas de 20s acelerando com 40s de trote.',
      });
      const plan = {
        id: 'plan-1',
        userId: 'user-1',
        weekStart: weekStart.toISOString(),
        sessions: [strides],
      } as TrainingPlan;

      const { service } = createService({ plans: [plan] });

      const laps = Array.from({ length: 6 }).flatMap(() => [
        { distance: 800, moving_time: 258, elapsed_time: 258 },
        { distance: 400, moving_time: 180, elapsed_time: 180 },
      ]);

      const activity = makeActivity({
        name: '5x800',
        distance: 9740,
        moving_time: 3374,
        average_speed: 2.886,
        max_speed: 4.2,
        laps,
      });

      const result = await service.matchActivity('user-1', activity);

      expect(result.matched).toBe(false);
    });

    it('não vincula corrida longa sem voltas a treino leve curto', async () => {
      const easy = makeSession({
        id: 'session-easy',
        day: 'Seg',
        dayOrder: 0,
        type: 'easy',
        plannedDistance: 3400,
        plannedPace: 450,
        notes: 'Corrida leve de 3.4km em ritmo de conversa (7:30/km).',
      });
      const plan = {
        id: 'plan-1',
        userId: 'user-1',
        weekStart: weekStart.toISOString(),
        sessions: [easy],
      } as TrainingPlan;

      const { service } = createService({ plans: [plan] });

      const activity = makeActivity({
        name: 'Corrida',
        distance: 9700,
        moving_time: 2900,
        average_speed: 3.34,
        max_speed: undefined,
        laps: [],
      });

      const result = await service.matchActivity('user-1', activity);

      expect(result.matched).toBe(false);
    });

    it('respeita vínculo manual e não re-matcheia', async () => {
      const session = makeSession({ activityId: 'activity-1' });
      const plan = {
        id: 'plan-1',
        userId: 'user-1',
        weekStart: weekStart.toISOString(),
        sessions: [session],
      } as TrainingPlan;

      const { service, sessionRepository } = createService({ plans: [plan] });
      sessionRepository.count.mockResolvedValue(1);

      const result = await service.matchActivity('user-1', makeActivity());

      expect(result.matched).toBe(false);
      expect(result.reason).toBe('vínculo manual');
    });

    it('não vincula quando o melhor score é baixo', async () => {
      const session = makeSession({ type: 'easy', plannedDistance: 5000 });
      const plan = {
        id: 'plan-1',
        userId: 'user-1',
        weekStart: weekStart.toISOString(),
        sessions: [session],
      } as TrainingPlan;

      const { service } = createService({ plans: [plan] });
      const activity = makeActivity({
        name: 'Pedalada',
        distance: 20000,
        moving_time: 8000,
        laps: [],
      });

      jest.spyOn(service, 'scoreSession').mockReturnValue({
        session,
        score: 0.2,
        reasons: [],
      });

      const result = await service.matchActivity('user-1', activity);
      expect(result.matched).toBe(false);
    });
  });

  describe('unlinkSessionsForActivity', () => {
    it('limpa vínculo e marca como não concluído', async () => {
      const linked = makeSession({
        activityId: 'activity-1',
        actualDistance: 16100,
        actualPace: 366,
        actualMovingTime: 5900,
        matchMethod: 'auto',
        matchScore: 0.98,
        matchedAt: new Date(),
        completed: true,
      });

      const { service, sessionRepository } = createService({
        sessions: [linked],
      });

      const count = await service.unlinkSessionsForActivity('activity-1');

      expect(count).toBe(1);
      expect(linked.activityId).toBeNull();
      expect(linked.completed).toBe(false);
      expect(linked.actualDistance).toBeNull();
      expect(linked.matchMethod).toBeNull();
      expect(sessionRepository.save).toHaveBeenCalled();
    });
  });
});
