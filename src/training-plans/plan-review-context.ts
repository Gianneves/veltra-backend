import { planAgeAdjustment } from 'src/health/age-policy';
import type { Goal } from 'src/goals/entities/goal.entity';
import type { AthleteProfile } from './athlete-profile.service';
import type { PlanPhase } from './workout-library';
import { formatRaceTime, type RaceTargetAssessment } from './race-target';

const MIN_PACE = 150;
const MAX_PACE = 600;

export interface PlanReviewPaces {
  interval: number;
  threshold: number;
  easy: number;
  goal: number;
}

export interface PlanReviewSession {
  day: string;
  type: string;
  km: number;
  paceSegKm: number;
}

export interface PlanReviewWeek {
  weekStart: string;
  phase?: PlanPhase | null;
  weeklyKm: number;
  longKm: number;
  workouts: string[];
  sessions: PlanReviewSession[];
}

function formatPace(secondsPerKm: number): string {
  const safe = Math.max(MIN_PACE, Math.min(MAX_PACE, Math.round(secondsPerKm)));
  const min = Math.floor(safe / 60);
  const sec = safe % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

/**
 * Monta o contexto enviado à revisão do plano pela IA.
 *
 * É compartilhado entre a geração e o backfill da leitura: o chamador entrega
 * as semanas já no formato do prompt, e cada semana carrega as próprias sessões.
 */
export function buildPlanReviewContext(
  goal: Goal,
  profile: AthleteProfile,
  paces: PlanReviewPaces,
  assessment: RaceTargetAssessment | undefined,
  patternNote: string | undefined,
  weeks: PlanReviewWeek[],
): string {
  const pattern = profile.pattern;

  return JSON.stringify({
    atleta: {
      nivel: profile.level,
      temHistorico: profile.hasData,
      volumeSemanalRecenteKm: profile.recentWeeklyKm,
      longaoRecenteKm: profile.longestRunKm,
      melhorPace5k: profile.bestShortPace,
      melhorPace10k: profile.bestMediumPace,
      corridasPorSemana: profile.runsPerWeek,
      idade: profile.age ?? null,
      fcMaximaPrevista: profile.predictedMaxHeartRate ?? null,
      limitePorIdade: planAgeAdjustment(profile.age)?.reason ?? null,
      ultimas3Semanas: profile.recentForm?.hasData
        ? {
            janelaInicio: profile.recentForm.windowStart.slice(0, 10),
            janelaFim: profile.recentForm.windowEnd.slice(0, 10),
            semanas: profile.recentForm.weeks,
            corridas: profile.recentForm.runs,
            kmPorSemana: profile.recentForm.weeklyKm,
            corridasPorSemana: profile.recentForm.runsPerWeek,
            longaoKm: profile.recentForm.longestKm,
          }
        : null,
      teste3Km: profile.threeKm
        ? {
            tempoSegundos: profile.threeKm.time,
            paceSegKm: profile.threeKm.pace,
            nivelEstimado: profile.threeKm.level,
          }
        : null,
      baseDoPlano: profile.recentForm?.hasData
        ? 'ultimas3Semanas+teste3Km'
        : profile.threeKm
          ? 'teste3Km+preferencias'
          : 'historico',
    },
    historicoDoAtleta: pattern?.hasData
      ? {
          amostraDeCorridas: pattern.sampleSize,
          semanasAnalisadas: pattern.weeksAnalyzed,
          confianca: pattern.confidence,
          diasQueCostumaCorrer: pattern.preferredRunDays,
          diasDeQualidade: pattern.preferredQualityDays,
          diaDoLongao: pattern.preferredLongRunDay ?? null,
          corridasPorSemana: pattern.runsPerWeek,
          qualidadePorSemana: pattern.qualityPerWeek,
          mixDeTreinos: pattern.typeMix,
          paceLeveHabitualSegKm: pattern.easyPace ?? null,
          longaoHabitual: pattern.longRun ?? null,
          treinosTipicos: Object.fromEntries(
            Object.entries(pattern.typicalQuality).map(([type, typical]) => [
              type,
              {
                km: typical?.km,
                paceSegKm: typical?.pace,
                paceDeTiroSegKm: typical?.repPace ?? null,
                repeticoes: typical?.reps,
              },
            ]),
          ),
          ajusteAplicado: patternNote ?? null,
        }
      : null,
    meta: {
      titulo: goal.title,
      provaKm: goal.targetDistance / 1000,
      dataAlvo: goal.targetDate,
      paceObjetivo: formatPace(paces.goal),
      diasPorSemana: goal.daysPerWeek,
      diaLongao: goal.longRunDay,
      tempoAlvo: goal.targetTime ? formatRaceTime(goal.targetTime) : null,
      tempoProjetado: assessment
        ? formatRaceTime(assessment.predictedTime)
        : null,
      melhoraNecessariaPct: assessment
        ? Math.round(assessment.requiredImprovement * 100)
        : null,
      ganhoMaximoPct: assessment
        ? Math.round(assessment.maxImprovement * 100)
        : null,
      vereditoMeta: assessment?.verdict ?? null,
      paceRealista: assessment ? formatPace(assessment.realisticPace) : null,
    },
    paces: {
      intervaloSegKm: paces.interval,
      limiarSegKm: paces.threshold,
      leveSegKm: paces.easy,
    },
    semanas: weeks.map((week) => ({
      semana: week.weekStart.slice(0, 10),
      fase: week.phase ?? null,
      volumeKm: week.weeklyKm,
      longaoKm: week.longKm,
      treinosDeQualidade: week.workouts,
      sessoes: week.sessions.map((session) => ({
        dia: session.day,
        tipo: session.type,
        km: session.km,
        paceSegKm: session.paceSegKm,
      })),
    })),
  });
}
