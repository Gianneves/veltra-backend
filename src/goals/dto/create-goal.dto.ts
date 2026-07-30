import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

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
}
