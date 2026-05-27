import { Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Repository } from 'typeorm';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>
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
