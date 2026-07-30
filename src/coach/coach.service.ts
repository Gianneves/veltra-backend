import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CoachConversation } from './entities/coach-conversation.entity';
import { CoachMessage } from './entities/coach-message.entity';
import { AiService } from 'src/ai/ai.service';

@Injectable()
export class CoachService {
    constructor(
        @InjectRepository(CoachConversation)
        private readonly conversationRepository: Repository<CoachConversation>,
        @InjectRepository(CoachMessage)
        private readonly messageRepository: Repository<CoachMessage>,
        private readonly aiService: AiService,
    ) {}

    async getOrCreateConversation(userId: string, conversationId?: string) {
        if (conversationId) {
            const conv = await this.conversationRepository.findOne({
                where: { id: conversationId, userId },
                relations: ['messages'],
                order: { messages: { createdAt: 'ASC' } as any },
            });
            if (conv) return conv;
        }

        const conv = this.conversationRepository.create({ userId, title: 'Nova conversa' });
        return this.conversationRepository.save(conv);
    }

    async getConversations(userId: string) {
        return this.conversationRepository.find({
            where: { userId },
            order: { updatedAt: 'DESC' },
        });
    }

    async getMessages(conversationId: string, userId: string) {
        const conv = await this.conversationRepository.findOne({
            where: { id: conversationId, userId },
        });
        if (!conv) return [];

        return this.messageRepository.find({
            where: { conversationId },
            order: { createdAt: 'ASC' },
        });
    }

    async sendMessage(userId: string, content: string, conversationId?: string) {
        const conv = await this.getOrCreateConversation(userId, conversationId);

        const userMsg = this.messageRepository.create({
            conversationId: conv.id,
            role: 'user',
            content,
        });
        await this.messageRepository.save(userMsg);

        const recentMessages = await this.messageRepository.find({
            where: { conversationId: conv.id },
            order: { createdAt: 'DESC' },
            take: 20,
        });

        const history = recentMessages.reverse().map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
        }));

        const systemPrompt = `Você é o Veltra Coach, um treinador de corrida experiente e motivador. 
Sua personalidade é técnica, precisa e encorajadora. 
Você analisa dados de corrida e oferece conselhos personalizados.
Responda em português brasileiro de forma clara e direta.`;

        const promptParts = [systemPrompt];
        for (const msg of history) {
            const prefix = msg.role === 'user' ? 'Usuário' : 'Coach';
            promptParts.push(`${prefix}: ${msg.content}`);
        }
        promptParts.push(`Usuário: ${content}`);
        promptParts.push('Coach:');

        const reply = await this.aiService.generateInsight(promptParts.join('\n'));

        const coachMsg = this.messageRepository.create({
            conversationId: conv.id,
            role: 'assistant',
            content: reply,
        });
        await this.messageRepository.save(coachMsg);

        if (conv.title === 'Nova conversa') {
            conv.title = content.length > 50 ? content.slice(0, 50) + '...' : content;
            await this.conversationRepository.save(conv);
        }

        return {
            id: coachMsg.id,
            role: 'coach',
            content: reply,
            timestamp: coachMsg.createdAt?.toISOString(),
        };
    }

    async getInsights(userId: string) {
        const conversations = await this.conversationRepository.find({
            where: { userId },
            relations: ['messages'],
            order: { updatedAt: 'DESC' },
            take: 5,
        });

        return conversations.map((conv) => {
            const lastMsg = conv.messages?.[conv.messages.length - 1];
            return {
                id: conv.id,
                title: conv.title ?? 'Conversa',
                content: lastMsg?.content?.slice(0, 200) ?? '',
                topic: 'coach',
                createdAt: conv.updatedAt?.toISOString(),
            };
        });
    }
}
