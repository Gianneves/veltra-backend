import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindManyOptions, FindOperator } from 'typeorm';
import { AnalyticsService } from './analytics.service';
import { Activity } from 'src/activities/entities/activity.entity';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let repository: { find: jest.Mock };

  beforeEach(async () => {
    repository = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getRepositoryToken(Activity), useValue: repository },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('filters by user and by the current week only', async () => {
    repository.find.mockResolvedValue([
      { distance: 5000, moving_time: 1800 },
      { distance: 3000, moving_time: 1200 },
    ]);

    const result = await service.getWeeklyStats('user-1');

    expect(repository.find).toHaveBeenCalledTimes(1);
    const calls = repository.find.mock.calls as Array<
      [FindManyOptions<Activity>]
    >;
    const options = calls[0][0];
    const where = options.where as {
      user: { id: string };
      start_date: FindOperator<Date>;
    };

    expect(where.user).toEqual({ id: 'user-1' });

    const [from, to] = where.start_date.value as [Date, Date];

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    expect(from.getTime()).toBe(weekStart.getTime());
    expect(to.getTime() - from.getTime()).toBe(7 * 24 * 60 * 60 * 1000);

    expect(result).toEqual({
      totalDistance: 8000,
      totalTime: 3000,
      runCount: 2,
      weekStart: from.toISOString(),
    });
  });
});
