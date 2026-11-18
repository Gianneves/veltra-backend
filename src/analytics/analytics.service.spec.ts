import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindManyOptions, FindOperator } from 'typeorm';
import { AnalyticsService } from './analytics.service';
import { Activity } from 'src/activities/entities/activity.entity';
import { RUN_SPORTS } from 'src/activities/run-sports';

type DateWhere = {
  user: { id: string };
  start_date: FindOperator<Date>;
  sport_type?: FindOperator<string[]>;
};

const WEDNESDAY = new Date(2026, 8, 16, 10, 0, 0);
const WEEK_START = new Date(2026, 8, 14);
const NEXT_WEEK_START = new Date(2026, 8, 21);

const runActivity = (overrides: Partial<Activity> = {}): Partial<Activity> => ({
  distance: 5000,
  moving_time: 1800,
  sport_type: 'Run',
  start_date: new Date(2026, 8, 15),
  ...overrides,
});

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

  const expectCurrentWeekWindow = () => {
    const where = findWhere();
    const limits = where.start_date.value as FindOperator<Date>[];
    const lower = limits.find(
      (operator) => operator.type === 'moreThanOrEqual',
    );
    const upper = limits.find((operator) => operator.type === 'lessThan');

    expect(where.start_date.type).toBe('and');
    expect(lower?.value.getTime()).toBe(WEEK_START.getTime());
    expect(upper?.value.getTime()).toBe(NEXT_WEEK_START.getTime());
  };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(WEDNESDAY);
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
    const result = await service.getWeeklyStats('user-1');

    expectCurrentWeekWindow();
    expect(result.weekStart).toBe(WEEK_START.toISOString());
  });

  it('usa intervalo semiaberto e conta a corrida da virada em uma única semana', async () => {
    repository.find.mockResolvedValue([
      runActivity({
        distance: 10000,
        moving_time: 3600,
        start_date: WEEK_START,
      }),
    ]);

    const result = await service.getWeeklyStats('user-1');

    expectCurrentWeekWindow();
    expect(result.runCount).toBe(1);
    expect(result.totalDistance).toBe(10000);
    expect(result.totalTime).toBe(3600);
  });

  it('filtra apenas corridas e ignora atividade que não é corrida', async () => {
    repository.find.mockResolvedValue([runActivity()]);

    const result = await service.getWeeklyStats('user-1');

    const where = findWhere();

    expect(where.sport_type?.type).toBe('in');
    expect(where.sport_type?.value).toEqual(RUN_SPORTS);

    expect(result).toEqual({
      totalDistance: 5000,
      totalTime: 1800,
      runCount: 1,
      weekStart: WEEK_START.toISOString(),
    });
  });

  it('filtra pelo usuário da sessão e não soma atividade de outro atleta', async () => {
    repository.find.mockResolvedValue([
      runActivity({ distance: 4200, moving_time: 1500 }),
    ]);

    const result = await service.getWeeklyStats('user-1');

    const where = findWhere();

    expect(where.user).toEqual({ id: 'user-1' });
    expect(result.totalDistance).toBe(4200);
    expect(result.totalTime).toBe(1500);
    expect(result.runCount).toBe(1);
  });

  it('devolve totalDistance, totalTime, runCount e weekStart no mesmo formato', async () => {
    repository.find.mockResolvedValue([
      runActivity({ sport_type: 'TrailRun', start_date: WEDNESDAY }),
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
    expect(result.weekStart).toBe(WEEK_START.toISOString());
    expect(Number.isNaN(Date.parse(result.weekStart))).toBe(false);
  });
});
