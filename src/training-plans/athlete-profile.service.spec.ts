import { Activity } from 'src/activities/entities/activity.entity';
import { Goal } from 'src/goals/entities/goal.entity';
import { User } from 'src/users/entities/user.entity';
import { AthleteProfileService } from './athlete-profile.service';

function makeRun(overrides: Partial<Activity> = {}): Activity {
  return {
    id: `run-${Math.random().toString(36).slice(2, 8)}`,
    activityStravaId: 1,
    elapsed_time: 3600,
    moving_time: 3600,
    name: 'Corrida',
    type: 'Run',
    sport_type: 'Run',
    distance: 10000,
    average_speed: 2.78,
    max_speed: 3.2,
    start_date: new Date('2026-09-08T12:00:00'),
    start_date_local: new Date('2026-09-08T12:00:00'),
    ...overrides,
  } as Activity;
}

const NOW = new Date('2026-09-19T12:00:00');

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-1',
    userId: 'user-1',
    title: 'Meta',
    targetDistance: 10000,
    targetDate: '2026-12-06T15:00:00.000Z',
    threeKmTime: 0,
    ...overrides,
  } as Goal;
}

describe('AthleteProfileService', () => {
  const activityRepository = { find: jest.fn() };
  const userRepository = { findOne: jest.fn() };
  let service: AthleteProfileService;

  beforeEach(() => {
    jest.clearAllMocks();
    userRepository.findOne.mockResolvedValue(null);
    service = new AthleteProfileService(
      activityRepository as never,
      userRepository as never,
    );
  });

  it('prefere as últimas 3 semanas completas e ignora a semana atual', async () => {
    activityRepository.find.mockResolvedValue([
      makeRun({
        distance: 50000,
        moving_time: 18000,
        start_date: new Date('2026-09-15T12:00:00'),
        start_date_local: new Date('2026-09-15T12:00:00'),
      }),
      makeRun({
        distance: 10000,
        start_date: new Date('2026-08-25T12:00:00'),
        start_date_local: new Date('2026-08-25T12:00:00'),
      }),
      makeRun({
        distance: 20000,
        moving_time: 7200,
        start_date: new Date('2026-09-01T12:00:00'),
        start_date_local: new Date('2026-09-01T12:00:00'),
      }),
      makeRun({
        distance: 30000,
        moving_time: 10800,
        start_date: new Date('2026-09-08T12:00:00'),
        start_date_local: new Date('2026-09-08T12:00:00'),
      }),
      makeRun({
        distance: 60000,
        moving_time: 21600,
        start_date: new Date('2026-06-10T12:00:00'),
        start_date_local: new Date('2026-06-10T12:00:00'),
      }),
    ]);

    const profile = await service.build('user-1', undefined, NOW);

    expect(profile.recentForm.hasData).toBe(true);
    expect(profile.recentForm.runs).toBe(3);
    expect(profile.recentForm.weeklyKm).toBe(20);
    expect(profile.recentForm.peakWeeklyKm).toBe(30);
    expect(profile.recentForm.longestKm).toBe(30);
    expect(profile.recentForm.runsPerWeek).toBe(1);
    expect(profile.recentWeeklyKm).toBe(20);
    expect(profile.peakWeeklyKm).toBe(30);
    expect(profile.longestRunKm).toBe(30);
    expect(profile.runsPerWeek).toBe(1);
    expect(profile.pattern.weeksAnalyzed).toBe(3);
  });

  it('usa o nível mais conservador entre volume e teste de 3 km', async () => {
    activityRepository.find.mockResolvedValue([
      makeRun({
        distance: 30000,
        moving_time: 10800,
        start_date: new Date('2026-09-08T12:00:00'),
        start_date_local: new Date('2026-09-08T12:00:00'),
      }),
    ]);

    const slowTest = await service.build(
      'user-1',
      makeGoal({ threeKmTime: 1400 }),
      NOW,
    );
    expect(slowTest.level).toBe('beginner');
    expect(slowTest.threeKm?.level).toBe('beginner');

    const fastTest = await service.build(
      'user-1',
      makeGoal({ threeKmTime: 840 }),
      NOW,
    );
    expect(fastTest.threeKm?.level).toBe('advanced');
    expect(fastTest.level).toBe('advanced');
  });

  it('com recentOnly e sem corridas recentes usa apenas teste e escolhas', async () => {
    activityRepository.find.mockResolvedValue([
      makeRun({
        distance: 60000,
        moving_time: 21600,
        start_date: new Date('2026-06-10T12:00:00'),
        start_date_local: new Date('2026-06-10T12:00:00'),
      }),
    ]);

    const profile = await service.build(
      'user-1',
      makeGoal({ threeKmTime: 900 }),
      NOW,
      { recentOnly: true },
    );

    expect(profile.recentForm.hasData).toBe(false);
    expect(profile.hasData).toBe(false);
    expect(profile.recentWeeklyKm).toBe(0);
    expect(profile.peakWeeklyKm).toBe(0);
    expect(profile.longestRunKm).toBe(0);
    expect(profile.runsPerWeek).toBe(0);
    expect(profile.bestShortPace).toBeUndefined();
    expect(profile.pattern.hasData).toBe(false);
    expect(profile.threeKm?.level).toBe('intermediate');
    expect(profile.level).toBe('intermediate');
  });

  it('mantém o histórico antigo quando recentOnly não é pedido', async () => {
    activityRepository.find.mockResolvedValue([
      makeRun({
        distance: 60000,
        moving_time: 21600,
        start_date: new Date('2026-06-10T12:00:00'),
        start_date_local: new Date('2026-06-10T12:00:00'),
      }),
      makeRun({
        distance: 10000,
        start_date: new Date('2026-06-17T12:00:00'),
        start_date_local: new Date('2026-06-17T12:00:00'),
      }),
      makeRun({
        distance: 12000,
        start_date: new Date('2026-06-24T12:00:00'),
        start_date_local: new Date('2026-06-24T12:00:00'),
      }),
    ]);

    const profile = await service.build('user-1', makeGoal(), NOW);

    expect(profile.recentForm.hasData).toBe(false);
    expect(profile.hasData).toBe(true);
    expect(profile.longestRunKm).toBe(60);
  });

  it('calcula idade e FC máxima prevista', async () => {
    userRepository.findOne.mockResolvedValue({
      id: 'user-1',
      birthDate: '1986-09-19',
    } as User);
    activityRepository.find.mockResolvedValue([]);

    const profile = await service.build('user-1', undefined, NOW);

    expect(profile.age).toBe(40);
    expect(profile.predictedMaxHeartRate).toBe(180);
  });
});
