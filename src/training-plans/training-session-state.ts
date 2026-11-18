import type { TrainingPlan } from './entities/training-plan.entity';
import type { TrainingSession } from './entities/training-session.entity';

/**
 * Desfaz o pareamento e os realizados de uma sessão, deixando-a planejada.
 */
export function clearSessionMatchState(session: TrainingSession): void {
  session.activityId = null;
  session.actualDistance = null;
  session.actualPace = null;
  session.actualMovingTime = null;
  session.matchScore = null;
  session.matchMethod = null;
  session.matchedAt = null;
  session.completed = false;
}

/**
 * Estado de uma sessão de descanso: distância e pace zero, sem pareamento,
 * realizados ou conclusão.
 */
export function applyRestState(session: TrainingSession): void {
  session.plannedDistance = 0;
  session.plannedPace = 0;
  clearSessionMatchState(session);
}

/**
 * Tipos que contam como estímulo de qualidade para os limites de idade.
 */
export const QUALITY_SESSION_TYPES = ['interval', 'tempo', 'fartlek'];

/**
 * Quantidade de sessões de qualidade da semana.
 */
export function countQualitySessions(sessions: TrainingSession[]): number {
  return sessions.filter((session) =>
    QUALITY_SESSION_TYPES.includes(session.type),
  ).length;
}

/**
 * Volume planejado da semana, em metros: soma das distâncias planejadas das
 * sessões que não são de descanso.
 */
export function sumPlannedVolumeMeters(sessions: TrainingSession[]): number {
  return sessions
    .filter((session) => session.type !== 'rest')
    .reduce((sum, session) => sum + (session.plannedDistance ?? 0), 0);
}

/**
 * Normaliza, em memória, o estado de leitura do plano: descanso nunca sai
 * concluído e o total planejado é sempre o calculado. Não grava nada.
 */
export function normalizePlanReadState(plan: TrainingPlan): TrainingPlan {
  if (!plan.sessions) return plan;

  for (const session of plan.sessions) {
    if (session.type === 'rest') applyRestState(session);
  }

  plan.plannedWeeklyKm = sumPlannedVolumeMeters(plan.sessions);
  return plan;
}
