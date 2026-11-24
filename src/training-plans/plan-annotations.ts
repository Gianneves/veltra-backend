import type { PlanReview } from 'src/ai/ai.service';
import type { TrainingPlan } from './entities/training-plan.entity';

export const PLAN_FOCUS_MAX_LENGTH = 120;
export const PLAN_COACH_NOTES_MAX_LENGTH = 1200;
export const SESSION_NOTES_MAX_LENGTH = 500;

export interface PlanAnnotationPatch {
  focus?: string;
  coachNotes?: string;
}

export interface SessionAnnotationPatch {
  notes?: string;
}

export interface PlanAnnotation {
  planId: string;
  patch: PlanAnnotationPatch;
}

export interface SessionAnnotation {
  sessionId: string;
  patch: SessionAnnotationPatch;
}

export interface PlanAnnotations {
  plans: PlanAnnotation[];
  sessions: SessionAnnotation[];
}

interface BuildPlanAnnotationsOptions {
  review: PlanReview;
  plans: TrainingPlan[];
  weekOneNotes?: Array<string | undefined>;
}

/**
 * Monta as atualizações de anotação de um plano revisado pela IA.
 *
 * Devolve apenas foco, notas do plano e notas de sessão (ADR-0002): distância,
 * pace, dia, tipo e conclusão nunca entram no resultado, e o plano recebido não
 * é alterado.
 */
export function buildPlanAnnotations({
  review,
  plans,
  weekOneNotes = [],
}: BuildPlanAnnotationsOptions): PlanAnnotations {
  const result: PlanAnnotations = { plans: [], sessions: [] };

  for (const week of review.weeks) {
    const index = plans.findIndex(
      (plan) => plan.weekStart.slice(0, 10) === week.weekStart.slice(0, 10),
    );
    if (index < 0) continue;

    const plan = plans[index];
    const isFirstWeek = index === 0;

    const coachNotes = isFirstWeek
      ? [...weekOneNotes, review.overview, week.rationale]
          .filter((part): part is string => !!part)
          .join('\n\n')
      : week.rationale;

    result.plans.push({
      planId: plan.id,
      patch: {
        focus: week.focus?.slice(0, PLAN_FOCUS_MAX_LENGTH),
        coachNotes: coachNotes?.slice(0, PLAN_COACH_NOTES_MAX_LENGTH),
      },
    });

    const sessions = [...(plan.sessions ?? [])].sort(
      (a, b) => a.dayOrder - b.dayOrder,
    );

    sessions.forEach((session, position) => {
      const tip =
        week.tips.find((t) => t.day === session.day) ?? week.tips[position];
      if (!tip?.text) return;

      const base = session.notes ?? '';
      result.sessions.push({
        sessionId: session.id,
        patch: {
          notes: `${base} Dica do Coach: ${tip.text}`.slice(
            0,
            SESSION_NOTES_MAX_LENGTH,
          ),
        },
      });
    });
  }

  return result;
}
