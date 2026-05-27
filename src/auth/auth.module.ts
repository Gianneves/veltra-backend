import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { StravaModule } from 'src/strava/strava.module';
import { RedisModule } from 'src/redis/redis.module';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [
    StravaModule,
    RedisModule,
    UsersModule
  ],
  providers: [AuthService],
  controllers: [AuthController]
})
export class AuthModule {}
