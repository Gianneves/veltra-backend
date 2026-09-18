import { Test, TestingModule } from '@nestjs/testing';
import { AuthSessionService } from 'src/auth/auth-session.service';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';

describe('InsightsController', () => {
  let controller: InsightsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InsightsController],
      providers: [
        {
          provide: InsightsService,
          useValue: { getRecentForUser: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: AuthSessionService,
          useValue: { resolveUserId: jest.fn().mockResolvedValue('user-1') },
        },
      ],
    }).compile();

    controller = module.get<InsightsController>(InsightsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('returns the insights feed for the current user', async () => {
    const result = await controller.findAll({} as never);

    expect(result).toEqual([]);
  });
});
