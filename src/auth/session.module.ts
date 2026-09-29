import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { RedisModule } from 'src/redis/redis.module';
import { AuthSessionService } from './auth-session.service';

@Module({
  imports: [
    RedisModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('SECRET_KEY_JWT') ?? 'insecure-dev-secret',
      }),
    }),
  ],
  providers: [AuthSessionService],
  exports: [AuthSessionService, JwtModule, RedisModule],
})
export class SessionModule {}
