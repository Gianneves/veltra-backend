import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { And, In, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { Activity } from 'src/activities/entities/activity.entity';
import { RUN_SPORTS } from 'src/activities/run-sports';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Activity)
    private readonly activityRepository: Repository<Activity>,
  ) {}

  async getWeeklyStats(userId: string) {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const activities = await this.activityRepository.find({
      where: {
        user: { id: userId },
        sport_type: In(RUN_SPORTS),
        start_date: And(MoreThanOrEqual(weekStart), LessThan(weekEnd)),
      },
    });

    const totalDistance = activities.reduce((sum, a) => sum + a.distance, 0);
    const totalTime = activities.reduce((sum, a) => sum + a.moving_time, 0);

    return {
      totalDistance,
      totalTime,
      runCount: activities.length,
      weekStart: weekStart.toISOString(),
    };
  }
}
