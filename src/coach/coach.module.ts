import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoachService } from './coach.service';
import { CoachController } from './coach.controller';
import { CoachConversation } from './entities/coach-conversation.entity';
import { CoachMessage } from './entities/coach-message.entity';
import { Activity } from 'src/activities/entities/activity.entity';
import { Goal } from 'src/goals/entities/goal.entity';
import { AthleteProfileService } from 'src/training-plans/athlete-profile.service';
import { TrainingPlan } from 'src/training-plans/entities/training-plan.entity';
import { TrainingSession } from 'src/training-plans/entities/training-session.entity';
import { User } from 'src/users/entities/user.entity';
import { AiModule } from 'src/ai/ai.module';
import { AuthModule } from 'src/auth/auth.module';
import { HealthModule } from 'src/health/health.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CoachConversation,
      CoachMessage,
      Goal,
      TrainingPlan,
      TrainingSession,
      Activity,
      User,
    ]),
    AiModule,
    AuthModule,
    HealthModule,
  ],
  controllers: [CoachController],
  providers: [CoachService, AthleteProfileService],
  exports: [CoachService],
})
export class CoachModule {}
