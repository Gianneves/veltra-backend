import { Module } from '@nestjs/common';
import { InsightsService } from './insights.service';
import { InsightsController } from './insights.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Insight } from './entities/insight.entity';
import { Activity } from 'src/activities/entities/activity.entity';
import { AiModule } from 'src/ai/ai.module';

@Module({
  imports: [TypeOrmModule.forFeature([Insight, Activity]), AiModule],
  providers: [InsightsService],
  controllers: [InsightsController],
  exports: [InsightsService]
})
export class InsightsModule {}
