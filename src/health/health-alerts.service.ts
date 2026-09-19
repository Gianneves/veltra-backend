import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { Activity } from 'src/activities/entities/activity.entity';
import {
  buildActivityFeatures,
  classifyRunType,
} from 'src/training-plans/activity-features';
import { User } from 'src/users/entities/user.entity';
import {
  DISTANCE_AGE_RULES,
  HEALTH_DISCLAIMER,
  assessDistanceForAge,
  calculateAge,
  checkupAdvice,
  distanceAgeRule,
  planAgeAdjustment,
  predictedMaxHeartRate,
  type AgeDistanceAssessment,
  type AgePlanAdjustment,
} from './age-policy';

export type HealthAlertSeverity = 'info' | 'attention' | 'medical';

export interface HealthAlert {
  key: string;
  severity: HealthAlertSeverity;
  title: string;
  message: string;
  recommendation: string;
  activityId?: string;
  evidence?: Record<string, number | string>;
}

export interface HealthOverview {
  age: number | null;
  birthDate: string | null;
  predictedMaxHeartRate: number | null;
  alerts: HealthAlert[];
  disclaimer: string;
}

export interface DistanceAgeRuleView {
  label: string;
  minKm: number;
  maxKm: number | null;
  minAge: number;
  clearanceBelowAge: number;
}

export interface HealthPolicy {
  age: number | null;
  birthDate: string | null;
  predictedMaxHeartRate: number | null;
  planAdjustment: AgePlanAdjustment | null;
  distanceRules: DistanceAgeRuleView[];
  assessment: AgeDistanceAssessment | null;
  checkup: { severity: 'info' | 'medical'; message: string } | null;
  disclaimer: string;
}

const WINDOW_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
const SEVERITY_WEIGHT: Record<HealthAlertSeverity, number> = {
  medical: 0,
  attention: 1,
  info: 2,
};

@Injectable()
export class HealthAlertsService {
  constructor(
    @InjectRepository(Activity)
    private readonly activityRepository: Repository<Activity>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async getOverview(userId: string, now: Date = new Date()) {
    const context = await this.loadContext(userId, now);

    return {
      age: context.age ?? null,
      birthDate: context.birthDate ?? null,
      predictedMaxHeartRate: context.predictedMaxHeartRate ?? null,
      alerts: context.alerts,
      disclaimer: HEALTH_DISCLAIMER,
    } satisfies HealthOverview;
  }

  async getPolicy(
    userId: string,
    distanceKm?: number,
    now: Date = new Date(),
  ): Promise<HealthPolicy> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'birthDate'],
    });
    const birthDate = user?.birthDate ?? undefined;
    const age = calculateAge(birthDate, now);
    const adjustment = planAgeAdjustment(age) ?? null;

    return {
      age: age ?? null,
      birthDate: birthDate ?? null,
      predictedMaxHeartRate: predictedMaxHeartRate(age) ?? null,
      planAdjustment: adjustment,
      distanceRules: this.distanceRulesView(),
      assessment:
        distanceKm !== undefined && Number.isFinite(distanceKm)
          ? assessDistanceForAge(distanceKm, age)
          : null,
      checkup: checkupAdvice(age) ?? null,
      disclaimer: HEALTH_DISCLAIMER,
    };
  }

  async getAlerts(userId: string, now: Date = new Date()) {
    const context = await this.loadContext(userId, now);
    return context.alerts;
  }

  private async loadContext(userId: string, now: Date) {
    const [user, activities] = await Promise.all([
      this.userRepository.findOne({
        where: { id: userId },
        select: ['id', 'birthDate'],
      }),
      this.activityRepository.find({
        where: {
          user: { id: userId },
          start_date: MoreThanOrEqual(
            new Date(now.getTime() - WINDOW_DAYS * DAY_MS),
          ),
        },
        order: { start_date: 'ASC' },
      }),
    ]);

    const birthDate = user?.birthDate ?? undefined;
    const age = calculateAge(birthDate, now);
    const predicted = predictedMaxHeartRate(age);

    const runs = activities.filter(
      (activity) =>
        (activity.type === 'Run' || activity.sport_type === 'Run') &&
        activity.distance >= 1000 &&
        activity.moving_time > 0 &&
        (activity.start_date_local ?? activity.start_date),
    );

    const alerts = [
      ...this.ageDistanceAlerts(runs, age, now),
      ...this.volumeRampAlerts(runs, now),
      ...this.longRunJumpAlerts(runs, now),
      ...this.heartRateAlerts(runs, predicted, now),
      ...this.intensityAlerts(runs, predicted, now),
      ...this.consecutiveHardAlerts(runs, predicted, now),
      ...this.distanceMilestoneAlerts(runs, age, now),
      ...this.checkupAlerts(age),
    ].sort(
      (a, b) => SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity],
    );

    return {
      age,
      birthDate,
      predictedMaxHeartRate: predicted,
      alerts,
    };
  }

  private distanceRulesView(): DistanceAgeRuleView[] {
    return DISTANCE_AGE_RULES.map((rule) => ({
      label: rule.label,
      minKm: rule.minKm,
      maxKm: Number.isFinite(rule.maxKm) ? rule.maxKm : null,
      minAge: rule.minAge,
      clearanceBelowAge: rule.clearanceBelowAge,
    }));
  }

  private ageDistanceAlerts(
    runs: Activity[],
    age: number | undefined,
    now: Date,
  ): HealthAlert[] {
    if (age === undefined) return [];

    const since = now.getTime() - 30 * DAY_MS;
    const alerts: HealthAlert[] = [];

    for (const run of runs) {
      const date = this.localDate(run);
      if (!date || date.getTime() < since) continue;

      const distanceKm = run.distance / 1000;
      const assessment = assessDistanceForAge(distanceKm, age);

      if (!assessment.allowed) {
        const rule = distanceAgeRule(distanceKm);
        alerts.push({
          key: `age_distance_${run.id}`,
          severity: 'medical',
          title: 'Distância acima do recomendado para a idade',
          message: `A corrida "${run.name}" teve ${distanceKm.toFixed(1)} km, na faixa de ${rule.label}, não recomendada antes dos ${rule.minAge} anos.`,
          recommendation:
            'Converse com um médico e um treinador antes de repetir esse tipo de esforço. O crescimento e o desenvolvimento pedem progressão cautelosa.',
          activityId: run.id,
          evidence: { distanceKm: round1(distanceKm), minAge: rule.minAge },
        });
      }
    }

    return alerts.slice(0, 2);
  }

  private volumeRampAlerts(runs: Activity[], now: Date): HealthAlert[] {
    const weeks = new Map<string, number>();

    for (const run of runs) {
      const date = this.localDate(run);
      if (!date) continue;
      const key = this.weekKey(date);
      weeks.set(key, (weeks.get(key) ?? 0) + run.distance / 1000);
    }

    const currentKey = this.weekKey(now);
    const current = weeks.get(currentKey) ?? 0;

    const previous = [...weeks.entries()]
      .filter(([key, km]) => key < currentKey && km > 0)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 4)
      .map(([, km]) => km);

    if (previous.length < 2 || current < 10) return [];

    const average = previous.reduce((sum, km) => sum + km, 0) / previous.length;
    if (average <= 0 || current <= average * 1.3) return [];

    const increasePct = Math.round((current / average - 1) * 100);

    return [
      {
        key: 'volume_ramp',
        severity: 'attention',
        title: 'Aumento brusco de volume',
        message: `Nesta semana você somou ${round1(current)} km, ${increasePct}% acima da sua média recente de ${round1(average)} km por semana.`,
        recommendation:
          'Progressões acima de 20-30% aumentam o risco de lesões. Segure o volume por uma semana, inclua dias leves e priorize o sono antes de voltar a crescer.',
        evidence: {
          currentWeekKm: round1(current),
          averageWeekKm: round1(average),
          increasePct,
        },
      },
    ];
  }

  private longRunJumpAlerts(runs: Activity[], now: Date): HealthAlert[] {
    const currentStart = now.getTime() - 7 * DAY_MS;
    const previousStart = now.getTime() - 28 * DAY_MS;

    let currentLong = 0;
    let previousLong = 0;

    for (const run of runs) {
      const date = this.localDate(run);
      if (!date) continue;
      const timestamp = date.getTime();

      if (timestamp >= currentStart) {
        currentLong = Math.max(currentLong, run.distance);
      } else if (timestamp >= previousStart) {
        previousLong = Math.max(previousLong, run.distance);
      }
    }

    if (
      currentLong < 8000 ||
      previousLong <= 0 ||
      currentLong <= previousLong * 1.15
    ) {
      return [];
    }

    return [
      {
        key: 'long_run_jump',
        severity: 'attention',
        title: 'Salto na corrida mais longa',
        message: `Sua corrida mais longa dos últimos 7 dias foi ${round1(currentLong / 1000)} km, contra ${round1(previousLong / 1000)} km nas 3 semanas anteriores.`,
        recommendation:
          'Aumentos grandes de longão sobrecarregam músculos e tendões. Segure a distância por 2-3 semanas e mantenha o restante da semana leve.',
        evidence: {
          currentLongKm: round1(currentLong / 1000),
          previousLongKm: round1(previousLong / 1000),
        },
      },
    ];
  }

  private heartRateAlerts(
    runs: Activity[],
    predicted?: number,
    now: Date = new Date(),
  ): HealthAlert[] {
    if (!predicted) return [];

    const since = now.getTime() - 14 * DAY_MS;

    const candidates = runs
      .filter((run) => {
        const date = this.localDate(run);
        return (
          !!date &&
          date.getTime() >= since &&
          !!run.max_heartrate &&
          run.max_heartrate > predicted + 5
        );
      })
      .sort((a, b) => (b.max_heartrate ?? 0) - (a.max_heartrate ?? 0));

    const run = candidates[0];
    if (!run) return [];

    const date = this.localDate(run);

    return [
      {
        key: `hr_above_predicted_${run.id}`,
        severity: 'attention',
        title: 'FC máxima acima do previsto para a idade',
        message: `Na corrida "${run.name}" (${date?.toLocaleDateString('pt-BR')}), a FC máxima foi ${run.max_heartrate} bpm, acima da FC máxima prevista para sua idade (~${predicted} bpm).`,
        recommendation:
          'A fórmula de FC máxima é uma estimativa e varia muito entre pessoas. Se isso se repetir, vale conversar com um médico e, se possível, fazer um teste de esforço para definir suas zonas com segurança.',
        activityId: run.id,
        evidence: {
          maxHeartRate: run.max_heartrate ?? 0,
          predictedMaxHeartRate: predicted,
        },
      },
    ];
  }

  private intensityAlerts(
    runs: Activity[],
    predicted?: number,
    now: Date = new Date(),
  ): HealthAlert[] {
    const since = now.getTime() - 7 * DAY_MS;

    let totalKm = 0;
    let hardKm = 0;

    for (const run of runs) {
      const date = this.localDate(run);
      if (!date || date.getTime() < since) continue;

      const distanceKm = run.distance / 1000;
      totalKm += distanceKm;
      if (this.isHardRun(run, predicted)) hardKm += distanceKm;
    }

    if (totalKm < 15 || hardKm <= 0 || hardKm / totalKm <= 0.3) return [];

    return [
      {
        key: 'intensity_share',
        severity: 'info',
        title: 'Muita intensidade na semana',
        message: `Cerca de ${Math.round((hardKm / totalKm) * 100)}% dos seus ${round1(totalKm)} km da semana foram em intensidade forte.`,
        recommendation:
          'A metodologia 80/20 sugere que 80% do volume seja leve. Troque um treino forte por rodagem leve para absorver o estímulo e reduzir risco de lesão.',
        evidence: {
          totalKm: round1(totalKm),
          hardKm: round1(hardKm),
          hardSharePct: Math.round((hardKm / totalKm) * 100),
        },
      },
    ];
  }

  private consecutiveHardAlerts(
    runs: Activity[],
    predicted?: number,
    now: Date = new Date(),
  ): HealthAlert[] {
    const since = now.getTime() - 14 * DAY_MS;
    const hardDays = new Map<string, Activity>();

    for (const run of runs) {
      const date = this.localDate(run);
      if (!date || date.getTime() < since) continue;
      if (!this.isHardRun(run, predicted)) continue;
      hardDays.set(this.dayKey(date), run);
    }

    const keys = [...hardDays.keys()].sort();

    for (let i = 1; i < keys.length; i++) {
      const previous = new Date(`${keys[i - 1]}T12:00:00`);
      const current = new Date(`${keys[i]}T12:00:00`);
      const diffDays = Math.round(
        (current.getTime() - previous.getTime()) / DAY_MS,
      );

      if (diffDays === 1) {
        return [
          {
            key: `consecutive_hard_${keys[i]}`,
            severity: 'attention',
            title: 'Estímulos fortes em dias seguidos',
            message: `Você fez treinos fortes em ${previous.toLocaleDateString('pt-BR')} e ${current.toLocaleDateString('pt-BR')}, sem dia leve entre eles.`,
            recommendation:
              'Recuperação faz parte do treino. Evite emendar estímulos fortes: intercale com corrida leve ou descanso para reduzir risco de lesão e fadiga acumulada.',
          },
        ];
      }
    }

    return [];
  }

  private distanceMilestoneAlerts(
    runs: Activity[],
    age: number | undefined,
    now: Date,
  ): HealthAlert[] {
    const thresholds = [10, 21.1, 42.2];
    const since = now.getTime() - 30 * DAY_MS;
    const alerts: HealthAlert[] = [];

    for (const threshold of thresholds) {
      const crossing = runs.find((run) => {
        const date = this.localDate(run);
        return !!date && date.getTime() >= since && run.distance / 1000 >= threshold;
      });

      if (!crossing) continue;

      const crossingDate = this.localDate(crossing);
      if (!crossingDate) continue;

      const hadBefore = runs.some((run) => {
        const date = this.localDate(run);
        return (
          !!date &&
          date.getTime() < crossingDate.getTime() &&
          run.distance / 1000 >= threshold
        );
      });

      if (hadBefore) continue;

      const isFortyPlus = age !== undefined && age >= 40;

      alerts.push({
        key: `distance_milestone_${threshold}`,
        severity: isFortyPlus ? 'medical' : 'info',
        title: `Primeira vez acima de ${threshold} km`,
        message: `Você completou ${round1(crossing.distance / 1000)} km ("${crossing.name}"), uma distância que ainda não tinha feito recentemente.`,
        recommendation: isFortyPlus
          ? 'A partir dos 40 anos, uma avaliação cardiológica antes de provas ou esforços longos é recomendada. Na dúvida, converse com seu médico.'
          : 'Progrida com calma e recuperação adequada. Se tiver sintomas ou histórico cardíaco na família, procure avaliação médica.',
        activityId: crossing.id,
        evidence: { thresholdKm: threshold },
      });
    }

    return alerts;
  }

  private checkupAlerts(age?: number): HealthAlert[] {
    const advice = checkupAdvice(age);
    if (!advice) return [];

    return [
      {
        key: 'checkup_due',
        severity: advice.severity,
        title: 'Acompanhamento médico',
        message: advice.message,
        recommendation:
          'Manter exames em dia ajuda a treinar com segurança. Estas informações não substituem avaliação médica.',
      },
    ];
  }

  private isHardRun(run: Activity, predicted?: number): boolean {
    const type = classifyRunType(buildActivityFeatures(run));
    if (type === 'interval' || type === 'tempo' || type === 'fartlek') {
      return true;
    }

    return !!(
      predicted &&
      run.average_heartrate &&
      run.average_heartrate >= predicted * 0.85
    );
  }

  private localDate(activity: Activity): Date | undefined {
    return activity.start_date_local ?? activity.start_date ?? undefined;
  }

  private weekKey(date: Date): string {
    const start = new Date(date);
    start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);
    return start.toISOString().slice(0, 10);
  }

  private dayKey(date: Date): string {
    const local = new Date(date);
    local.setHours(12, 0, 0, 0);
    return `${local.getFullYear()}-${(local.getMonth() + 1)
      .toString()
      .padStart(2, '0')}-${local.getDate().toString().padStart(2, '0')}`;
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
