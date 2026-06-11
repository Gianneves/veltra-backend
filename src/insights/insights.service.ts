import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Insight } from './entities/insight.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { AiService } from 'src/ai/ai.service';
import { Activity } from 'src/activities/entities/activity.entity';

@Injectable()
export class InsightsService {
    constructor(
        @InjectRepository(Insight)
        private readonly insightRepository: Repository<Insight>,
        private readonly aiService: AiService
    ) {}

    async createFromActivity(activity: Activity) {
        const prompt = this.buildActivityPrompt(activity);
        const content = await this.aiService.generateInsight(prompt);

        const insight = this.insightRepository.create({
            activityId: activity.id,
            content,
            status: 'completed',
        });

        return await this.insightRepository.save(insight);
    }

    private buildActivityPrompt(activity: Activity): string {
        const format = (val: number | undefined | null, suffix = '') =>
            val != null ? `${val}${suffix}` : 'N/A';

        return `
Activity Name: ${activity.name}
Type: ${activity.sport_type}
Distance: ${format(activity.distance, ' km')}
Elapsed Time: ${format(activity.elapsed_time, 's')}
Moving Time: ${format(activity.moving_time, 's')}
Average Speed: ${format(activity.average_speed, ' km/h')}
Max Speed: ${format(activity.max_speed, ' km/h')}
Average Heart Rate: ${format(activity.average_heartrate, ' bpm')}
Max Heart Rate: ${format(activity.max_heartrate, ' bpm')}
Average Cadence: ${format(activity.average_cadence, ' rpm')}
Elevation Gain: ${format(activity.total_elevation_gain, ' m')}
Max Watts: ${format(activity.max_watts, ' W')}
        `.trim();
    }
}
