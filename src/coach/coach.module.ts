import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoachService } from './coach.service';
import { CoachController } from './coach.controller';
import { CoachConversation } from './entities/coach-conversation.entity';
import { CoachMessage } from './entities/coach-message.entity';
import { Goal } from 'src/goals/entities/goal.entity';
import { TrainingPlan } from 'src/training-plans/entities/training-plan.entity';
import { AiModule } from 'src/ai/ai.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CoachConversation,
      CoachMessage,
      Goal,
      TrainingPlan,
    ]),
    AiModule,
    AuthModule,
  ],
  controllers: [CoachController],
  providers: [CoachService],
  exports: [CoachService],
})
export class CoachModule {}
