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

  @OneToMany(() => TrainingSession, (session) => session.plan, {
    cascade: true,
  })
  sessions!: TrainingSession[];

  @CreateDateColumn()
  createdAt?: Date;

  @UpdateDateColumn()
  updatedAt?: Date;

  @BeforeInsert()
  generateId() {
    this.id = uuidv7();
  }
}
