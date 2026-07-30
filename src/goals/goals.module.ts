import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GoalsService } from './goals.service';
import { GoalsController } from './goals.controller';
import { Goal } from './entities/goal.entity';
import { Milestone } from './entities/milestone.entity';
import { RedisModule } from 'src/redis/redis.module';

@Module({
    imports: [TypeOrmModule.forFeature([Goal, Milestone]), RedisModule],
    controllers: [GoalsController],
    providers: [GoalsService],
    exports: [GoalsService],
})
export class GoalsModule {}
