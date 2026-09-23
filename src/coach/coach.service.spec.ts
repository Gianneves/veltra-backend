import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Activity } from 'src/activities/entities/activity.entity';
import { AiService } from 'src/ai/ai.service';
import { Goal } from 'src/goals/entities/goal.entity';
import { HealthAlertsService } from 'src/health/health-alerts.service';
import { AthleteProfileService } from 'src/training-plans/athlete-profile.service';
import { TrainingPlan } from 'src/training-plans/entities/training-plan.entity';
import { TrainingSession } from 'src/training-plans/entities/training-session.entity';
import { CoachService } from './coach.service';
import { CoachConversation } from './entities/coach-conversation.entity';
import { CoachMessage } from './entities/coach-message.entity';

function futureWeekStart(daysAhead = 7): string {
  const date = new Date();
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7) + daysAhead);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function buildSession(overrides: {
  id: string;
  day: string;
  dayOrder: number;
  type: string;
  plannedDistance?: number;
  plannedPace?: number;
  planId?: string;
}) {
  return {
    id: overrides.id,
    planId: overrides.planId ?? 'plan-2',
    day: overrides.day,
    dayOrder: overrides.dayOrder,
    type: overrides.type,
    plannedDistance: overrides.plannedDistance ?? 0,
    plannedPace: overrides.plannedPace ?? 0,
    completed: false,
    actualDistance: null,
    actualPace: null,
  };
}

function systemPromptFrom(mock: jest.Mock): string {
  const [firstCall] = mock.mock.calls as [[string, ...unknown[]]];
  return firstCall[0];
}

describe('CoachService', () => {
  let service: CoachService;
  let conversationRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let messageRepository: {
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let goalRepository: { findOne: jest.Mock };
  let planRepository: { find: jest.Mock; findOne: jest.Mock };
  let sessionRepository: { find: jest.Mock; findOne: jest.Mock };
  let activityRepository: { find: jest.Mock };
  let athleteProfileService: { build: jest.Mock; getAge: jest.Mock };
  let aiService: { generateCoachReplyStream: jest.Mock };
  let healthAlertsService: { getAlerts: jest.Mock };

  beforeEach(async () => {
    conversationRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'conv-1',
        userId: 'user-1',
        title: 'Nova conversa',
      }),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((value: object) => ({ ...value })),
      save: jest.fn((value: Record<string, unknown>) =>
        Promise.resolve({
          ...value,
          id: (value.id as string | undefined) ?? 'conv-1',
        }),
      ),
      update: jest.fn().mockResolvedValue(undefined),
    };
    messageRepository = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((value: object) => ({ ...value })),
      save: jest.fn((value: Record<string, unknown>) =>
        Promise.resolve({
          ...value,
          id: (value.id as string | undefined) ?? 'msg-1',
          createdAt: new Date('2026-05-01T10:00:00Z'),
        }),
      ),
    };
    const upcomingSession = {
      id: 'session-1',
      planId: 'plan-1',
      day: 'Qua',
      dayOrder: 2,
      plannedDistance: 10000,
      plannedPace: 350,
      actualDistance: null,
      actualPace: null,
    };

    goalRepository = { findOne: jest.fn().mockResolvedValue(null) };
    planRepository = {
      find: jest
        .fn()
        .mockResolvedValue([
          { weekStart: futureWeekStart(7), sessions: [upcomingSession] },
        ]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    sessionRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({
        ...upcomingSession,
        plan: { id: 'plan-1', userId: 'user-1', weekStart: futureWeekStart(7) },
      }),
    };
    activityRepository = { find: jest.fn().mockResolvedValue([]) };
    athleteProfileService = {
      build: jest.fn().mockResolvedValue({ hasData: false }),
      getAge: jest.fn().mockResolvedValue(undefined),
    };
    healthAlertsService = { getAlerts: jest.fn().mockResolvedValue([]) };
    aiService = {
      generateCoachReplyStream: jest
        .fn()
        .mockImplementation(
          (
            _system: string,
            _history: unknown,
            _message: string,
            onToken: (token: string) => void,
          ) => {
            onToken('Olá');
            return Promise.resolve({ text: 'Olá', proposal: null });
          },
        ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoachService,
        {
          provide: getRepositoryToken(CoachConversation),
          useValue: conversationRepository,
        },
        {
          provide: getRepositoryToken(CoachMessage),
          useValue: messageRepository,
        },
        { provide: getRepositoryToken(Goal), useValue: goalRepository },
        { provide: getRepositoryToken(TrainingPlan), useValue: planRepository },
        {
          provide: getRepositoryToken(TrainingSession),
          useValue: sessionRepository,
        },
        { provide: getRepositoryToken(Activity), useValue: activityRepository },
        { provide: AthleteProfileService, useValue: athleteProfileService },
        { provide: AiService, useValue: aiService },
        { provide: HealthAlertsService, useValue: healthAlertsService },
      ],
    }).compile();

    service = module.get<CoachService>(CoachService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('streams tokens and persists both messages', async () => {
    const onToken = jest.fn();

    const result = await service.streamMessage(
      'user-1',
      'Como foi meu treino?',
      'conv-1',
      onToken,
    );

    expect(onToken).toHaveBeenCalledWith('Olá');
    expect(result.conversationId).toBe('conv-1');
    expect(result.message.content).toBe('Olá');
    expect(messageRepository.save).toHaveBeenCalledTimes(2);
    expect(conversationRepository.update).toHaveBeenCalledTimes(1);
    const updateArgs = conversationRepository.update.mock.calls[0] as [
      string,
      { updatedAt: Date },
    ];
    expect(updateArgs[0]).toBe('conv-1');
    expect(updateArgs[1].updatedAt).toBeInstanceOf(Date);
  });

  it('accepts a cautious proposal for a future session', async () => {
    aiService.generateCoachReplyStream.mockResolvedValue({
      text: 'Sugiro ajustar.',
      proposal: {
        session: 1,
        changes: {
          plannedDistance: 11500,
          plannedPace: 360,
          type: 'easy',
          day: 'Qua',
        },
        reason: 'Recuperação',
      },
    });

    const result = await service.streamMessage(
      'user-1',
      'Posso mudar o treino?',
      'conv-1',
      jest.fn(),
    );

    expect(result.proposal).toMatchObject({
      session: 1,
      sessionId: 'session-1',
      planId: 'plan-1',
    });
    expect(result.proposal?.changes.plannedDistance).toBe(11500);
    expect(result.proposal?.changes.plannedPace).toBe(360);
  });

  it('drops proposals with aggressive changes', async () => {
    aiService.generateCoachReplyStream.mockResolvedValue({
      text: 'Sugiro ajustar.',
      proposal: {
        session: 1,
        changes: { plannedDistance: 20000, plannedPace: 250 },
        reason: 'Treino forte',
      },
    });
    sessionRepository.findOne.mockResolvedValue({
      id: 'session-1',
      planId: 'plan-1',
      day: 'Qua',
      dayOrder: 2,
      plannedDistance: 10000,
      plannedPace: 350,
      actualDistance: null,
      actualPace: null,
      plan: { id: 'plan-1', userId: 'user-1', weekStart: futureWeekStart(7) },
    });

    const result = await service.streamMessage(
      'user-1',
      'Posso mudar o treino?',
      'conv-1',
      jest.fn(),
    );

    expect(result.proposal).toBeNull();
    expect(result.proposals).toHaveLength(0);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].code).toBe('OUT_OF_RANGE');
  });

  it('rejects proposals for rest sessions', async () => {
    aiService.generateCoachReplyStream.mockResolvedValue({
      text: 'Sugiro ajustar.',
      proposal: {
        session: 1,
        changes: { day: 'Ter' },
        reason: 'Mudança',
      },
    });
    sessionRepository.findOne.mockResolvedValue({
      id: 'session-1',
      planId: 'plan-1',
      day: 'Sáb',
      dayOrder: 5,
      type: 'rest',
      plannedDistance: 0,
      plannedPace: 0,
      plan: { id: 'plan-1', userId: 'user-1', weekStart: futureWeekStart(7) },
    });

    const result = await service.streamMessage(
      'user-1',
      'Posso mudar?',
      'conv-1',
      jest.fn(),
    );

    expect(result.proposal).toBeNull();
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].code).toBe('PAST_OR_REST');
  });

  it('rejects proposals for past sessions or other users', async () => {
    aiService.generateCoachReplyStream.mockResolvedValue({
      text: 'Sugiro ajustar.',
      proposal: {
        session: 1,
        changes: { notes: 'mais leve' },
        reason: 'Recuperação',
      },
    });

    sessionRepository.findOne.mockResolvedValue({
      id: 'session-1',
      planId: 'plan-1',
      day: 'Dom',
      dayOrder: 6,
      plannedDistance: 10000,
      plannedPace: 350,
      plan: { id: 'plan-1', userId: 'user-1', weekStart: futureWeekStart(-14) },
    });

    const past = await service.streamMessage(
      'user-1',
      'Posso mudar?',
      'conv-1',
      jest.fn(),
    );
    expect(past.proposal).toBeNull();
    expect(past.rejections).toHaveLength(1);
    expect(past.rejections[0].code).toBe('PAST_OR_REST');

    sessionRepository.findOne.mockResolvedValue({
      id: 'session-1',
      planId: 'plan-1',
      day: 'Qua',
      dayOrder: 2,
      plannedDistance: 10000,
      plannedPace: 350,
      plan: { id: 'plan-1', userId: 'user-2', weekStart: futureWeekStart(7) },
    });

    const foreign = await service.streamMessage(
      'user-1',
      'Posso mudar?',
      'conv-1',
      jest.fn(),
    );
    expect(foreign.proposal).toBeNull();
    expect(foreign.rejections).toHaveLength(1);
    expect(foreign.rejections[0].code).toBe('INVALID_SESSION');
  });

  it('groups rest days and keeps them out of proposal numbering', async () => {
    planRepository.find.mockResolvedValue([
      {
        id: 'plan-2',
        weekStart: futureWeekStart(7),
        sessions: [
          buildSession({
            id: 'session-long',
            day: 'Dom',
            dayOrder: 6,
            type: 'long_run',
            plannedDistance: 19500,
            plannedPace: 400,
          }),
          buildSession({
            id: 'session-rest-seg',
            day: 'Seg',
            dayOrder: 0,
            type: 'rest',
          }),
          buildSession({
            id: 'session-tempo',
            day: 'Ter',
            dayOrder: 1,
            type: 'tempo',
            plannedDistance: 5100,
            plannedPace: 360,
          }),
          buildSession({
            id: 'session-rest-sab',
            day: 'Sáb',
            dayOrder: 5,
            type: 'rest',
          }),
        ],
      },
    ]);

    await service.streamMessage(
      'user-1',
      'Como está minha semana?',
      'conv-1',
      jest.fn(),
    );

    const systemPrompt = systemPromptFrom(aiService.generateCoachReplyStream);

    expect(systemPrompt).toContain('Próxima semana (');
    expect(systemPrompt).toContain('[1] Dom');
    expect(systemPrompt).toContain('[2] Ter');
    expect(systemPrompt).not.toContain('[3]');
    expect(systemPrompt).toContain('- Descanso: Seg');
    expect(systemPrompt).toContain('Sáb');
    expect(systemPrompt).toContain('Próximo longão: Dom');
    expect(systemPrompt).toContain('19.5 km');
    expect(systemPrompt).toContain('Não liste sessões de descanso');
    expect(systemPrompt).toContain('Cite sempre o próximo longão');
  });

  it('marks past sessions and never numbers them', async () => {
    planRepository.find.mockResolvedValue([
      {
        id: 'plan-past',
        weekStart: futureWeekStart(-7),
        sessions: [
          buildSession({
            id: 'session-past-long',
            day: 'Dom',
            dayOrder: 6,
            type: 'long_run',
            plannedDistance: 17700,
            plannedPace: 400,
            planId: 'plan-past',
          }),
          buildSession({
            id: 'session-past-rest',
            day: 'Seg',
            dayOrder: 0,
            type: 'rest',
            planId: 'plan-past',
          }),
        ],
      },
    ]);

    await service.streamMessage('user-1', 'Resumo', 'conv-1', jest.fn());

    const systemPrompt = systemPromptFrom(aiService.generateCoachReplyStream);

    expect(systemPrompt).toContain('(passado — não pode ser alterado)');
    expect(systemPrompt).not.toMatch(/\[\d+\] Dom/);
    expect(systemPrompt).toContain('- Descanso: Seg');
    expect(systemPrompt).toContain('(passado)');
  });

  it('maps proposal numbers past rest days to the right workout', async () => {
    const weekStart = futureWeekStart(7);

    planRepository.find.mockResolvedValue([
      {
        id: 'plan-2',
        weekStart,
        sessions: [
          buildSession({
            id: 'session-long',
            day: 'Dom',
            dayOrder: 6,
            type: 'long_run',
            plannedDistance: 19500,
            plannedPace: 400,
          }),
          buildSession({
            id: 'session-rest-seg',
            day: 'Seg',
            dayOrder: 0,
            type: 'rest',
          }),
          buildSession({
            id: 'session-tempo',
            day: 'Ter',
            dayOrder: 1,
            type: 'tempo',
            plannedDistance: 5100,
            plannedPace: 360,
          }),
        ],
      },
    ]);
    sessionRepository.findOne.mockResolvedValue({
      id: 'session-tempo',
      planId: 'plan-2',
      day: 'Ter',
      dayOrder: 1,
      type: 'tempo',
      plannedDistance: 5100,
      plannedPace: 360,
      actualDistance: null,
      actualPace: null,
      plan: { id: 'plan-2', userId: 'user-1', weekStart },
    });
    aiService.generateCoachReplyStream.mockResolvedValue({
      text: 'Sugiro ajustar.',
      proposal: {
        session: 2,
        changes: { plannedDistance: 5500 },
        reason: 'Ajuste leve',
      },
    });

    const result = await service.streamMessage(
      'user-1',
      'Ajusta o treino?',
      'conv-1',
      jest.fn(),
    );

    expect(sessionRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'session-tempo' } }),
    );
    expect(result.proposal?.sessionId).toBe('session-tempo');
  });

  it('validates multiple proposals with partial rejection', async () => {
    const weekStart = futureWeekStart(7);
    planRepository.find.mockResolvedValue([
      {
        id: 'plan-2',
        weekStart,
        sessions: [
          buildSession({
            id: 'session-a',
            day: 'Ter',
            dayOrder: 1,
            type: 'easy',
            plannedDistance: 8000,
            plannedPace: 360,
          }),
          buildSession({
            id: 'session-b',
            day: 'Qui',
            dayOrder: 3,
            type: 'tempo',
            plannedDistance: 6000,
            plannedPace: 340,
          }),
        ],
      },
    ]);
    const byId: Record<string, object> = {
      'session-a': {
        id: 'session-a',
        planId: 'plan-2',
        day: 'Ter',
        dayOrder: 1,
        type: 'easy',
        plannedDistance: 8000,
        plannedPace: 360,
        actualDistance: null,
        actualPace: null,
        plan: { id: 'plan-2', userId: 'user-1', weekStart },
      },
      'session-b': {
        id: 'session-b',
        planId: 'plan-2',
        day: 'Qui',
        dayOrder: 3,
        type: 'tempo',
        plannedDistance: 6000,
        plannedPace: 340,
        actualDistance: null,
        actualPace: null,
        plan: { id: 'plan-2', userId: 'user-1', weekStart },
      },
    };
    sessionRepository.findOne.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(byId[where.id] ?? null),
    );
    // proposalSessions é montado a partir de planRepository.find (ordem das sessões):
    // [1] -> session-a, [2] -> session-b
    aiService.generateCoachReplyStream.mockResolvedValue({
      text: 'Ajustes.',
      proposals: [
        { session: 1, changes: { plannedDistance: 8800 }, reason: 'leve' },
        { session: 2, changes: { plannedDistance: 20000 }, reason: 'forte' },
      ],
    });

    const result = await service.streamMessage(
      'user-1',
      'Alivia?',
      'conv-1',
      jest.fn(),
    );

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].sessionId).toBe('session-a');
    expect(result.proposal?.sessionId).toBe('session-a');
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0]).toMatchObject({
      session: 2,
      code: 'OUT_OF_RANGE',
    });
    expect(result.rejections[0].message).toContain('Nada foi alterado');
  });

  it('allows day swaps but rejects intra-batch day collisions', async () => {
    const weekStart = futureWeekStart(7);
    planRepository.find.mockResolvedValue([
      {
        id: 'plan-2',
        weekStart,
        sessions: [
          buildSession({
            id: 'session-a',
            day: 'Ter',
            dayOrder: 1,
            type: 'easy',
            plannedDistance: 8000,
            plannedPace: 360,
          }),
          buildSession({
            id: 'session-b',
            day: 'Qui',
            dayOrder: 3,
            type: 'tempo',
            plannedDistance: 6000,
            plannedPace: 340,
          }),
          buildSession({
            id: 'session-c',
            day: 'Sáb',
            dayOrder: 5,
            type: 'long_run',
            plannedDistance: 12000,
            plannedPace: 380,
          }),
        ],
      },
    ]);
    const byId: Record<string, object> = {
      'session-a': {
        id: 'session-a',
        planId: 'plan-2',
        day: 'Ter',
        dayOrder: 1,
        type: 'easy',
        plannedDistance: 8000,
        plannedPace: 360,
        actualDistance: null,
        actualPace: null,
        plan: { id: 'plan-2', userId: 'user-1', weekStart },
      },
      'session-b': {
        id: 'session-b',
        planId: 'plan-2',
        day: 'Qui',
        dayOrder: 3,
        type: 'tempo',
        plannedDistance: 6000,
        plannedPace: 340,
        actualDistance: null,
        actualPace: null,
        plan: { id: 'plan-2', userId: 'user-1', weekStart },
      },
      'session-c': {
        id: 'session-c',
        planId: 'plan-2',
        day: 'Sáb',
        dayOrder: 5,
        type: 'long_run',
        plannedDistance: 12000,
        plannedPace: 380,
        actualDistance: null,
        actualPace: null,
        plan: { id: 'plan-2', userId: 'user-1', weekStart },
      },
    };
    sessionRepository.findOne.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(byId[where.id] ?? null),
    );
    aiService.generateCoachReplyStream.mockResolvedValue({
      text: 'Troca.',
      proposals: [
        { session: 1, changes: { day: 'Qui' }, reason: 'swap' },
        { session: 2, changes: { day: 'Ter' }, reason: 'swap' },
      ],
    });

    const swap = await service.streamMessage(
      'user-1',
      'Inverte?',
      'conv-1',
      jest.fn(),
    );
    expect(swap.proposals).toHaveLength(2);
    expect(swap.rejections).toHaveLength(0);

    aiService.generateCoachReplyStream.mockResolvedValue({
      text: 'Colisão.',
      proposals: [
        { session: 1, changes: { day: 'Qui' }, reason: 'x' },
        { session: 3, changes: { day: 'Qui' }, reason: 'y' },
      ],
    });

    const collision = await service.streamMessage(
      'user-1',
      'Move?',
      'conv-1',
      jest.fn(),
    );
    expect(collision.proposals).toHaveLength(1);
    expect(collision.rejections).toHaveLength(1);
    expect(collision.rejections[0].code).toBe('DAY_COLLISION');
  });

  it('rejects unknown session numbers with chat-ready message', async () => {
    aiService.generateCoachReplyStream.mockResolvedValue({
      text: 'Ajuste.',
      proposals: [
        { session: 99, changes: { plannedDistance: 8000 }, reason: 'x' },
      ],
    });

    const result = await service.streamMessage(
      'user-1',
      'Muda?',
      'conv-1',
      jest.fn(),
    );

    expect(result.proposals).toHaveLength(0);
    expect(result.proposal).toBeNull();
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].code).toBe('INVALID_SESSION');
  });

  it('appends a fallback note when text promises a button but no proposal exists', async () => {
    aiService.generateCoachReplyStream.mockResolvedValue({
      text: 'Resumo dos ajustes. Clique em "Aplicar mudança" para salvar.',
      proposal: null,
      proposals: [],
      malformed: false,
    });

    const result = await service.streamMessage(
      'user-1',
      'Ajusta minha semana?',
      'conv-1',
      jest.fn(),
    );

    expect(result.proposals).toHaveLength(0);
    expect(result.rejections).toHaveLength(0);
    expect(result.message.content).toContain('não gerei nenhuma mudança');
    expect(result.message.content).toContain('nada foi alterado');
  });

  it('appends a fallback note when text presents sessions as updated without proposals', async () => {
    aiService.generateCoachReplyStream.mockResolvedValue({
      text: 'Aqui está o seu plano atualizado:\n[1] Qua easy 5.8 km\n[2] Sex easy 5.8 km',
      proposal: null,
      proposals: [],
      malformed: false,
    });

    const result = await service.streamMessage(
      'user-1',
      'Só posso correr 3 vezes',
      'conv-1',
      jest.fn(),
    );

    expect(result.proposals).toHaveLength(0);
    expect(result.message.content).toContain('não gerei nenhuma mudança');
  });

  it('does not append the fallback note for a plain week summary', async () => {
    aiService.generateCoachReplyStream.mockResolvedValue({
      text: 'Sua semana:\n[1] Qua easy 5.8 km\n[2] Sex easy 5.8 km',
      proposal: null,
      proposals: [],
      malformed: false,
    });

    const result = await service.streamMessage(
      'user-1',
      'Como está minha semana?',
      'conv-1',
      jest.fn(),
    );

    expect(result.message.content).toBe(
      'Sua semana:\n[1] Qua easy 5.8 km\n[2] Sex easy 5.8 km',
    );
  });

  it('does not append the fallback note for plain advice', async () => {
    aiService.generateCoachReplyStream.mockResolvedValue({
      text: 'Continue assim, bom trabalho!',
      proposal: null,
      proposals: [],
      malformed: false,
    });

    const result = await service.streamMessage(
      'user-1',
      'Como estou indo?',
      'conv-1',
      jest.fn(),
    );

    expect(result.message.content).toBe('Continue assim, bom trabalho!');
  });
});
