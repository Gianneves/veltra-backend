import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GoalsService } from './goals.service';
import { GoalsController } from './goals.controller';
import { Goal } from './entities/goal.entity';
import { Milestone } from './entities/milestone.entity';
import { AuthModule } from 'src/auth/auth.module';
import { TrainingPlansModule } from 'src/training-plans/training-plans.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Goal, Milestone]),
    AuthModule,
    TrainingPlansModule,
  ],
  controllers: [GoalsController],
  providers: [GoalsService],
  exports: [GoalsService],
})
export class GoalsModule {}
