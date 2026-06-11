import { Injectable } from '@nestjs/common';
import { CreateActivityDto } from './dto/create-activity.dto';
import { Repository } from 'typeorm';
import { Activity } from './entities/activity.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';

@Injectable()
export class ActivitiesService {
  constructor(
    @InjectRepository(Activity)
    private readonly activityRepository: Repository<Activity>
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

    return await this.activityRepository.save(activity);
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
