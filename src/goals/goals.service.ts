import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Goal } from './entities/goal.entity';
import { Milestone } from './entities/milestone.entity';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';
import { TrainingPlansService } from 'src/training-plans/training-plans.service';

@Injectable()
export class GoalsService {
  constructor(
    @InjectRepository(Goal)
    private readonly goalRepository: Repository<Goal>,
    @InjectRepository(Milestone)
    private readonly milestoneRepository: Repository<Milestone>,
    private readonly trainingPlansService: TrainingPlansService,
  ) {}

  async findAll(userId: string) {
    return this.goalRepository.find({
      where: { userId },
      relations: ['milestones'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, userId: string) {
    return this.goalRepository.findOne({
      where: { id, userId },
      relations: ['milestones'],
    });
  }

  async create(createGoalDto: CreateGoalDto, userId: string) {
    const startDate = this.normalizeOptionalDate(createGoalDto.startDate);

    const goal = this.goalRepository.create({
      ...createGoalDto,
      startDate,
      userId,
      targetDate: new Date(createGoalDto.targetDate).toISOString(),
      status: 'active',
    });

    if (createGoalDto.runDays) {
      goal.daysPerWeek = createGoalDto.runDays.length;
    }

    const savedGoal = await this.goalRepository.save(goal);

    const distances = [0.25, 0.5, 0.75];
    const milestones = distances.map((fraction) =>
      this.milestoneRepository.create({
        goalId: savedGoal.id,
        description:
          fraction === 0.25
            ? '25% da meta'
            : fraction === 0.5
              ? '50% da meta'
              : '75% da meta',
        target: savedGoal.targetDistance * fraction,
        achieved:
          savedGoal.currentProgress >= savedGoal.targetDistance * fraction,
      }),
    );

    savedGoal.milestones = await this.milestoneRepository.save(milestones);

    try {
      await this.trainingPlansService.regenerateFromGoal(savedGoal, {
        startDate: this.cycleStartDate(savedGoal),
      });
    } catch (err) {
      console.error('Erro ao gerar plano de treino:', err);
    }

    return savedGoal;
  }

  async update(id: string, userId: string, updateGoalDto: UpdateGoalDto) {
    const goal = await this.findOne(id, userId);
    if (!goal) return null;

    Object.assign(goal, updateGoalDto);
    if ('startDate' in updateGoalDto) {
      goal.startDate = this.normalizeOptionalDate(updateGoalDto.startDate);
    }
    const savedGoal = await this.goalRepository.save(goal);

    try {
      const currentWeek = this.getWeekStart(new Date());
      const hasCompleted = await this.trainingPlansService.hasCompletedSessions(
        userId,
        currentWeek,
      );
      const startDate =
        this.cycleStartDate(savedGoal) ??
        (hasCompleted ? this.nextMonday() : new Date());

      await this.trainingPlansService.regenerateFromGoal(savedGoal, {
        startDate,
      });
    } catch (err) {
      console.error('Erro ao regenerar plano de treino:', err);
    }

    return savedGoal;
  }

  async delete(id: string, userId: string) {
    const result = await this.goalRepository.delete({ id, userId });

    if (result.affected === 0) {
      throw new NotFoundException(`goal with id: ${id} not found`);
    }

    try {
      await this.trainingPlansService.deleteFuturePlansForGoal(
        userId,
        id,
        new Date(),
      );
    } catch (err) {
      console.error('Erro ao remover planos futuros da meta:', err);
    }

    return { deleted: true, id };
  }

  private normalizeOptionalDate(value?: string | null): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  }

  private cycleStartDate(goal: Goal): Date | undefined {
    if (!goal.startDate) return undefined;

    const date = new Date(goal.startDate);
    if (Number.isNaN(date.getTime())) return undefined;

    const currentWeek = this.getWeekStart(new Date());
    if (date.getTime() < currentWeek.getTime()) return undefined;

    return this.getWeekStart(date);
  }

  private getWeekStart(date: Date): Date {
    const start = new Date(date);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    start.setHours(0, 0, 0, 0);
    return start;
  }

  private nextMonday(date: Date = new Date()): Date {
    const next = new Date(date);
    const day = next.getDay();
    const daysToAdd = day === 0 ? 1 : 8 - day;
    next.setDate(next.getDate() + daysToAdd);
    next.setHours(0, 0, 0, 0);
    return next;
  }
}
