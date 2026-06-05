import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Activity } from 'src/activities/entities/activity.entity';
import { StravaModule } from 'src/strava/strava.module';
import { ActivitiesModule } from 'src/activities/activities.module';

@Module({
  imports: [TypeOrmModule.forFeature([User, Activity]), StravaModule, ActivitiesModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService]
})
export class UsersModule {}
