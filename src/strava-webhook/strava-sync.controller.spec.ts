import { StravaSyncController } from './strava-sync.controller';
import { StravaWebhookService } from './strava-webhook.service';

function buildController() {
  const stravaService = {
    fetchAllActivities: jest.fn(),
    fetchActivityById: jest.fn(),
  };
  const usersService = {
    findFullById: jest.fn(() => Promise.resolve({ id: 'user-1' })),
  };
  const activitiesService = {
    upsert: jest.fn((dto: Record<string, unknown>) =>
      Promise.resolve({ id: 'activity-1', ...dto }),
    ),
  };
  const matcher = {
    matchActivity: jest.fn(() => Promise.resolve({ matched: true })),
  };
  const tokenService = {
    getAccessToken: jest.fn(() => Promise.resolve('token-abc')),
  };
  const webhookService = {
    toActivityDto: (detail: Record<string, unknown>) =>
      StravaWebhookService.prototype.toActivityDto(detail as never),
  };
  const insightsService = {
    generateIfMissing: jest.fn(() => Promise.resolve(undefined)),
  };
  const sessionService = {
    resolveUserId: jest.fn(() => Promise.resolve('user-1')),
  };

  const controller = new StravaSyncController(
    stravaService as never,
    usersService as never,
    activitiesService as never,
    matcher as never,
    tokenService as never,
    webhookService as never,
    insightsService as never,
    sessionService as never,
  );

  return { controller, stravaService, activitiesService };
}

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: 111,
    name: 'Corrida',
    type: 'Run',
    sport_type: 'Run',
    distance: 8000,
    moving_time: 3000,
    elapsed_time: 3100,
    start_date: new Date().toISOString(),
    start_date_local: new Date().toISOString(),
    ...overrides,
  };
}

describe('StravaSyncController', () => {
  it('busca o detalhe e grava a FC quando o summary indica has_heartrate', async () => {
    const { controller, stravaService, activitiesService } = buildController();
    stravaService.fetchAllActivities.mockResolvedValue([
      summary({ has_heartrate: true }),
    ]);
    stravaService.fetchActivityById.mockResolvedValue({
      average_heartrate: 150,
      max_heartrate: 175,
    });

    const result = await controller.resync({} as never, { days: 7 });

    expect(stravaService.fetchActivityById).toHaveBeenCalledWith(
      111,
      'token-abc',
    );
    expect(activitiesService.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        activityStravaId: 111,
        average_heartrate: 150,
        max_heartrate: 175,
      }),
      expect.objectContaining({ id: 'user-1' }),
    );
    expect(result).toEqual({ synced: 1, matched: 1, days: 7 });
  });

  it('não busca o detalhe quando has_heartrate é falso', async () => {
    const { controller, stravaService, activitiesService } = buildController();
    stravaService.fetchAllActivities.mockResolvedValue([
      summary({ id: 222, has_heartrate: false }),
    ]);

    await controller.resync({} as never, { days: 7 });

    expect(stravaService.fetchActivityById).not.toHaveBeenCalled();
    expect(activitiesService.upsert).toHaveBeenCalledTimes(1);
  });

  it('usa o summary quando o detalhe falha', async () => {
    const { controller, stravaService, activitiesService } = buildController();
    stravaService.fetchAllActivities.mockResolvedValue([
      summary({ id: 333, has_heartrate: true }),
    ]);
    stravaService.fetchActivityById.mockRejectedValue(new Error('boom'));

    const result = await controller.resync({} as never, { days: 7 });

    expect(activitiesService.upsert).toHaveBeenCalledTimes(1);
    expect(result.synced).toBe(1);
  });

  it('ignora atividades fora da janela', async () => {
    const { controller, stravaService, activitiesService } = buildController();
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    stravaService.fetchAllActivities.mockResolvedValue([
      summary({ id: 444, has_heartrate: true, start_date: old }),
    ]);

    const result = await controller.resync({} as never, { days: 7 });

    expect(stravaService.fetchActivityById).not.toHaveBeenCalled();
    expect(activitiesService.upsert).not.toHaveBeenCalled();
    expect(result.synced).toBe(0);
  });
});
