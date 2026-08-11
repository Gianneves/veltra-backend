import { IsNotEmpty, IsNumber, IsString } from 'class-validator';
import { Insight } from 'src/insights/entities/insight.entity';
import { User } from 'src/users/entities/user.entity';
import {
  BeforeInsert,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

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
  @Column({ type: 'double precision' })
  distance!: number;

  @IsNumber()
  @Column({ type: 'double precision', nullable: true })
  max_speed?: number;

  @IsNumber()
  @Column({ type: 'double precision', nullable: true })
  total_elevation_gain?: number;

  @IsNumber()
  @Column({ type: 'double precision', nullable: true })
  average_cadence?: number;

  @IsNumber()
  @Column({ type: 'double precision', nullable: true })
  average_speed?: number;

  @Column({ type: 'timestamp with time zone', nullable: true })
  start_date?: Date;

  @IsNumber()
  @Column({ nullable: true })
  average_heartrate?: number;

  @IsNumber()
  @Column({ nullable: true })
  max_heartrate?: number;

  @IsNumber()
  @Column({ nullable: true })
  max_watts?: number;

  @Column({ type: 'vector', length: 1563, nullable: true })
  embedding?: string;

  @ManyToOne(() => User, (user) => user.activities, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
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
