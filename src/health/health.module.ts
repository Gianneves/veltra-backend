import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Activity } from 'src/activities/entities/activity.entity';
import { SessionModule } from 'src/auth/session.module';
import { User } from 'src/users/entities/user.entity';
import { HealthAlertsService } from './health-alerts.service';
import { HealthController } from './health.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User, Activity]), SessionModule],
  controllers: [HealthController],
  providers: [HealthAlertsService],
  exports: [HealthAlertsService],
})
export class HealthModule {}
