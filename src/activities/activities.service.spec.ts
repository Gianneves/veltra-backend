import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ActivitiesService } from './activities.service';
import { Activity } from './entities/activity.entity';
import { InsightsService } from 'src/insights/insights.service';
import { AiService } from 'src/ai/ai.service';

describe('ActivitiesService', () => {
  let service: ActivitiesService;
  let activityRepository: {
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    findOneBy: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(async () => {
    activityRepository = {
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      save: jest.fn((entity: unknown) => Promise.resolve(entity)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesService,
        {
          provide: getRepositoryToken(Activity),
          useValue: activityRepository,
        },
        {
          provide: InsightsService,
          useValue: { createFromActivity: jest.fn() },
        },
        {
          provide: AiService,
          useValue: {
            createEmbedding: jest.fn(),
            generateInsight: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ActivitiesService>(ActivitiesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('scopes activity listings to the given user', async () => {
    await service.findAll('user-1');

    const expectedWhere: Record<string, unknown> = {
      user: { id: 'user-1' },
    };

    expect(activityRepository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
  });

  it('scopes single activity lookups to the given user', async () => {
    const id = '018f0000-0000-7000-8000-000000000000';

    await service.findOneForUser(id, 'user-1');

    expect(activityRepository.findOne).toHaveBeenCalledWith({
      where: { id, user: { id: 'user-1' } },
    });
  });

  describe('upsert', () => {
    const baseDto = {
      activityStravaId: 123,
      elapsed_time: 3600,
      moving_time: 3400,
      name: 'Corrida',
      type: 'Run',
      sport_type: 'Run',
      distance: 10000,
      max_speed: 4,
      total_elevation_gain: 50,
      average_cadence: 170,
      average_speed: 2.9,
    };

    it('não apaga FC/watts/voltas já gravados quando o DTO não traz esses campos', async () => {
      const existing = {
        activityStravaId: 123,
        average_heartrate: 150,
        max_heartrate: 172,
        max_watts: 250,
        laps: [{ distance: 1000, moving_time: 360, elapsed_time: 360 }],
      };
      activityRepository.findOneBy.mockResolvedValue(existing);

      const saved = await service.upsert(baseDto, { id: 'user-1' } as never);

      expect(activityRepository.save).toHaveBeenCalledWith(existing);
      expect(saved.average_heartrate).toBe(150);
      expect(saved.max_heartrate).toBe(172);
      expect(saved.max_watts).toBe(250);
      expect(saved.laps).toEqual(existing.laps);
    });

    it('atualiza a FC quando o DTO traz valores', async () => {
      const existing = { activityStravaId: 123, average_heartrate: 150 };
      activityRepository.findOneBy.mockResolvedValue(existing);

      const saved = await service.upsert(
        {
          ...baseDto,
          average_heartrate: 160,
          max_heartrate: 178,
        },
        { id: 'user-1' } as never,
      );

      expect(saved.average_heartrate).toBe(160);
      expect(saved.max_heartrate).toBe(178);
    });
  });
});
