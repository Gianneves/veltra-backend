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
    const goal = this.goalRepository.create({
      ...createGoalDto,
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
      await this.trainingPlansService.generateFromGoal(savedGoal);
    } catch (err) {
      console.error('Erro ao gerar plano de treino:', err);
    }

    return savedGoal;
  }

  async update(id: string, userId: string, updateGoalDto: UpdateGoalDto) {
    const goal = await this.findOne(id, userId);
    if (!goal) return null;

    Object.assign(goal, updateGoalDto);
    return this.goalRepository.save(goal);
  }

  async delete(id: string, userId: string) {
    const result = await this.goalRepository.delete({ id, userId });

    if (result.affected === 0) {
      throw new NotFoundException(`goal with id: ${id} not found`);
    }

    return { deleted: true, id };
  }
}
