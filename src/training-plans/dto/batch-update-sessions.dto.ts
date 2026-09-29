import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  TRAINING_SESSION_DAYS,
  TRAINING_SESSION_TYPES,
} from './update-training-session.dto';

export class BatchSessionItemDto {
  @IsUUID()
  sessionId!: string;

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

  @IsOptional()
  @IsBoolean()
  acknowledgeAgePolicy?: boolean;
}

export class BatchUpdateSessionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => BatchSessionItemDto)
  items!: BatchSessionItemDto[];
}
