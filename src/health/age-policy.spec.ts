import {
  assessDistanceForAge,
  assessWeekForAge,
  calculateAge,
  checkupAdvice,
  planAgeAdjustment,
  predictedMaxHeartRate,
} from './age-policy';

describe('age-policy', () => {
  describe('calculateAge', () => {
    const reference = new Date('2026-09-19T12:00:00');

    it('considera mês e dia do aniversário', () => {
      expect(calculateAge('2000-09-19', reference)).toBe(26);
      expect(calculateAge('2000-09-20', reference)).toBe(25);
      expect(calculateAge('2000-10-01', reference)).toBe(25);
    });

    it('retorna undefined para datas ausentes ou inválidas', () => {
      expect(calculateAge(undefined, reference)).toBeUndefined();
      expect(calculateAge(null, reference)).toBeUndefined();
      expect(calculateAge('invalida', reference)).toBeUndefined();
    });
  });

  describe('assessDistanceForAge', () => {
    it('libera 10 km aos 15 anos apenas com liberação médica', () => {
      const assessment = assessDistanceForAge(10, 15);
      expect(assessment.allowed).toBe(true);
      expect(assessment.requiresMedicalClearance).toBe(true);
      expect(assessment.message).toContain('liberação médica');
    });

    it('exige liberação médica para meia maratona antes dos 18', () => {
      expect(assessDistanceForAge(21.1, 15).allowed).toBe(false);
      expect(assessDistanceForAge(21.1, 17).allowed).toBe(true);
      expect(assessDistanceForAge(21.1, 17).requiresMedicalClearance).toBe(
        true,
      );
      expect(assessDistanceForAge(21.1, 18).allowed).toBe(true);
      expect(assessDistanceForAge(21.1, 18).requiresMedicalClearance).toBe(
        false,
      );
    });

    it('bloqueia maratona antes dos 18', () => {
      expect(assessDistanceForAge(42.2, 16).allowed).toBe(false);
      expect(assessDistanceForAge(42.2, 18).allowed).toBe(true);
    });

    it('não restringe quando a idade é desconhecida', () => {
      const assessment = assessDistanceForAge(42.2, undefined);
      expect(assessment.allowed).toBe(true);
      expect(assessment.requiresMedicalClearance).toBe(false);
    });
  });

  describe('planAgeAdjustment', () => {
    it('aplica tetos para menores', () => {
      expect(planAgeAdjustment(13)?.maxLongRunKm).toBe(6);
      expect(planAgeAdjustment(15)?.maxWeeklyKm).toBe(25);
      expect(planAgeAdjustment(17)?.maxQualitySessions).toBe(1);
    });

    it('reduz volume para 60+', () => {
      expect(planAgeAdjustment(65)?.volumeFactor).toBe(0.9);
      expect(planAgeAdjustment(65)?.maxQualitySessions).toBe(2);
    });

    it('não ajusta adultos entre 18 e 59', () => {
      expect(planAgeAdjustment(30)).toBeUndefined();
      expect(planAgeAdjustment(59)).toBeUndefined();
    });
  });

  describe('assessWeekForAge', () => {
    it('avalia volume e qualidade da semana pelos limites absolutos da idade', () => {
      const volume = assessWeekForAge(23000, 1, 12);
      expect(volume.volumeExceeded).toBe(true);
      expect(volume.qualityExceeded).toBe(false);
      expect(volume.maxWeeklyKm).toBe(20);
      expect(volume.message).toContain('23,0 km de volume planejado');
      expect(volume.message).toContain('limite é 20 km');

      const quality = assessWeekForAge(9000, 3, 15);
      expect(quality.volumeExceeded).toBe(false);
      expect(quality.qualityExceeded).toBe(true);
      expect(quality.maxQualitySessions).toBe(1);
      expect(quality.message).toContain('3 sessões de qualidade');
      expect(quality.message).toContain('limite é 1');

      const older = assessWeekForAge(30000, 3, 65);
      expect(older.volumeExceeded).toBe(false);
      expect(older.qualityExceeded).toBe(true);
      expect(older.maxWeeklyKm).toBeUndefined();
      expect(older.maxQualitySessions).toBe(2);

      expect(assessWeekForAge(30000, 3, undefined)).toMatchObject({
        volumeExceeded: false,
        qualityExceeded: false,
      });
      expect(assessWeekForAge(30000, 3, 30)).toMatchObject({
        volumeExceeded: false,
        qualityExceeded: false,
      });
      expect(assessWeekForAge(30000, 3, 30).message).toBeUndefined();
    });
  });

  describe('predictedMaxHeartRate', () => {
    it('usa a fórmula de Tanaka', () => {
      expect(predictedMaxHeartRate(40)).toBe(180);
      expect(predictedMaxHeartRate(undefined)).toBeUndefined();
    });
  });

  describe('checkupAdvice', () => {
    it('sugere check-up a partir dos 35', () => {
      expect(checkupAdvice(35)?.severity).toBe('info');
      expect(checkupAdvice(46)?.severity).toBe('medical');
      expect(checkupAdvice(62)?.severity).toBe('medical');
      expect(checkupAdvice(30)).toBeUndefined();
    });
  });
});
