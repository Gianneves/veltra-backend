import type { Activity } from 'src/activities/entities/activity.entity';
import type { Goal } from 'src/goals/entities/goal.entity';
import type {
  ActivityFeatures,
  RunType,
} from 'src/training-plans/activity-features';
import type { AthleteProfile } from 'src/training-plans/athlete-profile.service';
import type { TrainingPlan } from 'src/training-plans/entities/training-plan.entity';
import type { TrainingSession } from 'src/training-plans/entities/training-session.entity';
import { assessAdherence, type AdherenceVerdict } from './adherence';

export interface ActivityInsightContextInput {
  activity: Activity;
  features: ActivityFeatures;
  runType: RunType;
  session?: TrainingSession | null;
  plan?: TrainingPlan | null;
  goal?: Goal | null;
  profile?: AthleteProfile | null;
}

const RUN_TYPE_LABELS: Record<RunType, string> = {
  interval: 'intervalado',
  tempo: 'tempo run',
  fartlek: 'fartlek',
  easy: 'corrida leve',
  long: 'longão',
};

const VERDICT_LABELS: Record<AdherenceVerdict, string> = {
  no_plano: 'No plano',
  proximo: 'Próximo do plano',
  diferente: 'Diferente do plano',
};

function formatPace(seconds?: number | null): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return 'N/A';
  const total = Math.round(seconds);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${sec.toString().padStart(2, '0')}/km`;
}

function formatDistance(meters?: number | null): string {
  if (!meters || !Number.isFinite(meters) || meters <= 0) return 'N/A';
  return `${(meters / 1000).toFixed(2)} km`;
}

function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return 'N/A';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return h > 0 ? `${h}h${m}min` : `${m}min${s}s`;
}

function formatSignedPercent(value: number): string {
  const percent = value * 100;
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
}

export function buildActivityInsightContext({
  activity,
  features,
  runType,
  session,
  plan,
  goal,
  profile,
}: ActivityInsightContextInput): string {
  const lines: string[] = [];

  lines.push('Dados da corrida:');
  lines.push(`- Nome: ${activity.name}`);
  lines.push(`- Data: ${features.localDate.toLocaleDateString('pt-BR')}`);
  lines.push(`- Esporte (Strava): ${activity.sport_type ?? activity.type}`);
  lines.push(`- Classificação do treino: ${RUN_TYPE_LABELS[runType]}`);
  lines.push(`- Distância: ${formatDistance(activity.distance)}`);
  lines.push(`- Tempo em movimento: ${formatDuration(activity.moving_time)}`);
  lines.push(`- Pace médio: ${formatPace(features.pace)}`);

  if (activity.average_heartrate != null) {
    const maxHr =
      activity.max_heartrate != null ? ` (máx ${activity.max_heartrate})` : '';
    lines.push(
      `- Frequência cardíaca média: ${activity.average_heartrate} bpm${maxHr}`,
    );
  }
  if (activity.average_cadence != null) {
    lines.push(`- Cadência média: ${activity.average_cadence} spm`);
  }
  if (activity.total_elevation_gain != null) {
    lines.push(`- Elevação: ${activity.total_elevation_gain} m`);
  }
  if (features.repSizes.length > 0) {
    lines.push(
      `- Estrutura identificada no nome: ${features.repSizes.join(', ')}`,
    );
  }

  if (session) {
    lines.push('');
    lines.push('Treino planejado vinculado a esta corrida:');
    if (plan?.weekStart) {
      lines.push(
        `- Semana do plano: ${new Date(plan.weekStart).toLocaleDateString('pt-BR')}`,
      );
    }
    const plannedType =
      session.type in RUN_TYPE_LABELS
        ? RUN_TYPE_LABELS[session.type as RunType]
        : session.type;
    lines.push(
      `- ${session.day}: ${plannedType} — ${formatDistance(session.plannedDistance)} a ${formatPace(session.plannedPace)}`,
    );
    if (session.notes) lines.push(`- Observações do treino: ${session.notes}`);
    if (session.matchMethod) {
      lines.push(`- Vínculo: ${session.matchMethod}`);
    }

    const adherence = assessAdherence({
      plannedDistance: session.plannedDistance,
      plannedPace: session.plannedPace,
      actualDistance: session.actualDistance,
      actualPace: session.actualPace,
    });

    if (adherence) {
      lines.push(
        `- Aderência: ${VERDICT_LABELS[adherence.verdict]} (distância ${formatSignedPercent(adherence.distanceDiff)}, pace ${formatSignedPercent(adherence.paceDiff)})`,
      );
    }
  } else {
    lines.push('');
    lines.push(
      'Nenhum treino planejado foi vinculado a esta corrida (corrida livre).',
    );
  }

  if (goal) {
    lines.push('');
    lines.push('Meta ativa do atleta:');
    lines.push(
      `- ${goal.title}: ${formatDistance(goal.targetDistance)} em ${new Date(goal.targetDate).toLocaleDateString('pt-BR')}`,
    );
    lines.push(`- Treinos por semana: ${goal.daysPerWeek}`);
    if (goal.targetTime) {
      lines.push(`- Tempo alvo: ${formatDuration(goal.targetTime)}`);
    }
  }

  if (profile?.hasData) {
    lines.push('');
    lines.push('Perfil recente do atleta:');
    lines.push(`- Nível: ${profile.level}`);
    lines.push(`- Volume semanal recente: ${profile.recentWeeklyKm} km`);
    lines.push(`- Maior corrida recente: ${profile.longestRunKm} km`);
    if (profile.bestShortPace) {
      lines.push(`- Melhor pace curto: ${formatPace(profile.bestShortPace)}`);
    }
    if (profile.bestMediumPace) {
      lines.push(`- Melhor pace médio: ${formatPace(profile.bestMediumPace)}`);
    }
    if (profile.bestLongPace) {
      lines.push(`- Melhor pace longo: ${formatPace(profile.bestLongPace)}`);
    }
  }

  return lines.join('\n');
}
