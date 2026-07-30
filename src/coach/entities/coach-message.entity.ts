import { BeforeInsert, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { CoachConversation } from './coach-conversation.entity';
import { v7 as uuidv7 } from 'uuid';

@Entity('coach_messages')
export class CoachMessage {
    @PrimaryColumn('uuid')
    id!: string;

    @Column('uuid')
    conversationId!: string;

    @Column()
    role!: string;

    @Column({ type: 'text' })
    content!: string;

    @ManyToOne(() => CoachConversation, (conv) => conv.messages, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'conversationId' })
    conversation!: CoachConversation;

    @CreateDateColumn()
    createdAt?: Date;

    @BeforeInsert()
    generateId() {
        this.id = uuidv7();
    }
}
