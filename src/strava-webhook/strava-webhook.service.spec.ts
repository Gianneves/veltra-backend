import type { User } from 'src/users/entities/user.entity';
import type { StravaWebhookEvent } from 'src/utils/types';
import { StravaWebhookService } from './strava-webhook.service';

const RUN_DETAIL = {
  id: 999,
  elapsed_time: 3600,
  moving_time: 3500,
  name: '6x400',
  type: 'Run',
  sport_type: 'Run',
  distance: 8000,
  start_date_local: '2026-09-15T07:00:00.000Z',
  laps: [],
};

function createService(options?: {
  user?: User | null;
  detail?: unknown;
  existing?: { id: string } | null;
  manuallyLinked?: boolean;
}) {
  const stravaService = {
    fetchActivityById: jest.fn(() =>
      Promise.resolve(options?.detail ?? RUN_DETAIL),
    ),
  };
  const usersService = {
    findByStravaId: jest.fn(() =>
      Promise.resolve(options?.user === undefined ? makeUser() : options.user),
    ),
    clearStravaTokens: jest.fn(() => Promise.resolve()),
  };
  const activitiesService = {
    findByStravaId: jest.fn(() => Promise.resolve(options?.existing ?? null)),
    upsert: jest.fn((dto: unknown) =>
      Promise.resolve({ ...(dto as object), id: 'activity-1' }),
    ),
    remove: jest.fn(() => Promise.resolve()),
  };
  const matcher = {
    matchActivity: jest.fn(() =>
      Promise.resolve({ matched: true, sessionId: 'session-1' }),
    ),
    unlinkSessionsForActivity: jest.fn(() => Promise.resolve(1)),
    isManuallyLinked: jest.fn(() =>
      Promise.resolve(options?.manuallyLinked ?? false),
    ),
  };
  const tokenService = {
    getAccessToken: jest.fn(() => Promise.resolve('token')),
    invalidate: jest.fn(() => Promise.resolve()),
  };
  const redisService = {
    setNx: jest.fn(() => Promise.resolve(true)),
    lpush: jest.fn(() => Promise.resolve()),
    rpop: jest.fn(() => Promise.resolve(null)),
  };

  const service = new StravaWebhookService(
    stravaService as any,
    usersService as any,
    activitiesService as any,
    matcher as any,
    tokenService as any,
    redisService as any,
  );

  return {
    service,
    stravaService,
    usersService,
    activitiesService,
    matcher,
    tokenService,
    redisService,
  };
}

function makeUser(): User {
  return {
    id: 'user-1',
    stravaId: 555,
    name: 'Atleta',
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: new Date(Date.now() + 3600_000),
  } as User;
}

function activityEvent(
  overrides: Partial<StravaWebhookEvent> = {},
): StravaWebhookEvent {
  return {
    object_type: 'activity',
    object_id: 999,
    aspect_type: 'create',
    event_time: 1700000000,
    owner_id: 555,
    ...overrides,
  };
}

describe('StravaWebhookService', () => {
  it('enfileira evento novo e ignora duplicado', async () => {
    const { service, redisService } = createService();

    const first = await service.enqueue(activityEvent());
    expect(first).toBe(true);
    expect(redisService.lpush).toHaveBeenCalled();

    redisService.setNx.mockResolvedValue(false);
    const second = await service.enqueue(activityEvent());
    expect(second).toBe(false);
  });

  it('ignora payload inválido', async () => {
    const { service } = createService();
    const result = await service.enqueue({
      object_type: 'unknown' as never,
      object_id: 1,
      aspect_type: 'create',
      event_time: 1,
      owner_id: 1,
    });
    expect(result).toBe(false);
  });

  it('processa create: busca detalhe, salva e vincula', async () => {
    const { service, activitiesService, matcher, stravaService } =
      createService();

    await service.handleEvent(activityEvent());

    expect(stravaService.fetchActivityById).toHaveBeenCalledWith(999, 'token');
    expect(activitiesService.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ activityStravaId: 999, name: '6x400' }),
      expect.objectContaining({ id: 'user-1' }),
    );
    expect(matcher.matchActivity).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ id: 'activity-1' }),
    );
  });

  it('não vincula novamente quando o vínculo é manual', async () => {
    const { service, matcher, activitiesService } = createService({
      existing: { id: 'activity-1' },
      manuallyLinked: true,
    });

    await service.handleEvent(activityEvent({ aspect_type: 'update' }));

    expect(activitiesService.upsert).toHaveBeenCalled();
    expect(matcher.matchActivity).not.toHaveBeenCalled();
  });

  it('desvincula e remove atividade no delete', async () => {
    const { service, activitiesService, matcher } = createService({
      existing: { id: 'activity-1' },
    });

    await service.handleEvent(activityEvent({ aspect_type: 'delete' }));

    expect(matcher.unlinkSessionsForActivity).toHaveBeenCalledWith(
      'activity-1',
    );
    expect(activitiesService.remove).toHaveBeenCalled();
  });

  it('remove atividade que deixou de ser corrida', async () => {
    const { service, activitiesService, matcher } = createService({
      existing: { id: 'activity-1' },
      detail: { ...RUN_DETAIL, sport_type: 'Ride' },
    });

    await service.handleEvent(activityEvent({ aspect_type: 'update' }));

    expect(matcher.unlinkSessionsForActivity).toHaveBeenCalledWith(
      'activity-1',
    );
    expect(activitiesService.remove).toHaveBeenCalled();
    expect(matcher.matchActivity).not.toHaveBeenCalled();
  });

  it('limpa tokens ao desautorizar o atleta', async () => {
    const { service, usersService, tokenService } = createService();

    await service.handleEvent({
      object_type: 'athlete',
      object_id: 555,
      aspect_type: 'update',
      event_time: 1700000000,
      owner_id: 555,
      updates: { authorized: false },
    });

    expect(usersService.clearStravaTokens).toHaveBeenCalledWith('user-1');
    expect(tokenService.invalidate).toHaveBeenCalledWith('user-1');
  });

  it('ignora evento de usuário desconhecido', async () => {
    const { service, stravaService } = createService({ user: null });

    await service.handleEvent(activityEvent());

    expect(stravaService.fetchActivityById).not.toHaveBeenCalled();
  });
});
