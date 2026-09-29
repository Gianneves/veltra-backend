import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { AuthSessionService } from 'src/auth/auth-session.service';
import { InsightsService } from 'src/insights/insights.service';

describe('ActivitiesController', () => {
  let controller: ActivitiesController;
  let activitiesService: {
    create: jest.Mock;
    findAll: jest.Mock;
    findYears: jest.Mock;
    findOneForUser: jest.Mock;
  };
  let sessionService: { resolveUserId: jest.Mock };
  let insightsService: {
    getForActivity: jest.Mock;
    generateForActivity: jest.Mock;
  };

  beforeEach(async () => {
    activitiesService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findYears: jest.fn(),
      findOneForUser: jest.fn(),
    };
    sessionService = { resolveUserId: jest.fn().mockResolvedValue('user-1') };
    insightsService = {
      getForActivity: jest.fn(),
      generateForActivity: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ActivitiesController],
      providers: [
        { provide: ActivitiesService, useValue: activitiesService },
        { provide: AuthSessionService, useValue: sessionService },
        { provide: InsightsService, useValue: insightsService },
      ],
    }).compile();

    controller = module.get<ActivitiesController>(ActivitiesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('scopes listings to the session user', async () => {
    await controller.findAll({} as Request, '2', '10', 'week', undefined);

    expect(activitiesService.findAll).toHaveBeenCalledWith(
      'user-1',
      2,
      10,
      'week',
      undefined,
    );
  });

  it('scopes single activity lookups to the session user', async () => {
    activitiesService.findOneForUser.mockResolvedValue({ id: 'activity-1' });

    await controller.findOne('activity-1', {} as Request);

    expect(activitiesService.findOneForUser).toHaveBeenCalledWith(
      'activity-1',
      'user-1',
    );
  });

  it('throws 404 when the activity does not belong to the user', async () => {
    activitiesService.findOneForUser.mockResolvedValue(null);

    await expect(
      controller.findOne('activity-1', {} as Request),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('attaches the session user when creating an activity', async () => {
    await controller.create({ activityStravaId: 1 } as never, {} as Request);

    expect(activitiesService.create).toHaveBeenCalledWith(
      { activityStravaId: 1 },
      { id: 'user-1' },
    );
  });

  it('returns the activity insight scoped to the session user', async () => {
    activitiesService.findOneForUser.mockResolvedValue({ id: 'activity-1' });
    insightsService.getForActivity.mockResolvedValue(null);

    await controller.findInsight('activity-1', {} as Request);

    expect(insightsService.getForActivity).toHaveBeenCalledWith(
      'activity-1',
      'user-1',
    );
  });

  it('generates the activity insight for the session user', async () => {
    activitiesService.findOneForUser.mockResolvedValue({ id: 'activity-1' });
    insightsService.generateForActivity.mockResolvedValue({ id: 'insight-1' });

    await controller.generateInsight('activity-1', {} as Request);

    expect(insightsService.generateForActivity).toHaveBeenCalledWith(
      { id: 'activity-1' },
      'user-1',
    );
  });
});
