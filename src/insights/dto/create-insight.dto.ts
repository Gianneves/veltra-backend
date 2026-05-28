import { IsNotEmpty, IsString } from "class-validator";

export class CreateInsightDto {
    @IsString()
    @IsNotEmpty()
    activityId!: string;

    @IsString()
    @IsNotEmpty()
    content!: string;
}