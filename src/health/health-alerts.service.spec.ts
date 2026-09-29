import { Activity } from 'src/activities/entities/activity.entity';
import { User } from 'src/users/entities/user.entity';
import { HealthAlertsService } from './health-alerts.service';

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'activity-1',
    activityStravaId: 1,
    elapsed_time: 3000,
    moving_time: 3000,
    name: 'Corrida',
    type: 'Run',
    sport_type: 'Run',
    distance: 10000,
    average_speed: 3.33,
    max_speed: 4,
    start_date: new Date('2026-09-15T12:00:00'),
    start_date_local: new Date('2026-09-15T12:00:00'),
    ...overrides,
  } as Activity;
}

describe('HealthAlertsService', () => {
  let service: HealthAlertsService;
  const activityRepository = { find: jest.fn() };
  const userRepository = { findOne: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new HealthAlertsService(
      activityRepository as never,
      userRepository as never,
    );
  });

  it('gera alerta de aumento brusco de volume', async () => {
    const now = new Date('2026-09-19T12:00:00');
    activityRepository.find.mockResolvedValue([
      makeActivity({
        id: 'w1',
        distance: 20000,
        start_date_local: new Date('2026-08-18T12:00:00'),
      }),
      makeActivity({
        id: 'w2',
        distance: 20000,
        start_date_local: new Date('2026-08-25T12:00:00'),
      }),
      makeActivity({
        id: 'w3',
        distance: 20000,
        start_date_local: new Date('2026-09-01T12:00:00'),
      }),
      makeActivity({
        id: 'w4',
        distance: 20000,
        start_date_local: new Date('2026-09-08T12:00:00'),
      }),
      makeActivity({
        id: 'current',
        distance: 30000,
        start_date_local: new Date('2026-09-15T12:00:00'),
      }),
    ]);
    userRepository.findOne.mockResolvedValue(null);

    const alerts = await service.getAlerts('user-1', now);

    expect(alerts.map((alert) => alert.key)).toContain('volume_ramp');
  });

  it('não gera alerta de volume em progressão segura', async () => {
    const now = new Date('2026-09-19T12:00:00');
    activityRepository.find.mockResolvedValue([
      makeActivity({
        id: 'w1',
        distance: 20000,
        start_date_local: new Date('2026-09-01T12:00:00'),
      }),
      makeActivity({
        id: 'w2',
        distance: 20000,
        start_date_local: new Date('2026-09-08T12:00:00'),
      }),
      makeActivity({
        id: 'current',
        distance: 22000,
        start_date_local: new Date('2026-09-15T12:00:00'),
      }),
    ]);
    userRepository.findOne.mockResolvedValue(null);

    const alerts = await service.getAlerts('user-1', now);

    expect(alerts.map((alert) => alert.key)).not.toContain('volume_ramp');
  });

  it('gera alerta quando a FC máxima supera a prevista para a idade', async () => {
    const now = new Date('2026-09-19T12:00:00');
    activityRepository.find.mockResolvedValue([
      makeActivity({
        id: 'hr-1',
        name: 'Tiro forte',
        max_heartrate: 195,
        average_heartrate: 160,
        start_date_local: new Date('2026-09-16T12:00:00'),
      }),
    ]);
    userRepository.findOne.mockResolvedValue({
      id: 'user-1',
      birthDate: '1986-09-19',
    } as User);

    const alerts = await service.getAlerts('user-1', now);

    expect(alerts.map((alert) => alert.key)).toContain(
      'hr_above_predicted_hr-1',
    );
  });

  it('gera alerta de acompanhamento médico para 60+', async () => {
    const now = new Date('2026-09-19T12:00:00');
    activityRepository.find.mockResolvedValue([]);
    userRepository.findOne.mockResolvedValue({
      id: 'user-1',
      birthDate: '1960-01-01',
    } as User);

    const alerts = await service.getAlerts('user-1', now);

    const checkup = alerts.find((alert) => alert.key === 'checkup_due');
    expect(checkup?.severity).toBe('medical');
  });

  it('gera alerta médico quando menor corre distância não recomendada', async () => {
    const now = new Date('2026-09-19T12:00:00');
    activityRepository.find.mockResolvedValue([
      makeActivity({
        id: 'long-1',
        distance: 22000,
        start_date_local: new Date('2026-09-16T12:00:00'),
      }),
    ]);
    userRepository.findOne.mockResolvedValue({
      id: 'user-1',
      birthDate: '2010-09-19',
    } as User);

    const alerts = await service.getAlerts('user-1', now);

    const alert = alerts.find((item) =>
      item.key.startsWith('age_distance_'),
    );
    expect(alert?.severity).toBe('medical');
  });

  it('gera alerta para estímulos fortes em dias seguidos', async () => {
    const now = new Date('2026-09-19T12:00:00');
    activityRepository.find.mockResolvedValue([
      makeActivity({
        id: 'hard-1',
        name: 'Tiro 8x400',
        average_heartrate: 172,
        start_date_local: new Date('2026-09-15T12:00:00'),
      }),
      makeActivity({
        id: 'hard-2',
        name: 'Tiro 10x400',
        average_heartrate: 174,
        start_date_local: new Date('2026-09-16T12:00:00'),
      }),
    ]);
    userRepository.findOne.mockResolvedValue({
      id: 'user-1',
      birthDate: '1986-09-19',
    } as User);

    const alerts = await service.getAlerts('user-1', now);

    expect(
      alerts.some((alert) => alert.key.startsWith('consecutive_hard_')),
    ).toBe(true);
  });
});
