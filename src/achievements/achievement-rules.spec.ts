import type { Activity } from 'src/activities/entities/activity.entity';
import {
  buildBestEfforts,
  buildPredictions,
  buildTrophies,
} from './achievement-rules';

function run(overrides: Partial<Activity>): Activity {
  return {
    id: 'activity-1',
    name: 'Corrida',
    type: 'Run',
    sport_type: 'Run',
    distance: 5000,
    moving_time: 1500,
    start_date: new Date('2026-01-04T10:00:00Z'),
    ...overrides,
  } as Activity;
}

function daysAfter(base: Date, days: number): Date {
  const date = new Date(base);
  date.setDate(date.getDate() + days);
  return date;
}

describe('achievement rules', () => {
  describe('buildBestEfforts', () => {
    it('projects the best pace among runs that covered each distance', () => {
      const runs = [
        run({ id: 'fast', distance: 5000, moving_time: 1500 }),
        run({ id: 'long', distance: 10000, moving_time: 3300 }),
        run({ id: 'short', distance: 2000, moving_time: 500 }),
        run({ id: 'glitch', distance: 5000, moving_time: 200 }),
      ];

      const efforts = buildBestEfforts(runs);

      expect(efforts.map((effort) => effort.distanceKm)).toEqual([3, 5, 10]);

      const fiveKm = efforts.find((effort) => effort.distanceKm === 5);
      expect(fiveKm).toMatchObject({
        paceSecondsPerKm: 300,
        timeSeconds: 1500,
        activityId: 'fast',
      });

      const tenKm = efforts.find((effort) => effort.distanceKm === 10);
      expect(tenKm).toMatchObject({
        paceSecondsPerKm: 330,
        timeSeconds: 3300,
        activityId: 'long',
      });

      const threeKm = efforts.find((effort) => effort.distanceKm === 3);
      expect(threeKm?.timeSeconds).toBe(900);
    });

    it('returns no effort when no run covered the distance', () => {
      const efforts = buildBestEfforts([
        run({ distance: 2000, moving_time: 600 }),
      ]);

      expect(efforts).toEqual([]);
    });
  });

  describe('buildPredictions', () => {
    const now = new Date('2026-07-01T12:00:00Z');

    it('predicts every record distance from recent runs', () => {
      const runs = [
        run({
          distance: 5000,
          moving_time: 1500,
          start_date: daysAfter(now, -10),
        }),
      ];

      const predictions = buildPredictions(runs, now);

      expect(predictions.map((prediction) => prediction.distanceKm)).toEqual([
        3, 5, 10, 15, 21.0975, 42.195,
      ]);

      const tenKm = predictions.find(
        (prediction) => prediction.distanceKm === 10,
      );
      expect(tenKm?.basedOnDistanceKm).toBe(4);
      expect(tenKm?.timeSeconds).toBeCloseTo(
        300 * Math.pow(10 / 4, 0.06) * 10,
        5,
      );
    });

    it('ignores runs older than the recent-form window', () => {
      const runs = [
        run({
          distance: 10000,
          moving_time: 3000,
          start_date: daysAfter(now, -200),
        }),
      ];

      expect(buildPredictions(runs, now)).toEqual([]);
    });
  });

  describe('buildTrophies', () => {
    it('awards the first run and the first century crossing date', () => {
      const first = new Date('2024-01-10T10:00:00Z');
      const crossing = new Date('2024-03-05T10:00:00Z');

      const trophies = buildTrophies([
        run({
          id: 'r1',
          distance: 60000,
          moving_time: 18000,
          start_date: first,
        }),
        run({
          id: 'r2',
          distance: 50000,
          moving_time: 15000,
          start_date: crossing,
        }),
      ]);

      const firstStep = trophies.find((trophy) => trophy.id === 'first-step');
      expect(firstStep?.earned).toBe(true);
      expect(firstStep?.earnedDate).toBe(first.toISOString());

      const century = trophies.find((trophy) => trophy.id === 'century');
      expect(century?.earned).toBe(true);
      expect(century?.earnedDate).toBe(crossing.toISOString());
      expect(century?.progress?.current).toBe(100);
    });

    it('does not award the marathon without a marathon-distance run', () => {
      const trophies = buildTrophies([
        run({ distance: 20000, moving_time: 6000 }),
      ]);

      const marathoner = trophies.find((trophy) => trophy.id === 'marathoner');
      expect(marathoner?.earned).toBe(false);
      expect(marathoner?.progress?.current).toBe(20);
      expect(marathoner?.progress?.target).toBe(42.195);
    });

    it('awards consistency after 12 consecutive weeks with runs', () => {
      const start = new Date('2026-01-04T10:00:00Z');
      const runs = Array.from({ length: 12 }, (_, index) =>
        run({
          id: `week-${index}`,
          distance: 5000,
          moving_time: 1500,
          start_date: daysAfter(start, index * 7),
        }),
      );

      const trophies = buildTrophies(runs);
      const consistent = trophies.find((trophy) => trophy.id === 'consistent');

      expect(consistent?.earned).toBe(true);
      expect(consistent?.progress?.current).toBe(12);
      expect(consistent?.earnedDate).toBe(daysAfter(start, 77).toISOString());
    });

    it('awards the sprinter badge only under 20 minutes for 5 km', () => {
      const earned = buildTrophies([
        run({ distance: 5000, moving_time: 1199 }),
      ]).find((trophy) => trophy.id === 'sprinter');
      expect(earned?.earned).toBe(true);

      const locked = buildTrophies([
        run({ distance: 5000, moving_time: 1200 }),
      ]).find((trophy) => trophy.id === 'sprinter');
      expect(locked?.earned).toBe(false);
      expect(locked?.progress?.current).toBe(1200);
      expect(locked?.progress?.higherIsBetter).toBe(false);
    });
  });
});
