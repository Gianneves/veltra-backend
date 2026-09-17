import type { User } from 'src/users/entities/user.entity';
import { StravaTokenService } from './strava-token.service';

function createService() {
  const stravaService = {
    refreshAccessToken: jest.fn(),
  };
  const usersService = {
    updateStravaTokens: jest.fn(() => Promise.resolve()),
    clearStravaTokens: jest.fn(() => Promise.resolve()),
  };
  const redisService = {
    get: jest.fn(() => Promise.resolve(null as string | null)),
    set: jest.fn(() => Promise.resolve()),
    del: jest.fn(() => Promise.resolve()),
    setNx: jest.fn(() => Promise.resolve(true)),
  };

  const service = new StravaTokenService(
    stravaService as any,
    usersService as any,
    redisService as any,
  );

  return { service, stravaService, usersService, redisService };
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    stravaId: 1,
    name: 'Atleta',
    accessToken: 'token-antigo',
    refreshToken: 'refresh-antigo',
    expiresAt: new Date(0),
    ...overrides,
  } as User;
}

describe('StravaTokenService', () => {
  it('retorna token do cache quando disponível', async () => {
    const { service, stravaService, redisService } = createService();
    redisService.get.mockResolvedValue('token-cache');

    const token = await service.getAccessToken(makeUser());

    expect(token).toBe('token-cache');
    expect(stravaService.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('usa token armazenado ainda válido e cacheia', async () => {
    const { service, stravaService, redisService } = createService();
    const user = makeUser({
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const token = await service.getAccessToken(user);

    expect(token).toBe('token-antigo');
    expect(redisService.set).toHaveBeenCalled();
    expect(stravaService.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('renova token expirado, persiste e libera o lock', async () => {
    const { service, stravaService, usersService, redisService } =
      createService();

    stravaService.refreshAccessToken.mockResolvedValue({
      access_token: 'token-novo',
      refresh_token: 'refresh-novo',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      athlete: { id: 1, firstname: 'A', lastname: 'B' },
    });

    const token = await service.getAccessToken(makeUser());

    expect(token).toBe('token-novo');
    expect(stravaService.refreshAccessToken).toHaveBeenCalledWith(
      'refresh-antigo',
    );
    expect(usersService.updateStravaTokens).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        accessToken: 'token-novo',
        refreshToken: 'refresh-novo',
      }),
    );
    expect(redisService.del).toHaveBeenCalledWith('strava:refresh:user-1');
  });

  it('retorna null quando o refresh falha', async () => {
    const { service, stravaService, redisService } = createService();
    stravaService.refreshAccessToken.mockRejectedValue(new Error('401'));

    const token = await service.getAccessToken(makeUser());

    expect(token).toBeNull();
    expect(redisService.del).toHaveBeenCalledWith('strava:refresh:user-1');
  });

  it('retorna null sem refresh token', async () => {
    const { service, stravaService } = createService();

    const token = await service.getAccessToken(makeUser({ refreshToken: '' }));

    expect(token).toBeNull();
    expect(stravaService.refreshAccessToken).not.toHaveBeenCalled();
  });
});
