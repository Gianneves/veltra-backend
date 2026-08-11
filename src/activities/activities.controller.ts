import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { CreateActivityDto } from './dto/create-activity.dto';

@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Post()
  create(@Body() createActivityDto: CreateActivityDto) {
    return this.activitiesService.create(createActivityDto);
  }

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('period') period?: string,
    @Query('year') year?: string,
  ) {
    return this.activitiesService.findAll(
      page ? +page : 1,
      limit ? +limit : 20,
      period,
      year,
    );
  }

  @Get('years')
  findYears() {
    return this.activitiesService.findYears();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.activitiesService.findOne(id);
  }
}
