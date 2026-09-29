import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Activity } from 'src/activities/entities/activity.entity';
import {
  buildBestEfforts,
  buildPredictions,
  buildTrophies,
} from './achievement-rules';

@Injectable()
export class AchievementsService {
  constructor(
    @InjectRepository(Activity)
    private readonly activityRepository: Repository<Activity>,
  ) {}

  async getAchievements(userId: string, now: Date = new Date()) {
    const runs = await this.activityRepository.find({
      where: [
        { user: { id: userId }, type: 'Run' },
        { user: { id: userId }, sport_type: 'Run' },
      ],
      order: { start_date: 'ASC' },
    });

    return {
      trophies: buildTrophies(runs),
      bestEfforts: buildBestEfforts(runs),
      predictions: buildPredictions(runs, now),
    };
  }
}
