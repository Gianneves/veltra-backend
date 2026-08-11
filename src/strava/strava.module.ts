import { Module } from '@nestjs/common';
import { StravaService } from './strava.service';

@Module({
  providers: [StravaService],
  exports: [StravaService],
})
export class StravaModule {}
