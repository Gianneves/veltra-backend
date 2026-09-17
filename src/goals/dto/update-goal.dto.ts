import { PartialType } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString } from 'class-validator';
import { CreateGoalDto } from './create-goal.dto';

export class UpdateGoalDto extends PartialType(CreateGoalDto) {
  @IsOptional()
  @IsNumber()
  currentProgress?: number;

  @IsOptional()
  @IsString()
  status?: 'pending_benchmark' | 'active' | 'completed';
}
