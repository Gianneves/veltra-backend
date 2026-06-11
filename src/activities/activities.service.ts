import { Injectable } from '@nestjs/common';
import { CreateActivityDto } from './dto/create-activity.dto';
import { Repository } from 'typeorm';
import { Activity } from './entities/activity.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';
import { InsightsService } from 'src/insights/insights.service';
import { AiService } from 'src/ai/ai.service';

@Injectable()
export class ActivitiesService {
  constructor(
    @InjectRepository(Activity)
    private readonly activityRepository: Repository<Activity>,
    private readonly insightsService: InsightsService,
    private readonly aiService: AiService,
  ) {}

  async create(createActivityDto: CreateActivityDto, user?: User) {
    const activityExist = await this.findOne(createActivityDto.activityStravaId);

    if (activityExist) {
      throw new Error('Atividade já registrada.')
    }

    const activity = this.activityRepository.create(createActivityDto);

    if (user) {
      activity.user = user;
    }

    const savedActivity = await this.activityRepository.save(activity);

    this.generateInsightAndEmbedding(savedActivity).catch((err) =>
      console.error('Erro ao gerar insight/embedding:', err.message),
    );

    return savedActivity;
  }

  private async generateInsightAndEmbedding(activity: Activity) {
    const prompt = this.buildActivityPrompt(activity);

    try {
      const vector = await this.aiService.createEmbedding(prompt);
      await this.activityRepository.update(activity.id, { embedding: JSON.stringify(vector) });
    } catch (error: unknown) {
      console.error('Falha ao gerar embedding:', (error as Error).message);
    }

    try {
      await this.insightsService.createFromActivity(activity);
    } catch (error: unknown) {
      console.error('Falha ao gerar insight:', (error as Error).message);
    }
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

  async findAll() {
      try {
        const activities = await this.activityRepository.find({});

        return activities;
      } catch (error: unknown) {
        console.error(error);
      }
  }

  async findOne(id: number) {
      const activity = await this.activityRepository.findOneBy({ activityStravaId: id });

      return activity;
  }

}
