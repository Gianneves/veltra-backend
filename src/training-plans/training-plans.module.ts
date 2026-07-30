import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrainingPlansService } from './training-plans.service';
import { TrainingPlansController } from './training-plans.controller';
import { TrainingPlan } from './entities/training-plan.entity';
import { TrainingSession } from './entities/training-session.entity';
import { RedisModule } from 'src/redis/redis.module';

@Module({
    imports: [TypeOrmModule.forFeature([TrainingPlan, TrainingSession]), RedisModule],
    controllers: [TrainingPlansController],
    providers: [TrainingPlansService],
    exports: [TrainingPlansService],
})
export class TrainingPlansModule {}
