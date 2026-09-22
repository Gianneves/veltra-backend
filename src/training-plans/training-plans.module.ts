import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrainingPlansService } from './training-plans.service';
import { TrainingPlansController } from './training-plans.controller';
import { TrainingPlan } from './entities/training-plan.entity';
import { TrainingSession } from './entities/training-session.entity';
import { AthleteProfileService } from './athlete-profile.service';
import { ActivityMatcherService } from './activity-matcher.service';
import { VolumeAdjustmentService } from './volume-adjustment.service';
import { AuthModule } from 'src/auth/auth.module';
import { AiModule } from 'src/ai/ai.module';
import { Activity } from 'src/activities/entities/activity.entity';
import { Goal } from 'src/goals/entities/goal.entity';
import { User } from 'src/users/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TrainingPlan,
      TrainingSession,
      Activity,
      Goal,
      User,
    ]),
    AuthModule,
    AiModule,
  ],
  controllers: [TrainingPlansController],
  providers: [
    TrainingPlansService,
    AthleteProfileService,
    ActivityMatcherService,
    VolumeAdjustmentService,
  ],
  exports: [TrainingPlansService, ActivityMatcherService],
})
export class TrainingPlansModule {}
