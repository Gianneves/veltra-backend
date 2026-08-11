import {
  IsDate,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateActivityDto {
  @IsNumber()
  @IsNotEmpty()
  activityStravaId!: number;

  @IsNumber()
  @IsNotEmpty()
  elapsed_time!: number;

  @IsNumber()
  @IsNotEmpty()
  moving_time!: number;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsString()
  @IsNotEmpty()
  sport_type!: string;

  @IsNumber()
  @IsNotEmpty()
  distance!: number;

  @IsNumber()
  max_speed?: number;

  @IsNumber()
  total_elevation_gain?: number;

  @IsNumber()
  average_cadence?: number;

  @IsNumber()
  average_speed?: number;

  @IsDate()
  @IsOptional()
  startDate?: Date;

  @IsNumber()
  average_heartrate?: number;

  @IsNumber()
  max_heartrate?: number;

  @IsNumber()
  max_watts?: number;
}
