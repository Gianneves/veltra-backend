import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TrainingPlan } from './entities/training-plan.entity';
import { TrainingSession } from './entities/training-session.entity';

@Injectable()
export class TrainingPlansService {
    constructor(
        @InjectRepository(TrainingPlan)
        private readonly planRepository: Repository<TrainingPlan>,
        @InjectRepository(TrainingSession)
        private readonly sessionRepository: Repository<TrainingSession>,
    ) {}

    async findCurrent(userId: string) {
        const now = new Date();
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay());
        weekStart.setHours(0, 0, 0, 0);

        let plan = await this.planRepository.findOne({
            where: { userId, weekStart: weekStart.toISOString() },
            relations: ['sessions'],
            order: { sessions: { day: 'ASC' } as any },
        });

        if (!plan) {
            plan = await this.generateDefaultPlan(userId, weekStart);
        }

        return plan;
    }

    private async generateDefaultPlan(userId: string, weekStart: Date) {
        const plan = this.planRepository.create({
            userId,
            weekStart: weekStart.toISOString(),
        });
        const savedPlan = await this.planRepository.save(plan);

        const days = [
            { day: 'Segunda', type: 'easy', dist: 8, pace: 330 },
            { day: 'Terça', type: 'interval', dist: 6, pace: 300 },
            { day: 'Quarta', type: 'rest', dist: 0, pace: 0 },
            { day: 'Quinta', type: 'easy', dist: 10, pace: 320 },
            { day: 'Sexta', type: 'recovery', dist: 5, pace: 350 },
            { day: 'Sábado', type: 'long_run', dist: 16, pace: 310 },
            { day: 'Domingo', type: 'rest', dist: 0, pace: 0 },
        ];

        const sessions = days.map((d) =>
            this.sessionRepository.create({
                planId: savedPlan.id,
                day: d.day,
                type: d.type,
                plannedDistance: d.dist * 1000,
                plannedPace: d.pace,
                notes: d.type === 'rest' ? 'Dia de descanso ativo' : undefined,
                completed: false,
            })
        );

        savedPlan.sessions = await this.sessionRepository.save(sessions);
        return savedPlan;
    }
}
