import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ActivitiesService } from './activities.service';
import { CreateActivityDto } from './dto/create-activity.dto';
import { AuthSessionService } from 'src/auth/auth-session.service';
import type { User } from 'src/users/entities/user.entity';

@Controller('activities')
export class ActivitiesController {
  constructor(
    private readonly activitiesService: ActivitiesService,
    private readonly sessionService: AuthSessionService,
  ) {}

  @Post()
  async create(
    @Body() createActivityDto: CreateActivityDto,
    @Req() req: Request,
  ) {
    const userId = await this.sessionService.resolveUserId(req);
    return this.activitiesService.create(createActivityDto, {
      id: userId,
    } as User);
  }

  @Get()
  async findAll(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('period') period?: string,
    @Query('year') year?: string,
  ) {
    const userId = await this.sessionService.resolveUserId(req);
    return this.activitiesService.findAll(
      userId,
      page ? +page : 1,
      limit ? +limit : 20,
      period,
      year,
    );
  }

  @Get('years')
  async findYears(@Req() req: Request) {
    const userId = await this.sessionService.resolveUserId(req);
    return this.activitiesService.findYears(userId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: Request) {
    const userId = await this.sessionService.resolveUserId(req);
    const activity = await this.activitiesService.findOneForUser(id, userId);

    if (!activity) {
      throw new NotFoundException(`activity ${id} not found`);
    }

    return activity;
  }
}
