import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Milestone } from './milestone.entity';
import { v7 as uuidv7 } from 'uuid';

@Entity('goals')
export class Goal {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('uuid')
  userId!: string;

  @Column()
  title!: string;

  @Column({ type: 'double precision' })
  targetDistance!: number;

  @Column()
  targetDate!: string;

  @Column()
  discipline!: string;

  @Column({ type: 'double precision', default: 0 })
  currentProgress!: number;

  @Column({ default: 'active' })
  status!: string;

  @Column('simple-json', { nullable: true })
  runDays?: string[];

  @Column({ nullable: true })
  longRunDay?: string;

  @Column({ default: 3 })
  daysPerWeek!: number;

  @Column('int', { default: 0 })
  threeKmTime!: number;

  @Column({ type: 'double precision', nullable: true })
  longestRunDistance?: number;

  @Column({ type: 'int', nullable: true })
  longestRunTime?: number;

  @OneToMany(() => Milestone, (milestone) => milestone.goal, { cascade: true })
  milestones!: Milestone[];

  @CreateDateColumn()
  createdAt?: Date;

  @UpdateDateColumn()
  updatedAt?: Date;

  @BeforeInsert()
  generateId() {
    this.id = uuidv7();
  }
}
