import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { Activity } from 'src/activities/entities/activity.entity';
import { RedisModule } from 'src/redis/redis.module';

@Module({
    imports: [TypeOrmModule.forFeature([Activity]), RedisModule],
    controllers: [AnalyticsController],
    providers: [AnalyticsService],
})
export class AnalyticsModule {}
