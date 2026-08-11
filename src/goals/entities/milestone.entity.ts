import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Goal } from './goal.entity';
import { v7 as uuidv7 } from 'uuid';

@Entity('milestones')
export class Milestone {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('uuid')
  goalId!: string;

  @Column()
  description!: string;

  @Column({ type: 'double precision' })
  target!: number;

  @Column({ default: false })
  achieved!: boolean;

  @ManyToOne(() => Goal, (goal) => goal.milestones, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'goalId' })
  goal!: Goal;

  @CreateDateColumn()
  createdAt?: Date;

  @BeforeInsert()
  generateId() {
    this.id = uuidv7();
  }
}
