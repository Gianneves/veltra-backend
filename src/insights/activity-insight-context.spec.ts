import type { Activity } from 'src/activities/entities/activity.entity';
import type { Goal } from 'src/goals/entities/goal.entity';
import type { ActivityFeatures } from 'src/training-plans/activity-features';
import type { AthleteProfile } from 'src/training-plans/athlete-profile.service';
import type { TrainingPlan } from 'src/training-plans/entities/training-plan.entity';
import type { TrainingSession } from 'src/training-plans/entities/training-session.entity';
import { buildActivityInsightContext } from './activity-insight-context';

function makeFeatures(
  overrides: Partial<ActivityFeatures> = {},
): ActivityFeatures {
  return {
    distanceKm: 10,
    pace: 350,
    movingTime: 3500,
    name: 'Corrida',
    shape: 'steady',
    paceVariability: 0,
    hardLaps: 0,
    fastLapStreak: 0,
    lapCount: 0,
    maxSpeedRatio: 1,
    repSizes: [],
    localDate: new Date('2026-05-01T10:00:00Z'),
    ...overrides,
  };
}

const activity = {
  id: 'activity-1',
  name: 'Corrida',
  type: 'Run',
  sport_type: 'Run',
  distance: 10300,
  moving_time: 3600,
  average_heartrate: 150,
  max_heartrate: 170,
  average_cadence: 85,
  total_elevation_gain: 30,
} as unknown as Activity;

const goal = {
  title: 'Meia maratona',
  targetDistance: 21097,
  targetDate: '2026-11-15',
  daysPerWeek: 4,
} as unknown as Goal;

const profile = {
  hasData: true,
  level: 'intermediate',
  recentWeeklyKm: 30,
  longestRunKm: 16,
  bestShortPace: 340,
  bestMediumPace: 355,
  bestLongPace: 365,
} as unknown as AthleteProfile;

describe('buildActivityInsightContext', () => {
  it('describes the run, planned session and adherence', () => {
    const session = {
      day: 'Ter',
      type: 'easy',
      plannedDistance: 10000,
      plannedPace: 350,
      notes: 'Rodagem leve',
      matchMethod: 'auto',
      actualDistance: 10300,
      actualPace: 354,
    } as unknown as TrainingSession;

    const plan = {
      weekStart: new Date('2026-04-26T03:00:00Z').toISOString(),
    } as unknown as TrainingPlan;

    const context = buildActivityInsightContext({
      activity,
      features: makeFeatures(),
      runType: 'easy',
      session,
      plan,
      goal,
      profile,
    });

    expect(context).toContain('Dados da corrida');
    expect(context).toContain('Classificação do treino: corrida leve');
    expect(context).toContain('Treino planejado vinculado');
    expect(context).toContain('- Ter: corrida leve');
    expect(context).toContain('Aderência: No plano');
    expect(context).toContain('Meta ativa do atleta');
    expect(context).toContain('Meia maratona');
    expect(context).toContain('Perfil recente do atleta');
  });

  it('flags free runs without a planned session', () => {
    const context = buildActivityInsightContext({
      activity,
      features: makeFeatures(),
      runType: 'easy',
      session: null,
      goal: null,
      profile: null,
    });

    expect(context).toContain('Nenhum treino planejado foi vinculado');
    expect(context).not.toContain('Aderência:');
    expect(context).not.toContain('Meta ativa do atleta');
  });
});
