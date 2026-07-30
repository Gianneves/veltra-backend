import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Activity } from 'src/activities/entities/activity.entity';

@Injectable()
export class AnalyticsService {
    constructor(
        @InjectRepository(Activity)
        private readonly activityRepository: Repository<Activity>,
    ) {}

    async getWeeklyStats(userId: string) {
        const now = new Date();
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay());
        weekStart.setHours(0, 0, 0, 0);

        const activities = await this.activityRepository.find({
            where: { user: { id: userId } },
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
