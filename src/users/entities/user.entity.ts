import { IsEmail, IsNotEmpty, IsNumber, IsString } from 'class-validator';
import { BeforeInsert, Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";
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

    @BeforeInsert()
    generateId() {
        this.id = uuidv7();
    }
}
