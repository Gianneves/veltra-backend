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
});
