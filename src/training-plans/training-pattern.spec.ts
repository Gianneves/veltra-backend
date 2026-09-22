import { Activity } from 'src/activities/entities/activity.entity';
import { buildActivityFeatures } from './activity-features';
import { buildTrainingPattern, emptyTrainingPattern } from './training-pattern';

const NOW = new Date(2026, 8, 13, 12, 0);

function lapsFrom(paces: number[], distance = 1000) {
  return paces.map((pace) => ({
    distance,
    moving_time: Math.round((pace * distance) / 1000),
    elapsed_time: Math.round((pace * distance) / 1000),
  }));
}

function makeActivity(date: Date, overrides: Partial<Activity> = {}): Activity {
  return {
    id: `activity-${date.getTime()}-${overrides.name ?? 'run'}`,
    activityStravaId: date.getTime(),
    name: 'Corrida',
    type: 'Run',
    sport_type: 'Run',
    distance: 8000,
    moving_time: 3040,
    elapsed_time: 3040,
    start_date_local: date,
    ...overrides,
  } as Activity;
}

function intervalRun(date: Date): Activity {
  const laps = [
    ...lapsFrom([380, 380]),
    ...Array.from({ length: 5 }).flatMap(() => lapsFrom([320], 800)),
    ...Array.from({ length: 6 }).flatMap(() => lapsFrom([420], 400)),
    ...lapsFrom([380]),
  ];

  return makeActivity(date, {
    name: '5x800',
    distance: 9400,
    moving_time: 3428,
    laps,
  });
}

function tempoRun(date: Date): Activity {
  const laps = [
    ...lapsFrom([380, 380]),
    ...lapsFrom([325], 6000),
    ...lapsFrom([380]),
  ];

  return makeActivity(date, {
    name: 'Tempo 6km',
    distance: 9000,
    moving_time: 3090,
    laps,
  });
}

function easyRun(date: Date): Activity {
  return makeActivity(date, {
    name: 'Corrida leve',
    distance: 8000,
    moving_time: 3040,
  });
}

function longRun(date: Date): Activity {
  return makeActivity(date, {
    name: 'Longão',
    distance: 17000,
    moving_time: 6460,
  });
}

function buildRoutine(weeks = 12): Activity[] {
  const runs: Activity[] = [];

  const firstWeekMonday = new Date(NOW);
  firstWeekMonday.setDate(
    firstWeekMonday.getDate() - ((firstWeekMonday.getDay() + 6) % 7),
  );
  firstWeekMonday.setHours(7, 0, 0, 0);

  for (let offset = 0; offset < weeks; offset++) {
    const monday = new Date(firstWeekMonday);
    monday.setDate(monday.getDate() - offset * 7);

    const tuesday = new Date(monday);
    tuesday.setDate(tuesday.getDate() + 1);
    const thursday = new Date(monday);
    thursday.setDate(thursday.getDate() + 3);
    const friday = new Date(monday);
    friday.setDate(friday.getDate() + 4);
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);

    runs.push(
      longRun(sunday),
      intervalRun(tuesday),
      tempoRun(thursday),
      easyRun(friday),
    );
  }

  return runs;
}

function patternFrom(runs: Activity[]) {
  return buildTrainingPattern(
    runs.map((run) => buildActivityFeatures(run)),
    { now: NOW },
  );
}

describe('buildTrainingPattern', () => {
  it('retorna padrão vazio sem atividades', () => {
    expect(patternFrom([])).toEqual(emptyTrainingPattern());
  });

  it('detecta dias, longão e qualidade da rotina', () => {
    const pattern = patternFrom(buildRoutine());

    expect(pattern.hasData).toBe(true);
    expect(pattern.confidence).toBe('high');
    expect(pattern.sampleSize).toBe(48);
    expect(pattern.weeksAnalyzed).toBe(12);
    expect(pattern.runsPerWeek).toBe(4);
    expect(pattern.qualityPerWeek).toBe(2);
    expect(pattern.preferredRunDays).toEqual(['Dom', 'Ter', 'Qui', 'Sex']);
    expect(pattern.preferredLongRunDay).toBe('Dom');
    expect(pattern.preferredQualityDays).toEqual(['Ter', 'Qui']);
  });

  it('estima mix, paces e estruturas típicas por tipo', () => {
    const pattern = patternFrom(buildRoutine());

    expect(pattern.typeMix.interval).toBeCloseTo(0.25, 3);
    expect(pattern.typeMix.tempo).toBeCloseTo(0.25, 3);
    expect(pattern.typeMix.easy).toBeCloseTo(0.25, 3);
    expect(pattern.typeMix.long).toBeCloseTo(0.25, 3);

    expect(pattern.typicalQuality.interval?.km).toBe(9.4);
    expect(pattern.typicalQuality.interval?.repPace).toBe(320);
    expect(pattern.typicalQuality.interval?.reps).toContain('800m');
    expect(pattern.typicalQuality.tempo?.repPace).toBe(325);
    expect(pattern.easyPace).toBe(380);
    expect(pattern.longRun?.km).toBe(17);
  });

  it('rebaixa a confiança com amostra pequena', () => {
    const runs = buildRoutine(3);
    const pattern = patternFrom(runs);

    expect(pattern.hasData).toBe(true);
    expect(pattern.confidence).toBe('low');
    expect(pattern.weeksAnalyzed).toBe(3);
  });

  it('ignora corridas muito curtas', () => {
    const runs = buildRoutine(2);
    runs.push(
      makeActivity(NOW, {
        name: 'Trote',
        distance: 600,
        moving_time: 240,
      }),
    );

    const pattern = patternFrom(runs);
    expect(pattern.sampleSize).toBe(8);
  });

  it('limita a janela de análise quando weeks é informado', () => {
    const features = buildRoutine().map((run) => buildActivityFeatures(run));

    const defaultPattern = buildTrainingPattern(features, { now: NOW });
    const recentPattern = buildTrainingPattern(features, {
      now: NOW,
      weeks: 3,
    });

    expect(defaultPattern.sampleSize).toBe(48);
    expect(recentPattern.sampleSize).toBe(13);
    expect(recentPattern.weeksAnalyzed).toBe(3);
  });
});
