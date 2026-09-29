import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Activity } from 'src/activities/entities/activity.entity';
import { AiService } from 'src/ai/ai.service';
import { Goal } from 'src/goals/entities/goal.entity';
import { AthleteProfileService } from 'src/training-plans/athlete-profile.service';
import { TrainingSession } from 'src/training-plans/entities/training-session.entity';
import { Insight } from './entities/insight.entity';
import { InsightsService } from './insights.service';

const content = {
  summary: 'Boa corrida.',
  performance: 'Pace consistente.',
  workoutType: 'Rodagem leve.',
  plan: null,
  tips: ['Hidrate-se melhor.'],
};

describe('InsightsService', () => {
  let service: InsightsService;
  let insightRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let activityRepository: { findOne: jest.Mock };
  let sessionRepository: { findOne: jest.Mock; find: jest.Mock };
  let goalRepository: { findOne: jest.Mock };
  let athleteProfileService: { build: jest.Mock };
  let aiService: { generateActivityInsight: jest.Mock };

  beforeEach(async () => {
    insightRepository = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((value: object) => ({ ...value })),
      save: jest.fn((value: Record<string, unknown>) =>
        Promise.resolve({
          ...value,
          id: (value.id as string | undefined) ?? 'insight-1',
          createdAt: new Date('2026-05-01T10:00:00Z'),
          updatedAt: new Date('2026-05-01T10:00:00Z'),
        }),
      ),
    };
    activityRepository = { findOne: jest.fn().mockResolvedValue(null) };
    sessionRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
    };
    goalRepository = { findOne: jest.fn().mockResolvedValue(null) };
    athleteProfileService = {
      build: jest.fn().mockResolvedValue({ hasData: false }),
    };
    aiService = { generateActivityInsight: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InsightsService,
        { provide: getRepositoryToken(Insight), useValue: insightRepository },
        {
          provide: getRepositoryToken(Activity),
          useValue: activityRepository,
        },
        {
          provide: getRepositoryToken(TrainingSession),
          useValue: sessionRepository,
        },
        { provide: getRepositoryToken(Goal), useValue: goalRepository },
        { provide: AthleteProfileService, useValue: athleteProfileService },
        { provide: AiService, useValue: aiService },
      ],
    }).compile();

    service = module.get<InsightsService>(InsightsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns null when the activity does not belong to the user', async () => {
    const result = await service.getForActivity('activity-1', 'user-1');

    expect(result).toBeNull();
    expect(insightRepository.findOne).not.toHaveBeenCalled();
  });

  it('generates and stores a structured insight', async () => {
    aiService.generateActivityInsight.mockResolvedValue(content);
    insightRepository.findOne.mockResolvedValue(null);

    const result = await service.generateForActivity(
      { id: 'activity-1' } as Activity,
      'user-1',
    );

    expect(insightRepository.create).toHaveBeenCalledWith({
      activityId: 'activity-1',
      content: '',
    });
    expect(insightRepository.save).toHaveBeenCalledTimes(2);
    expect(result?.content?.summary).toBe('Boa corrida.');
    expect(result?.status).toBe('completed');
  });

  it('marks the insight as failed when the AI returns nothing', async () => {
    aiService.generateActivityInsight.mockResolvedValue(null);
    insightRepository.findOne.mockResolvedValue({
      id: 'insight-1',
      activityId: 'activity-1',
      status: 'completed',
      content: JSON.stringify(content),
      createdAt: new Date('2026-05-01T10:00:00Z'),
      updatedAt: new Date('2026-05-01T10:00:00Z'),
    });

    const result = await service.generateForActivity(
      { id: 'activity-1' } as Activity,
      'user-1',
    );

    expect(result?.status).toBe('failed');
    expect(result?.content?.summary).toBe('Boa corrida.');
  });

  it('returns the feed with the adherence verdict', async () => {
    insightRepository.find.mockResolvedValue([
      {
        id: 'insight-1',
        activityId: 'activity-1',
        status: 'completed',
        content: JSON.stringify(content),
        createdAt: new Date('2026-05-01T10:00:00Z'),
        updatedAt: new Date('2026-05-01T10:00:00Z'),
        activity: {
          id: 'activity-1',
          name: 'Corrida',
          sport_type: 'Run',
          type: 'Run',
          distance: 10300,
          moving_time: 3600,
          start_date_local: new Date('2026-05-01T09:00:00Z'),
        },
      },
    ]);
    sessionRepository.find.mockResolvedValue([
      {
        activityId: 'activity-1',
        plannedDistance: 10000,
        plannedPace: 350,
        actualDistance: 10300,
        actualPace: 354,
      },
    ]);

    const feed = await service.getRecentForUser('user-1');

    expect(feed).toHaveLength(1);
    expect(feed[0].activityName).toBe('Corrida');
    expect(feed[0].distanceKm).toBeCloseTo(10.3, 5);
    expect(feed[0].verdict).toBe('no_plano');
    expect(feed[0].content?.tips).toEqual(['Hidrate-se melhor.']);
  });
});
