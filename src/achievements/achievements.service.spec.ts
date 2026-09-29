import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindManyOptions } from 'typeorm';
import { Activity } from 'src/activities/entities/activity.entity';
import { AchievementsService } from './achievements.service';

describe('AchievementsService', () => {
  let service: AchievementsService;
  let repository: { find: jest.Mock };

  beforeEach(async () => {
    repository = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AchievementsService,
        { provide: getRepositoryToken(Activity), useValue: repository },
      ],
    }).compile();

    service = module.get<AchievementsService>(AchievementsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('scopes the run query by user', async () => {
    await service.getAchievements('user-1');

    expect(repository.find).toHaveBeenCalledTimes(1);
    const calls = repository.find.mock.calls as Array<
      [FindManyOptions<Activity>]
    >;
    const options = calls[0][0];

    expect(options.where).toEqual([
      { user: { id: 'user-1' }, type: 'Run' },
      { user: { id: 'user-1' }, sport_type: 'Run' },
    ]);
    expect(options.order).toEqual({ start_date: 'ASC' });
  });

  it('returns trophies, best efforts and predictions', async () => {
    const now = new Date('2026-07-01T12:00:00Z');
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 10);

    repository.find.mockResolvedValue([
      {
        id: 'activity-1',
        name: 'Corrida',
        type: 'Run',
        sport_type: 'Run',
        distance: 5000,
        moving_time: 1500,
        start_date: startDate,
      },
    ]);

    const result = await service.getAchievements('user-1', now);

    expect(result.trophies).toHaveLength(5);
    expect(result.trophies[0]).toMatchObject({
      id: 'first-step',
      earned: true,
    });
    expect(result.bestEfforts.map((effort) => effort.distanceKm)).toEqual([
      3, 5,
    ]);
    expect(result.predictions).toHaveLength(6);
  });
});
