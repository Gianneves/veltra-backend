import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TrainingSession } from './training-session.entity';
import { v7 as uuidv7 } from 'uuid';

@Entity('training_plans')
export class TrainingPlan {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('uuid')
  userId!: string;

  @Column()
  weekStart!: string;

  @Column('uuid', { nullable: true })
  goalId?: string;

  @Column({ nullable: true })
  focus?: string;

  @Column({ type: 'text', nullable: true })
  coachNotes?: string;

  @Column({ type: 'double precision', nullable: true })
  plannedWeeklyKm?: number | null;

  @Column({ default: false })
  volumeAdjusted?: boolean;

  @Column({ type: 'varchar', nullable: true })
  volumeAdjustedReason?: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  volumeAdjustedAt?: Date | null;

  @OneToMany(() => TrainingSession, (session) => session.plan, {
    cascade: true,
  })
  sessions!: TrainingSession[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt?: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt?: Date;

  @BeforeInsert()
  generateId() {
    this.id = uuidv7();
  }
}
