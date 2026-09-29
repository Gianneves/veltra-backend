import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CoachMessage } from './coach-message.entity';
import { v7 as uuidv7 } from 'uuid';

@Entity('coach_conversations')
export class CoachConversation {
  @PrimaryColumn('uuid')
  id!: string;

  @Column('uuid')
  userId!: string;

  @Column({ nullable: true })
  title?: string;

  @OneToMany(() => CoachMessage, (msg) => msg.conversation, { cascade: true })
  messages!: CoachMessage[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt?: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt?: Date;

  @BeforeInsert()
  generateId() {
    this.id = uuidv7();
  }
}
