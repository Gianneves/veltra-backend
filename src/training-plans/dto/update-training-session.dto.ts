import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const TRAINING_SESSION_TYPES = [
  'easy',
  'interval',
  'tempo',
  'fartlek',
  'long_run',
  'rest',
  'recovery',
  'race',
];

export const TRAINING_SESSION_DAYS = [
  'Dom',
  'Seg',
  'Ter',
  'Qua',
  'Qui',
  'Sex',
  'Sáb',
];

export class UpdateTrainingSessionDto {
  @IsOptional()
  @IsIn(TRAINING_SESSION_TYPES)
  type?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  plannedDistance?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(900)
  plannedPace?: number;

  @IsOptional()
  @IsIn(TRAINING_SESSION_DAYS)
  day?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
