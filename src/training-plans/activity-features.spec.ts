import { Activity } from 'src/activities/entities/activity.entity';
import {
  buildActivityFeatures,
  classifyRunType,
  repSizesFromText,
} from './activity-features';

function lapsFrom(paces: number[], distance = 1000) {
  return paces.map((pace) => ({
    distance,
    moving_time: Math.round((pace * distance) / 1000),
    elapsed_time: Math.round((pace * distance) / 1000),
  }));
}

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'activity-1',
    activityStravaId: 1,
    name: 'Corrida',
    type: 'Run',
    sport_type: 'Run',
    distance: 8000,
    moving_time: 2800,
    elapsed_time: 2800,
    start_date_local: new Date(2026, 8, 15, 7, 0),
    ...overrides,
  } as Activity;
}

describe('repSizesFromText', () => {
  it('extrai repetições em metros, km e minutos', () => {
    expect(repSizesFromText('5x800')).toEqual(['800m']);
    expect(repSizesFromText('4x1km')).toEqual(['1000m']);
    expect(repSizesFromText('6x(2min forte)')).toEqual(['2min']);
    expect(repSizesFromText('rodagem leve')).toEqual([]);
  });
});

describe('classifyRunType', () => {
  it('detecta intervalado pelo nome com repetições', () => {
    const features = buildActivityFeatures(makeActivity({ name: '5x800' }));
    expect(classifyRunType(features)).toBe('interval');
  });

  it('detecta intervalado por variação das voltas com nome genérico', () => {
    const laps = Array.from({ length: 6 }).flatMap(() =>
      lapsFrom([240, 420], 400),
    );
    const features = buildActivityFeatures(
      makeActivity({
        name: 'Corrida',
        laps,
        distance: 4800,
        moving_time: 1584,
      }),
    );

    expect(features.shape).toBe('interval');
    expect(classifyRunType(features)).toBe('interval');
  });

  it('detecta tempo run pelo nome', () => {
    const features = buildActivityFeatures(
      makeActivity({ name: 'Tempo run 6km' }),
    );
    expect(classifyRunType(features)).toBe('tempo');
  });

  it('detecta tempo por bloco sustentado nas voltas', () => {
    const laps = lapsFrom([365, 355, 330, 330, 345, 365]);
    const features = buildActivityFeatures(
      makeActivity({
        name: 'Corrida',
        laps,
        distance: 6000,
        moving_time: 2090,
      }),
    );

    expect(features.fastLapStreak).toBeGreaterThanOrEqual(2);
    expect(features.hardLapMedianPace).toBe(330);
    expect(classifyRunType(features)).toBe('tempo');
  });

  it('detecta fartlek antes de intervalado', () => {
    const features = buildActivityFeatures(
      makeActivity({ name: 'Fartlek 8x1' }),
    );
    expect(classifyRunType(features)).toBe('fartlek');
  });

  it('detecta longão por nome mesmo sem acento', () => {
    const features = buildActivityFeatures(
      makeActivity({
        name: 'Longao de domingo',
        distance: 17000,
        moving_time: 6460,
      }),
    );
    expect(classifyRunType(features)).toBe('long');
  });

  it('detecta longão pela distância com nome genérico', () => {
    const features = buildActivityFeatures(
      makeActivity({ name: 'Corrida', distance: 16000, moving_time: 6080 }),
    );
    expect(classifyRunType(features, { longKm: 12 })).toBe('long');
  });

  it('detecta corrida leve em volume curto', () => {
    const features = buildActivityFeatures(
      makeActivity({ name: 'Corrida leve', distance: 7000, moving_time: 2660 }),
    );
    expect(classifyRunType(features, { longKm: 12 })).toBe('easy');
  });
});
