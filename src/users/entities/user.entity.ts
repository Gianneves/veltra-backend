import { IsEmail, IsNotEmpty, IsNumber, IsString } from 'class-validator';
import { Activity } from 'src/activities/entities/activity.entity';
import { BeforeInsert, Column, CreateDateColumn, Entity, OneToMany, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { v7 as uuidv7 } from "uuid";

@Entity('users')
export class User {
    @PrimaryColumn('uuid')
    id!: string;

    @Column({ unique: true })
    stravaId!: number;

    @IsString()
    @IsNotEmpty()
    @Column()
    name!: string;

    @IsString()
    @IsNotEmpty()
    @Column()
    accessToken!: string;

    @IsString()
    @Column()
    refreshToken!: string;

    @Column()
    expiresAt!: Date;

    @CreateDateColumn()
    createdAt?: Date;

    @UpdateDateColumn()
    updatedAt?: Date;

    @OneToMany(() => Activity, (activity) => activity.user)
    activities!: Activity[];

    @BeforeInsert()
    generateId() {
        this.id = uuidv7();
    }
}
