import { Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Repository } from 'typeorm';
import { StravaService } from 'src/strava/strava.service';
import { ActivitiesService } from 'src/activities/activities.service';
import { CreateActivityDto } from 'src/activities/dto/create-activity.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly stravaService: StravaService,
    private readonly activityService: ActivitiesService,
  ) {}

  async createOrUpdate(createUserDto: CreateUserDto) {
    if (!createUserDto) {
      throw new Error('Invalid data!');
    }

    let user = await this.userRepository.findOne({
      where: { stravaId: createUserDto.stravaId }
    });

    if (user) {
      user.name = createUserDto.name;
      user.refreshToken = createUserDto.refreshToken;
    } else {

      const expiresDate = new Date(createUserDto.expiresAt * 1000);

      user = this.userRepository.create({
          name: createUserDto.name,
          stravaId: createUserDto.stravaId,
          accessToken: createUserDto.accessToken,
          refreshToken: createUserDto.refreshToken,
          expiresAt: expiresDate
        });

      user = await this.userRepository.save(user);

      const activities = await this.stravaService.fetchAllActivities(user.accessToken);

      if (activities.length > 0) {
        for (const act of activities) {
          const createActivityDto: CreateActivityDto = {
            activityStravaId: act.id,
            elapsed_time: act.elapsed_time,
            moving_time: act.moving_time,
            name: act.name,
            type: act.type,
            sport_type: act.sport_type,
            distance: act.distance,
            max_speed: act.max_speed,
            total_elevation_gain: act.total_elevation_gain,
            average_cadence: act.average_cadence,
            average_speed: act.average_speed,
            average_heartrate: act.average_heartrate ?? undefined,
            max_heartrate: act.max_heartrate ?? undefined,
            max_watts: act.max_watts ?? undefined,
          };

          await this.activityService.create(createActivityDto, user);
        }
      }
    }

    return await this.userRepository.save(user);
  }

  findAll() {
    return `This action returns all users`;
  }

  findOne(id: number) {
    return `This action returns a #${id} user`;
  }

  update(id: number, updateUserDto: UpdateUserDto) {
    return `This action updates a #${id} user`;
  }

  remove(id: number) {
    return `This action removes a #${id} user`;
  }
}
