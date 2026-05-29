import { Injectable } from '@nestjs/common';
import { CreateActivityDto } from './dto/create-activity.dto';
import { Repository } from 'typeorm';
import { Activity } from './entities/activity.entity';
import { InjectRepository } from '@nestjs/typeorm';



@Injectable()
export class ActivitiesService {
  constructor(
    @InjectRepository(Activity)
    private readonly activityRepository: Repository<Activity>
  ) {}
  async create(createActivityDto: CreateActivityDto) {
    try {

      const activityExist = await this.findOne(createActivityDto.activityStravaId);

      if (activityExist) {
        throw new Error('Atividade já registrada.')
      }

      const activity = this.activityRepository.create(createActivityDto);

      await this.activityRepository.save(activity);
      
    } catch (error: unknown) {
      console.error('Falha com a conexão: ', error);
    }
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

      if (!activity) {
        throw new Error('Atividade não encontrada');
      }

      return activity;
  }

}
