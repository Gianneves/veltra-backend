import type { PlanReview } from 'src/ai/ai.service';
import { TrainingPlan } from './entities/training-plan.entity';
import { TrainingSession } from './entities/training-session.entity';
import {
  SESSION_NOTES_MAX_LENGTH,
  buildPlanAnnotations,
} from './plan-annotations';

function makeSession(
  overrides: Partial<TrainingSession> = {},
): TrainingSession {
  return {
    id: 'session-1',
    planId: 'plan-1',
    day: 'Seg',
    dayOrder: 0,
    type: 'easy',
    plannedDistance: 8000,
    plannedPace: 360,
    completed: false,
    ...overrides,
  } as TrainingSession;
}

function makePlan(overrides: Partial<TrainingPlan> = {}): TrainingPlan {
  return {
    id: 'plan-1',
    userId: 'user-1',
    weekStart: '2026-09-14T03:00:00.000Z',
    ...overrides,
  } as TrainingPlan;
}

describe('buildPlanAnnotations', () => {
  it('devolve apenas foco, notas do plano e notas das sessões com dica', () => {
    const first = makePlan({
      id: 'plan-1',
      sessions: [
        makeSession({
          id: 's-ter',
          planId: 'plan-1',
          day: 'Ter',
          dayOrder: 1,
          notes: 'Rodagem leve.',
        }),
        makeSession({
          id: 's-qui',
          planId: 'plan-1',
          day: 'Qui',
          dayOrder: 3,
          notes: 'Tiros curtos.',
        }),
      ],
    });
    const second = makePlan({
      id: 'plan-2',
      weekStart: '2026-09-21T03:00:00.000Z',
      sessions: [
        makeSession({
          id: 's-sab',
          planId: 'plan-2',
          day: 'Sáb',
          dayOrder: 5,
          notes: 'Longão.',
        }),
      ],
    });

    const review: PlanReview = {
      overview: 'Estratégia geral da preparação.',
      weeks: [
        {
          weekStart: '2026-09-14',
          focus: 'Base consistente',
          rationale: 'Semana de base, sem exagerar no volume.',
          tips: [
            { day: 'Ter', text: 'Mantenha o pace leve.' },
            { day: 'Qui', text: '' },
          ],
        },
        {
          weekStart: '2026-09-21',
          focus: 'Subida de volume',
          rationale: 'O longão cresce e pede hidratação.',
          tips: [{ day: 'Sáb', text: 'Hidrate-se antes de sair.' }],
        },
        {
          weekStart: '2026-10-05',
          focus: 'Semana sem plano',
          rationale: 'Não deve gerar atualização.',
          tips: [{ day: 'Seg', text: 'Dica ignorada.' }],
        },
      ],
    };

    const result = buildPlanAnnotations({
      review,
      plans: [first, second],
      weekOneNotes: ['Nota do padrão de treino.', 'Nota da meta.'],
    });

    expect(result.plans).toEqual([
      {
        planId: 'plan-1',
        patch: {
          focus: 'Base consistente',
          coachNotes:
            'Nota do padrão de treino.\n\nNota da meta.\n\nEstratégia geral da preparação.\n\nSemana de base, sem exagerar no volume.',
        },
      },
      {
        planId: 'plan-2',
        patch: {
          focus: 'Subida de volume',
          coachNotes: 'O longão cresce e pede hidratação.',
        },
      },
    ]);

    expect(result.sessions).toEqual([
      {
        sessionId: 's-ter',
        patch: { notes: 'Rodagem leve. Dica do Coach: Mantenha o pace leve.' },
      },
      {
        sessionId: 's-sab',
        patch: { notes: 'Longão. Dica do Coach: Hidrate-se antes de sair.' },
      },
    ]);

    expect(result.sessions[0].patch.notes!.length).toBeLessThanOrEqual(
      SESSION_NOTES_MAX_LENGTH,
    );
  });

  it('não produz distância, pace, dia, tipo ou conclusão, mesmo quando a revisão traz esses campos', () => {
    const sessions = [
      makeSession({
        id: 's-ter',
        planId: 'plan-1',
        day: 'Ter',
        dayOrder: 1,
        type: 'tempo',
        plannedDistance: 9000,
        plannedPace: 350,
        completed: true,
        notes: 'Notas anteriores.',
      }),
    ];
    const plan = makePlan({ id: 'plan-1', sessions });
    const before = sessions.map((session) => ({ ...session }));

    const review = {
      overview: 'Estratégia geral.',
      weeks: [
        {
          weekStart: '2026-09-14',
          focus: 'Foco da semana',
          rationale: 'Justificativa da semana.',
          plannedDistance: 21000,
          plannedPace: 280,
          day: 'Dom',
          type: 'race',
          completed: false,
          tips: [
            {
              day: 'Ter',
              text: 'Dica da sessão.',
              plannedDistance: 12000,
              plannedPace: 300,
              dayOrder: 6,
              type: 'long_run',
              completed: true,
            },
          ],
        },
      ],
    } as unknown as PlanReview;

    const result = buildPlanAnnotations({ review, plans: [plan] });

    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].patch).toEqual({
      focus: 'Foco da semana',
      coachNotes: 'Estratégia geral.\n\nJustificativa da semana.',
    });
    expect(Object.keys(result.plans[0].patch).sort()).toEqual([
      'coachNotes',
      'focus',
    ]);

    expect(result.sessions).toEqual([
      {
        sessionId: 's-ter',
        patch: {
          notes: 'Notas anteriores. Dica do Coach: Dica da sessão.',
        },
      },
    ]);
    expect(Object.keys(result.sessions[0].patch)).toEqual(['notes']);

    const serialized = JSON.stringify(result);
    for (const field of [
      'plannedDistance',
      'plannedPace',
      'day',
      'type',
      'completed',
      'dayOrder',
    ]) {
      expect(serialized).not.toContain(field);
    }

    expect(sessions).toEqual(before);
  });

  it('trunca foco em 120, notas do plano em 1.200 e notas da sessão em 500 caracteres', () => {
    const focus = 'F'.repeat(200);
    const overview = 'O'.repeat(1300);
    const plan = makePlan({
      sessions: [
        makeSession({
          id: 's-ter',
          planId: 'plan-1',
          day: 'Ter',
          dayOrder: 1,
          notes: 'N'.repeat(480),
        }),
      ],
    });
    const review: PlanReview = {
      overview,
      weeks: [
        {
          weekStart: '2026-09-14',
          focus,
          rationale: 'Justificativa da semana.',
          tips: [{ day: 'Ter', text: 'T'.repeat(100) }],
        },
      ],
    };

    const result = buildPlanAnnotations({ review, plans: [plan] });

    expect(result.plans[0].patch.focus).toHaveLength(120);
    expect(result.plans[0].patch.focus).toBe(focus.slice(0, 120));
    expect(result.plans[0].patch.coachNotes).toHaveLength(1200);
    expect(result.plans[0].patch.coachNotes).toBe(overview.slice(0, 1200));

    const sessionNotes = result.sessions[0].patch.notes!;
    expect(sessionNotes).toHaveLength(500);
    expect(sessionNotes.startsWith('N'.repeat(480))).toBe(true);
    expect(sessionNotes).toContain('Dica do Coach: ');
  });

  it('preserva a atualização de cada revisão quando a semana aparece duas vezes', () => {
    const plan = makePlan({
      id: 'plan-1',
      sessions: [
        makeSession({
          id: 's-ter',
          planId: 'plan-1',
          day: 'Ter',
          dayOrder: 1,
          notes: 'Rodagem leve.',
        }),
      ],
    });
    const review: PlanReview = {
      overview: 'Estratégia geral.',
      weeks: [
        {
          weekStart: '2026-09-14',
          focus: 'Primeira leitura',
          rationale: 'Primeira justificativa.',
          tips: [{ day: 'Ter', text: 'Primeira dica.' }],
        },
        {
          weekStart: '2026-09-14',
          focus: 'Segunda leitura',
          rationale: 'Segunda justificativa.',
          tips: [{ day: 'Ter', text: 'Segunda dica.' }],
        },
      ],
    };

    const result = buildPlanAnnotations({ review, plans: [plan] });

    expect(result.plans.map((annotation) => annotation.patch.focus)).toEqual([
      'Primeira leitura',
      'Segunda leitura',
    ]);
    expect(result.sessions.map((annotation) => annotation.sessionId)).toEqual([
      's-ter',
      's-ter',
    ]);
    expect(result.sessions[1].patch.notes).toBe(
      'Rodagem leve. Dica do Coach: Segunda dica.',
    );
  });
});
