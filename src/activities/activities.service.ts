import { Injectable } from '@nestjs/common';
import { CreateActivityDto } from './dto/create-activity.dto';
import { Repository, Between } from 'typeorm';
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

  async create(
    createActivityDto: CreateActivityDto,
    user?: User,
    generateAI = true,
  ) {
    const activityExist = await this.findOne(
      createActivityDto.activityStravaId,
    );

    if (activityExist) {
      throw new Error('Atividade já registrada.');
    }

    const activity = this.activityRepository.create(createActivityDto);

    if (user) {
      activity.user = user;
    }

    const savedActivity = await this.activityRepository.save(activity);

    if (generateAI) {
      this.generateInsightAndEmbedding(savedActivity).catch((err) =>
        console.error('Erro ao gerar insight/embedding:', err.message),
      );
    }

    return savedActivity;
  }

  private async generateInsightAndEmbedding(activity: Activity) {
    const prompt = this.buildActivityPrompt(activity);

    try {
      const vector = await this.aiService.createEmbedding(prompt);
      await this.activityRepository.update(activity.id, {
        embedding: JSON.stringify(vector),
      });
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

  async findAll(page = 1, limit = 20, period?: string, year?: string) {
    const where: any = {};

    if (period && period !== 'all') {
      const now = new Date();
      let from: Date;
      let to: Date = now;

      switch (period) {
        case 'week':
          from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          from = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case 'year': {
          const y =
            year && /^\d{4}$/.test(year)
              ? parseInt(year, 10)
              : now.getFullYear();
          from = new Date(y, 0, 1);
          to = new Date(y + 1, 0, 1);
          break;
        }
        default:
          from = new Date(0);
      }

      where.start_date = Between(from, to);
    }

    const [data, total] = await this.activityRepository.findAndCount({
      where,
      order: { start_date: 'DESC' },
      take: limit,
      skip: (page - 1) * limit,
    });

    return { data, total, page, limit };
  }

  async findYears(): Promise<number[]> {
    const rows = await this.activityRepository.query(
      'SELECT DISTINCT EXTRACT(YEAR FROM start_date) AS year FROM activities WHERE start_date IS NOT NULL ORDER BY year DESC',
    );
    return rows.map((r: { year: string }) => Number(r.year));
  }

  async findOne(id: string | number) {
    const isUuid =
      typeof id === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      );

    if (isUuid) {
      return this.activityRepository.findOneBy({ id: id });
    }

    return this.activityRepository.findOneBy({ activityStravaId: Number(id) });
  }

  async upsert(createActivityDto: CreateActivityDto, user: User) {
    const existing = await this.activityRepository.findOneBy({
      activityStravaId: createActivityDto.activityStravaId,
    });

    if (existing) {
      existing.elapsed_time = createActivityDto.elapsed_time;
      existing.moving_time = createActivityDto.moving_time;
      existing.name = createActivityDto.name;
      existing.type = createActivityDto.type;
      existing.sport_type = createActivityDto.sport_type;
      existing.distance = createActivityDto.distance;
      existing.max_speed = createActivityDto.max_speed;
      existing.total_elevation_gain = createActivityDto.total_elevation_gain;
      existing.average_cadence = createActivityDto.average_cadence;
      existing.average_speed = createActivityDto.average_speed;
      existing.start_date = createActivityDto.startDate;
      existing.average_heartrate = createActivityDto.average_heartrate;
      existing.max_heartrate = createActivityDto.max_heartrate;
      existing.max_watts = createActivityDto.max_watts;

      return this.activityRepository.save(existing);
    }

    return this.create(createActivityDto, user, false);
  }
}
