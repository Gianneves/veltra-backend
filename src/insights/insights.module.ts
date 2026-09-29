import { Module } from '@nestjs/common';
import { InsightsService } from './insights.service';
import { InsightsController } from './insights.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Insight } from './entities/insight.entity';
import { Activity } from 'src/activities/entities/activity.entity';
import { Goal } from 'src/goals/entities/goal.entity';
import { TrainingSession } from 'src/training-plans/entities/training-session.entity';
import { AthleteProfileService } from 'src/training-plans/athlete-profile.service';
import { User } from 'src/users/entities/user.entity';
import { AiModule } from 'src/ai/ai.module';
import { SessionModule } from 'src/auth/session.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Insight, Activity, TrainingSession, Goal, User]),
    AiModule,
    SessionModule,
  ],
  providers: [InsightsService, AthleteProfileService],
  controllers: [InsightsController],
  exports: [InsightsService],
})
export class InsightsModule {}
