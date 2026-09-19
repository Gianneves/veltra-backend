import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthSessionService } from 'src/auth/auth-session.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly sessionService: AuthSessionService,
  ) {}

  @Get('me')
  async getMe(@Req() req: Request) {
    const userId = await this.sessionService.resolveUserId(req);
    return this.usersService.getProfile(userId);
  }

  @Patch('me')
  async updateMe(@Req() req: Request, @Body() dto: UpdateProfileDto) {
    const userId = await this.sessionService.resolveUserId(req);
    return this.usersService.updateProfile(userId, dto);
  }
}
