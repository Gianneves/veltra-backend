import { Module } from '@nestjs/common';
import { ActivitiesModule } from 'src/activities/activities.module';
import { AuthModule } from 'src/auth/auth.module';
import { RedisModule } from 'src/redis/redis.module';
import { StravaModule } from 'src/strava/strava.module';
import { TrainingPlansModule } from 'src/training-plans/training-plans.module';
import { UsersModule } from 'src/users/users.module';
import { StravaSubscriptionController } from './strava-subscription.controller';
import { StravaSyncController } from './strava-sync.controller';
import { StravaTokenService } from './strava-token.service';
import { StravaWebhookController } from './strava-webhook.controller';
import { StravaWebhookService } from './strava-webhook.service';

@Module({
  imports: [
    RedisModule,
    StravaModule,
    UsersModule,
    ActivitiesModule,
    TrainingPlansModule,
    AuthModule,
  ],
  controllers: [
    StravaWebhookController,
    StravaSubscriptionController,
    StravaSyncController,
  ],
  providers: [StravaWebhookService, StravaTokenService],
})
export class StravaWebhookModule {}
