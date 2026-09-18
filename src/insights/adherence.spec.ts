import { assessAdherence } from './adherence';

describe('assessAdherence', () => {
  it('returns null when planned or actual data is missing', () => {
    expect(
      assessAdherence({
        plannedDistance: 10000,
        plannedPace: 350,
        actualDistance: 10000,
      }),
    ).toBeNull();

    expect(
      assessAdherence({
        plannedDistance: 0,
        plannedPace: 350,
        actualDistance: 10000,
        actualPace: 350,
      }),
    ).toBeNull();
  });

  it('classifies runs within 10% distance and 5% pace as on plan', () => {
    const adherence = assessAdherence({
      plannedDistance: 10000,
      plannedPace: 350,
      actualDistance: 10800,
      actualPace: 360,
    });

    expect(adherence?.verdict).toBe('no_plano');
    expect(adherence?.distanceDiff).toBeCloseTo(0.08, 6);
    expect(adherence?.paceDiff).toBeCloseTo(10 / 350, 6);
  });

  it('classifies runs within 20% distance or 10% pace as close', () => {
    const adherence = assessAdherence({
      plannedDistance: 10000,
      plannedPace: 350,
      actualDistance: 11500,
      actualPace: 400,
    });

    expect(adherence?.verdict).toBe('proximo');
  });

  it('classifies runs beyond the tolerance as different', () => {
    const adherence = assessAdherence({
      plannedDistance: 10000,
      plannedPace: 350,
      actualDistance: 4000,
      actualPace: 300,
    });

    expect(adherence?.verdict).toBe('diferente');
  });
});
