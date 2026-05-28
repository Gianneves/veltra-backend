import { IsNotEmpty, IsNumber, IsString } from "class-validator";

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
    @IsNotEmpty()
    max_speed!: number;

    @IsNumber()
    @IsNotEmpty()
    total_elevation_gain!: number;

    @IsNumber()
    @IsNotEmpty()
    average_cadence!: number;

    @IsNumber()
    @IsNotEmpty()
    average_speed!: number;

    @IsNumber()
    average_heartrate?: number;

    @IsNumber()
    max_heartrate?: number;

    @IsNumber()
    max_watts?: number;
}
