import type { PlanReview } from 'src/ai/ai.service';
import { TrainingPlan } from './entities/training-plan.entity';
import { TrainingSession } from './entities/training-session.entity';

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

function buildPlanCoachNotes(
  index: number,
  overview: string | undefined,
  rationale: string | undefined,
  weekOneNotes: Array<string | undefined>,
): string | undefined {
  if (index !== 0) return rationale?.slice(0, PLAN_COACH_NOTES_MAX_LENGTH);

  return [...weekOneNotes, overview, rationale]
    .filter((part): part is string => !!part)
    .join('\n\n')
    .slice(0, PLAN_COACH_NOTES_MAX_LENGTH);
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

  plans.forEach((plan, index) => {
    const week = review.weeks.find(
      (candidate) =>
        candidate.weekStart.slice(0, 10) === plan.weekStart.slice(0, 10),
    );
    if (!week) return;

    result.plans.push({
      planId: plan.id,
      patch: {
        focus: week.focus?.slice(0, PLAN_FOCUS_MAX_LENGTH),
        coachNotes: buildPlanCoachNotes(
          index,
          review.overview,
          week.rationale,
          weekOneNotes,
        ),
      },
    });

    const sessions = [...(plan.sessions ?? [])].sort(
      (a, b) => a.dayOrder - b.dayOrder,
    );
    const tips = week.tips ?? [];

    sessions.forEach((session: TrainingSession, position: number) => {
      const tip = tips.find((t) => t.day === session.day) ?? tips[position];
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
  });

  return result;
}
