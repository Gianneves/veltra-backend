import { Module } from '@nestjs/common';
import { InsightsService } from './insights.service';
import { InsightsController } from './insights.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Insight } from './entities/insight.entity';
import { Activity } from 'src/activities/entities/activity.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Insight, Activity])],
  providers: [InsightsService],
  controllers: [InsightsController],
  exports: [InsightsService]
})
export class InsightsModule {}
