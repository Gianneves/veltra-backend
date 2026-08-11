import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateGoalDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsNumber()
  @IsNotEmpty()
  targetDistance!: number;

  @IsString()
  @IsNotEmpty()
  targetDate!: string;

  @IsString()
  @IsNotEmpty()
  discipline!: string;

  @IsNumber()
  @Min(1)
  threeKmTime!: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  longestRunDistance?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  longestRunTime?: number;

  @IsArray()
  @IsOptional()
  runDays?: string[];

  @IsString()
  @IsOptional()
  longRunDay?: string;

  @IsNumber()
  @IsOptional()
  daysPerWeek?: number;
}
