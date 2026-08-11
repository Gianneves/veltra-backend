import { Controller, Get, Post, Put, Body, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { GoalsService } from './goals.service';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';
import { AuthSessionService } from 'src/auth/auth-session.service';

@Controller('goals')
export class GoalsController {
  constructor(
    private readonly goalsService: GoalsService,
    private readonly sessionService: AuthSessionService,
  ) {}

  @Get()
  async findAll(@Req() req: Request) {
    const userId = await this.sessionService.resolveUserId(req);
    return this.goalsService.findAll(userId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: Request) {
    const userId = await this.sessionService.resolveUserId(req);
    return this.goalsService.findOne(id, userId);
  }

  @Post()
  async create(@Body() createGoalDto: CreateGoalDto, @Req() req: Request) {
    const userId = await this.sessionService.resolveUserId(req);
    return this.goalsService.create(createGoalDto, userId);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateGoalDto: UpdateGoalDto,
    @Req() req: Request,
  ) {
    const userId = await this.sessionService.resolveUserId(req);
    return this.goalsService.update(id, userId, updateGoalDto);
  }
}
