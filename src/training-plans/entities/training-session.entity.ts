import { BeforeInsert, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { TrainingPlan } from './training-plan.entity';
import { v7 as uuidv7 } from 'uuid';

@Entity('training_sessions')
export class TrainingSession {
    @PrimaryColumn('uuid')
    id!: string;

    @Column('uuid')
    planId!: string;

    @Column()
    day!: string;

    @Column()
    type!: string;

    @Column({ type: 'double precision' })
    plannedDistance!: number;

    @Column({ type: 'double precision' })
    plannedPace!: number;

    @Column({ nullable: true })
    notes?: string;

    @Column({ default: false })
    completed!: boolean;

    @ManyToOne(() => TrainingPlan, (plan) => plan.sessions, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'planId' })
    plan!: TrainingPlan;

    @BeforeInsert()
    generateId() {
        this.id = uuidv7();
    }
}
