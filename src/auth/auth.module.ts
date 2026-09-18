import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { SessionModule } from './session.module';
import { StravaModule } from 'src/strava/strava.module';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [StravaModule, UsersModule, SessionModule],
  providers: [AuthService],
  controllers: [AuthController],
  exports: [SessionModule],
})
export class AuthModule {}
