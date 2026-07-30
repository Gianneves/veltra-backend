import { Controller, Get, Post, Put, Body, Param, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { GoalsService } from './goals.service';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';
import { RedisService } from 'src/redis/redis.service';

@Controller('goals')
export class GoalsController {
    constructor(
        private readonly goalsService: GoalsService,
        private readonly redisService: RedisService,
    ) {}

    private async getUserIdFromSession(req: Request): Promise<string> {
        const sessionId = req.cookies?.user_session;
        if (!sessionId) throw new UnauthorizedException('Não autenticado');
        const userId = await this.redisService.get(`app:session:${sessionId}`);
        if (!userId) throw new UnauthorizedException('Sessão inválida');
        return userId;
    }

    @Get()
    async findAll(@Req() req: Request) {
        const userId = await this.getUserIdFromSession(req);
        return this.goalsService.findAll(userId);
    }

    @Get(':id')
    async findOne(@Param('id') id: string, @Req() req: Request) {
        const userId = await this.getUserIdFromSession(req);
        return this.goalsService.findOne(id, userId);
    }

    @Post()
    async create(@Body() createGoalDto: CreateGoalDto, @Req() req: Request) {
        const userId = await this.getUserIdFromSession(req);
        return this.goalsService.create(createGoalDto, userId);
    }

    @Put(':id')
    async update(@Param('id') id: string, @Body() updateGoalDto: UpdateGoalDto, @Req() req: Request) {
        const userId = await this.getUserIdFromSession(req);
        return this.goalsService.update(id, userId, updateGoalDto);
    }
}
