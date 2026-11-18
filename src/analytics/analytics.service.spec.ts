import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindManyOptions, FindOperator } from 'typeorm';
import { AnalyticsService } from './analytics.service';
import { Activity } from 'src/activities/entities/activity.entity';
import { RUN_SPORTS } from 'src/activities/run-sports';

type DateWhere = {
  user: { id: string };
  start_date: FindOperator<Date> | FindOperator<Date>[];
  sport_type?: FindOperator<string[]>;
};

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let repository: { find: jest.Mock };

  const findWhere = (): DateWhere => {
    expect(repository.find).toHaveBeenCalledTimes(1);
    const calls = repository.find.mock.calls as Array<
      [FindManyOptions<Activity>]
    >;
    return calls[0][0].where as DateWhere;
  };

  const windowOperators = (): [FindOperator<Date>, FindOperator<Date>] => {
    const where = findWhere();
    const dates = (
      Array.isArray(where.start_date) ? where.start_date : [where.start_date]
    ).flatMap((operator) =>
      operator.type === 'and'
        ? (operator.value as FindOperator<Date>[])
        : [operator],
    );
    const lower = dates.find((operator) => operator.type === 'moreThanOrEqual');
    const upper = dates.find((operator) => operator.type === 'lessThan');

    expect(lower).toBeDefined();
    expect(upper).toBeDefined();

    return [lower as FindOperator<Date>, upper as FindOperator<Date>];
  };

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

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('monta a janela da semana atual entre segunda 00:00 e a segunda seguinte, no horário local', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 16, 10, 0, 0));

    const result = await service.getWeeklyStats('user-1');

    const [lower, upper] = windowOperators();

    expect(lower.value.getTime()).toBe(new Date(2026, 8, 14).getTime());
    expect(upper.value.getTime()).toBe(new Date(2026, 8, 21).getTime());
    expect(result.weekStart).toBe(new Date(2026, 8, 14).toISOString());
  });

  it('usa intervalo semiaberto e conta a corrida da virada em uma única semana', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 16, 10, 0, 0));
    repository.find.mockResolvedValue([
      {
        distance: 10000,
        moving_time: 3600,
        start_date: new Date(2026, 8, 14),
      },
    ]);

    const result = await service.getWeeklyStats('user-1');

    const [lower, upper] = windowOperators();

    expect(lower.type).toBe('moreThanOrEqual');
    expect(lower.value.getTime()).toBe(new Date(2026, 8, 14).getTime());
    expect(upper.type).toBe('lessThan');
    expect(upper.value.getTime()).toBe(new Date(2026, 8, 21).getTime());
    expect(result.runCount).toBe(1);
    expect(result.totalDistance).toBe(10000);
    expect(result.totalTime).toBe(3600);
  });

  it('filtra apenas corridas e ignora atividade que não é corrida', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 16, 10, 0, 0));
    repository.find.mockResolvedValue([
      {
        distance: 5000,
        moving_time: 1800,
        sport_type: 'Run',
        start_date: new Date(2026, 8, 15),
      },
    ]);

    const result = await service.getWeeklyStats('user-1');

    const where = findWhere();
    const sportFilter = where.sport_type;

    expect(sportFilter).toBeDefined();
    expect(sportFilter?.type).toBe('in');
    expect(sportFilter?.value).toEqual(RUN_SPORTS);

    expect(result).toEqual({
      totalDistance: 5000,
      totalTime: 1800,
      runCount: 1,
      weekStart: new Date(2026, 8, 14).toISOString(),
    });
  });

  it('filtra pelo usuário da sessão e não soma atividade de outro atleta', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 16, 10, 0, 0));
    repository.find.mockResolvedValue([
      {
        distance: 4200,
        moving_time: 1500,
        sport_type: 'Run',
        start_date: new Date(2026, 8, 15),
      },
    ]);

    const result = await service.getWeeklyStats('user-1');

    const where = findWhere();

    expect(where.user).toEqual({ id: 'user-1' });
    expect(result.totalDistance).toBe(4200);
    expect(result.totalTime).toBe(1500);
    expect(result.runCount).toBe(1);
  });

  it('devolve totalDistance, totalTime, runCount e weekStart no mesmo formato', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 16, 10, 0, 0));
    repository.find.mockResolvedValue([
      {
        distance: 7000,
        moving_time: 2400,
        sport_type: 'TrailRun',
        start_date: new Date(2026, 8, 16),
      },
    ]);

    const result = await service.getWeeklyStats('user-1');

    expect(Object.keys(result).sort()).toEqual([
      'runCount',
      'totalDistance',
      'totalTime',
      'weekStart',
    ]);
    expect(typeof result.totalDistance).toBe('number');
    expect(typeof result.totalTime).toBe('number');
    expect(typeof result.runCount).toBe('number');
    expect(result.weekStart).toBe(new Date(2026, 8, 14).toISOString());
    expect(Number.isNaN(Date.parse(result.weekStart))).toBe(false);
  });
});
