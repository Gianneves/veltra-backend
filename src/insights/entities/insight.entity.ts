import { Activity } from "src/activities/entities/activity.entity";
import { BeforeInsert, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { v7 as uuidv7 } from "uuid";

@Entity('insights')
export class Insight {
    @PrimaryColumn('uuid')
    id!: string;

    @Column('uuid')
    activityId!: string;

    @Column('text')
    content!: string;

    @Column({ default: 'pending' })
    status!: string;

    @CreateDateColumn()
    createdAt?: Date;

    @ManyToOne(() => Activity, (activity) => activity.insights, {
        onDelete: 'CASCADE'
    })
    @JoinColumn({ name: 'activityId' })
    activity!: Activity;

    @BeforeInsert()
    generateId() {
        this.id = uuidv7();
    }
}