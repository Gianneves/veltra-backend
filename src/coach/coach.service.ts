import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CoachConversation } from './entities/coach-conversation.entity';
import { CoachMessage } from './entities/coach-message.entity';
import { Goal } from 'src/goals/entities/goal.entity';
import { TrainingPlan } from 'src/training-plans/entities/training-plan.entity';
import { AiService } from 'src/ai/ai.service';

@Injectable()
export class CoachService {
  constructor(
    @InjectRepository(CoachConversation)
    private readonly conversationRepository: Repository<CoachConversation>,
    @InjectRepository(CoachMessage)
    private readonly messageRepository: Repository<CoachMessage>,
    @InjectRepository(Goal)
    private readonly goalRepository: Repository<Goal>,
    @InjectRepository(TrainingPlan)
    private readonly planRepository: Repository<TrainingPlan>,
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

    const conv = this.conversationRepository.create({
      userId,
      title: 'Nova conversa',
    });
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

    let contextBlock = '';

    const activeGoal = await this.goalRepository.findOne({
      where: { userId, status: 'active' },
      order: { createdAt: 'DESC' },
    });

    if (activeGoal) {
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      weekStart.setHours(0, 0, 0, 0);

      const currentPlan = await this.planRepository.findOne({
        where: { userId, weekStart: weekStart.toISOString() },
        relations: ['sessions'],
        order: { sessions: { dayOrder: 'ASC' } as any },
      });

      const level =
        !activeGoal.longestRunDistance || activeGoal.longestRunDistance < 5000
          ? 'iniciante'
          : activeGoal.longestRunDistance < 10000
            ? 'novato'
            : activeGoal.longestRunDistance < 21097
              ? 'intermediário'
              : 'avançado';

      const threeKmPaceStr = `${Math.floor(activeGoal.threeKmTime / 60)}:${(activeGoal.threeKmTime % 60).toString().padStart(2, '0')}`;

      contextBlock += `\nContexto do atleta:
- Nível: ${level}
- Meta ativa: ${activeGoal.title}
- Distância alvo: ${(activeGoal.targetDistance / 1000).toFixed(1)}km
- Data alvo: ${new Date(activeGoal.targetDate).toLocaleDateString('pt-BR')}
- Dias de treino por semana: ${activeGoal.daysPerWeek}
- Dia do longão: ${activeGoal.longRunDay || 'Sábado'}
- Teste 3km: ${threeKmPaceStr} (${Math.round(activeGoal.threeKmTime / 30)}s/km)`;

      if (activeGoal.longestRunDistance) {
        const distKm = (activeGoal.longestRunDistance / 1000).toFixed(1);
        let timeStr = '';
        if (activeGoal.longestRunTime) {
          timeStr = ` em ${Math.floor(activeGoal.longestRunTime / 60)}min`;
        }
        contextBlock += `\n- Maior distância já corrida: ${distKm}km${timeStr}`;
      }

      if (currentPlan?.sessions) {
        contextBlock += `\n\nPlano de treino desta semana:`;
        for (const s of currentPlan.sessions) {
          const distKm = (s.plannedDistance / 1000).toFixed(1);
          contextBlock += `\n- ${s.day}: ${distKm}km (${s.type})${s.completed ? ' ✅' : ''}`;
        }
      }
    }

    const systemPrompt = `Você é o Veltra Coach, um treinador de corrida experiente e motivador. 
Sua personalidade é técnica, precisa e encorajadora. 
Você analisa dados de corrida e oferece conselhos personalizados.

Você segue a metodologia 80/20: 80% dos treinos devem ser em baixa intensidade (ritmo de conversa, zona 2) e 20% em alta intensidade (intervalados, tempos, limiar). Sempre que der conselhos, considere essa distribuição.

Siga o princípio de progressão gradual: aumento de volume semanal de no máximo 10%.

Responda em português brasileiro de forma clara e direta.${contextBlock}`;

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
