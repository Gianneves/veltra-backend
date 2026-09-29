import {
  BeforeInsert,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { TrainingPlan } from './training-plan.entity';
import { Activity } from 'src/activities/entities/activity.entity';
import { v7 as uuidv7 } from 'uuid';

@Entity('training_sessions')
export class TrainingSession {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('uuid')
  planId!: string;

  @Column()
  day!: string;

  @Column('int', { default: 0 })
  dayOrder!: number;

  @Column()
  type!: string;

  @Column({ type: 'double precision' })
  plannedDistance!: number;

  @Column({ type: 'double precision' })
  plannedPace!: number;

  @Column({ nullable: true })
  notes?: string;

  @Column({ default: false })
  adjusted?: boolean;

  @Column({ type: 'varchar', nullable: true })
  adjustmentNote?: string | null;

  @Column({ default: false })
  completed!: boolean;

  @Column('uuid', { nullable: true })
  activityId?: string | null;

  @Column({ type: 'double precision', nullable: true })
  actualDistance?: number | null;

  @Column({ type: 'double precision', nullable: true })
  actualPace?: number | null;

  @Column({ type: 'int', nullable: true })
  actualMovingTime?: number | null;

  @Column({ type: 'double precision', nullable: true })
  matchScore?: number | null;

  @Column({ type: 'varchar', nullable: true })
  matchMethod?: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  matchedAt?: Date | null;

  @ManyToOne(() => Activity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'activityId' })
  activity?: Activity | null;

  @ManyToOne(() => TrainingPlan, (plan) => plan.sessions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'planId' })
  plan!: TrainingPlan;

  @BeforeInsert()
  generateId() {
    this.id = uuidv7();
  }
}
