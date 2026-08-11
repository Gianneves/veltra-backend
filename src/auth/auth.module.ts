import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthSessionService } from './auth-session.service';
import { StravaModule } from 'src/strava/strava.module';
import { RedisModule } from 'src/redis/redis.module';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [
    StravaModule,
    RedisModule,
    UsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('SECRET_KEY_JWT') ?? 'insecure-dev-secret',
      }),
    }),
  ],
  providers: [AuthService, AuthSessionService],
  controllers: [AuthController],
  exports: [AuthSessionService],
})
export class AuthModule {}
