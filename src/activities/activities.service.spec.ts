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
  };

  beforeEach(async () => {
    activityRepository = {
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      findOne: jest.fn(),
      findOneBy: jest.fn(),
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
});
