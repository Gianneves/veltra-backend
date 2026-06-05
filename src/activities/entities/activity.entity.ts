import { IsNotEmpty, IsNumber, IsString } from "class-validator";
import { Insight } from "src/insights/entities/insight.entity";
import { User } from "src/users/entities/user.entity";
import { BeforeInsert, Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from "typeorm";
import { v7 as uuidv7 } from "uuid";

@Entity('activities')
export class Activity {
    @PrimaryColumn('uuid')
    id!: string;

    @IsNumber()
    @IsNotEmpty()
    @Column({ type: 'bigint', unique: true })
    activityStravaId!: number;

    @IsNumber()
    @Column()
    elapsed_time!: number;

    @IsNumber()
    @Column()
    moving_time!: number;

    @IsString()
    @Column()
    name!: string;

    @IsString()
    @Column()
    type!: string;

    @IsString()
    @Column()
    sport_type!: string;

    @IsNumber()
    @Column()
    distance!: number;

    @IsNumber()
    @Column()
    max_speed!: number;

    @IsNumber()
    @Column()
    total_elevation_gain!: number;

    @IsNumber()
    @Column()
    average_cadence!: number;

    @IsNumber()
    @Column()
    average_speed!: number;

    @IsNumber()
    @Column()
    average_heartrate!: number;

    @IsNumber()
    @Column()
    max_heartrate!: number;

    @IsNumber()
    @Column()
    max_watts!: number;

    @Column({ type: 'vector', length: 1563, nullable: true })
    embedding?: string;

    @ManyToOne(() => User, (user) => user.activities, {
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    })
    @JoinColumn({ name: 'userId' })
    user!: User;

    @OneToMany(() => Insight, (insight) => insight.activity)
    insights!: Insight[];

    @BeforeInsert()
    generateId() {
        this.id = uuidv7();
    }
}
