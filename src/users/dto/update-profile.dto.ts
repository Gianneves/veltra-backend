import { IsBoolean, IsDateString, IsOptional } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsDateString()
  birthDate?: string | null;

  @IsOptional()
  @IsBoolean()
  healthConsent?: boolean;
}
