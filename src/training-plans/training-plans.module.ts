import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrainingPlansService } from './training-plans.service';
import { TrainingPlansController } from './training-plans.controller';
import { TrainingPlan } from './entities/training-plan.entity';
import { TrainingSession } from './entities/training-session.entity';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TrainingPlan, TrainingSession]),
    AuthModule,
  ],
  controllers: [TrainingPlansController],
  providers: [TrainingPlansService],
  exports: [TrainingPlansService],
})
export class TrainingPlansModule {}
