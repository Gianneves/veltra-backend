import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
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
      where: { stravaId: createUserDto.stravaId },
    });

    const expiresDate = new Date(createUserDto.expiresAt * 1000);
    const isNewUser = !user;

    if (user) {
      user.name = createUserDto.name;
      user.accessToken = createUserDto.accessToken;
      user.refreshToken = createUserDto.refreshToken;
      user.expiresAt = expiresDate;
      if (createUserDto.avatarUrl) {
        user.avatarUrl = createUserDto.avatarUrl;
      }
    } else {
      user = this.userRepository.create({
        name: createUserDto.name,
        stravaId: createUserDto.stravaId,
        avatarUrl: createUserDto.avatarUrl,
        accessToken: createUserDto.accessToken,
        refreshToken: createUserDto.refreshToken,
        expiresAt: expiresDate,
      });

      user = await this.userRepository.save(user);
    }

    const activities = await this.stravaService.fetchAllActivities(
      user.accessToken,
    );

    for (const act of activities) {
      const createActivityDto: CreateActivityDto = {
        activityStravaId: act.id,
        elapsed_time: act.elapsed_time,
        moving_time: act.moving_time,
        name: act.name,
        type: act.type,
        sport_type: act.sport_type,
        distance: act.distance,
        max_speed: act.max_speed ?? undefined,
        total_elevation_gain: act.total_elevation_gain ?? undefined,
        average_cadence: act.average_cadence ?? undefined,
        average_speed: act.average_speed ?? undefined,
        startDate: act.start_date ?? undefined,
        average_heartrate: act.average_heartrate ?? undefined,
        max_heartrate: act.max_heartrate ?? undefined,
        max_watts: act.max_watts ?? undefined,
      };

      await this.activityService.upsert(createActivityDto, user);
    }

    if (isNewUser) {
      return user;
    }

    return await this.userRepository.save(user);
  }

  findAll() {
    return `This action returns all users`;
  }

  async findById(id: string) {
    return this.userRepository.findOne({
      where: { id },
      select: [
        'id',
        'name',
        'avatarUrl',
        'stravaId',
        'birthDate',
        'createdAt',
        'updatedAt',
      ],
    });
  }

  async getProfile(id: string) {
    const user = await this.userRepository.findOne({
      where: { id },
      select: [
        'id',
        'name',
        'avatarUrl',
        'stravaId',
        'birthDate',
        'healthConsentAt',
        'createdAt',
        'updatedAt',
      ],
    });

    if (!user) throw new BadRequestException('Usuário não encontrado');

    return {
      id: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl ?? null,
      stravaId: user.stravaId,
      birthDate: user.birthDate ?? null,
      healthConsent: !!user.healthConsentAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async updateProfile(id: string, dto: UpdateProfileDto) {
    const patch: Partial<User> = {};

    if (dto.birthDate !== undefined) {
      if (dto.birthDate === null || dto.birthDate === '') {
        patch.birthDate = null;
      } else {
        const value = dto.birthDate.slice(0, 10);
        const parsed = new Date(`${value}T12:00:00`);

        if (Number.isNaN(parsed.getTime()) || parsed.getFullYear() < 1900) {
          throw new BadRequestException('Data de nascimento inválida');
        }

        if (parsed.getTime() > Date.now()) {
          throw new BadRequestException(
            'Data de nascimento não pode estar no futuro',
          );
        }

        patch.birthDate = value;
      }
    }

    if (dto.healthConsent !== undefined) {
      patch.healthConsentAt = dto.healthConsent ? new Date() : null;
    }

    if (Object.keys(patch).length > 0) {
      await this.userRepository.update(id, patch);
    }

    return this.getProfile(id);
  }

  async findByStravaId(stravaId: number) {
    return this.userRepository.findOne({ where: { stravaId } });
  }

  async findFullById(id: string) {
    return this.userRepository.findOne({ where: { id } });
  }

  async updateStravaTokens(
    userId: string,
    tokens: { accessToken: string; refreshToken: string; expiresAt: number },
  ) {
    await this.userRepository.update(userId, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: new Date(tokens.expiresAt * 1000),
    });
  }

  async updateAvatar(userId: string, avatarUrl: string) {
    await this.userRepository.update(userId, { avatarUrl });
  }

  async clearStravaTokens(userId: string) {
    await this.userRepository.update(userId, {
      accessToken: '',
      refreshToken: '',
      expiresAt: new Date(0),
    });
  }

  update(id: number, updateUserDto: UpdateUserDto) {
    return `This action updates a #${id} user`;
  }

  remove(id: number) {
    return `This action removes a #${id} user`;
  }
}
