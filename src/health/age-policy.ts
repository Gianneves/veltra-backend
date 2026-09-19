export const HEALTH_DISCLAIMER =
  'Estas orientações são educativas e não substituem avaliação médica. Em caso de sintomas como dor no peito, desmaio ou falta de ar, interrompa o exercício e procure atendimento de emergência (SAMU 192).';

export interface DistanceAgeRule {
  label: string;
  minKm: number;
  maxKm: number;
  minAge: number;
  clearanceBelowAge: number;
}

export const DISTANCE_AGE_RULES: DistanceAgeRule[] = [
  {
    label: 'até 5 km',
    minKm: 0,
    maxKm: 5,
    minAge: 12,
    clearanceBelowAge: 14,
  },
  {
    label: '5 a 10 km',
    minKm: 5,
    maxKm: 10,
    minAge: 14,
    clearanceBelowAge: 16,
  },
  {
    label: '10 a 21,1 km',
    minKm: 10,
    maxKm: 21.1,
    minAge: 16,
    clearanceBelowAge: 18,
  },
  {
    label: 'acima de 21,1 km',
    minKm: 21.1,
    maxKm: Infinity,
    minAge: 18,
    clearanceBelowAge: 18,
  },
];

export function distanceAgeRule(distanceKm: number): DistanceAgeRule {
  if (distanceKm > 21.1) return DISTANCE_AGE_RULES[3];
  if (distanceKm > 10) return DISTANCE_AGE_RULES[2];
  if (distanceKm > 5) return DISTANCE_AGE_RULES[1];
  return DISTANCE_AGE_RULES[0];
}

export function calculateAge(
  birthDate?: string | null,
  reference: Date = new Date(),
): number | undefined {
  if (!birthDate) return undefined;

  const [year, month, day] = birthDate.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return undefined;

  let age = reference.getFullYear() - year;
  const monthDiff = reference.getMonth() + 1 - month;
  if (monthDiff < 0 || (monthDiff === 0 && reference.getDate() < day)) {
    age -= 1;
  }

  return age >= 0 && age <= 120 ? age : undefined;
}

export function predictedMaxHeartRate(age?: number): number | undefined {
  if (age === undefined || !Number.isFinite(age)) return undefined;
  return Math.round(208 - 0.7 * age);
}

export interface AgePlanAdjustment {
  age: number;
  maxLongRunKm?: number;
  maxWeeklyKm?: number;
  maxQualitySessions?: number;
  volumeFactor?: number;
  reason: string;
}

export function planAgeAdjustment(age?: number): AgePlanAdjustment | undefined {
  if (age === undefined || !Number.isFinite(age)) return undefined;

  if (age <= 13) {
    return {
      age,
      maxLongRunKm: 6,
      maxWeeklyKm: 20,
      maxQualitySessions: 1,
      reason:
        'Ajuste de segurança para a sua idade (até 13 anos): treinos de até 6 km, volume máximo de 20 km por semana e 1 estímulo forte por semana. Mantenha acompanhamento de um treinador e liberação médica.',
    };
  }

  if (age <= 15) {
    return {
      age,
      maxLongRunKm: 8,
      maxWeeklyKm: 25,
      maxQualitySessions: 1,
      reason:
        'Ajuste de segurança para a sua idade (14 a 15 anos): treinos de até 8 km, volume máximo de 25 km por semana e 1 estímulo forte por semana. Liberação médica recomendada antes de provas ou aumentos de carga.',
    };
  }

  if (age <= 17) {
    return {
      age,
      maxLongRunKm: 10,
      maxWeeklyKm: 35,
      maxQualitySessions: 1,
      reason:
        'Ajuste de segurança para a sua idade (16 a 17 anos): treinos de até 10 km, volume máximo de 35 km por semana e 1 estímulo forte por semana. Liberação médica recomendada para provas longas.',
    };
  }

  if (age >= 60) {
    return {
      age,
      volumeFactor: 0.9,
      maxQualitySessions: 2,
      reason:
        'Ajuste para atletas acima de 60 anos: volume reduzido em cerca de 10% e no máximo 2 estímulos fortes por semana, priorizando recuperação. Recomendamos avaliação médica antes de aumentar carga.',
    };
  }

  return undefined;
}

export interface AgeDistanceAssessment {
  age?: number;
  distanceKm: number;
  allowed: boolean;
  requiresMedicalClearance: boolean;
  recommendedMinAge: number;
  message?: string;
}

export function assessDistanceForAge(
  distanceKm: number,
  age?: number,
): AgeDistanceAssessment {
  const rule = distanceAgeRule(distanceKm);

  if (age === undefined || !Number.isFinite(age)) {
    return {
      distanceKm,
      allowed: true,
      requiresMedicalClearance: false,
      recommendedMinAge: rule.minAge,
    };
  }

  const allowed = age >= rule.minAge;
  const requiresMedicalClearance = allowed && age < rule.clearanceBelowAge;

  let message: string | undefined;
  if (!allowed) {
    message = `Corridas na faixa de ${rule.label} não são recomendadas antes dos ${rule.minAge} anos. Converse com um médico e um treinador antes de assumir esse desafio.`;
  } else if (requiresMedicalClearance) {
    message = `Para correr ${rule.label} com ${age} anos, é recomendável liberação médica antes de provas ou aumentos de carga.`;
  }

  return {
    age,
    distanceKm,
    allowed,
    requiresMedicalClearance,
    recommendedMinAge: rule.minAge,
    message,
  };
}

export function checkupAdvice(age?: number): {
  severity: 'info' | 'medical';
  message: string;
} | undefined {
  if (age === undefined || !Number.isFinite(age)) return undefined;

  if (age >= 60) {
    return {
      severity: 'medical',
      message:
        'Acima dos 60 anos, recomendamos avaliação médica (incluindo cardiológica) antes de aumentar volume ou intensidade.',
    };
  }

  if (age >= 45) {
    return {
      severity: 'medical',
      message:
        'A partir dos 45 anos, recomendamos avaliação cardiológica antes de provas longas ou aumentos importantes de intensidade.',
    };
  }

  if (age >= 35) {
    return {
      severity: 'info',
      message:
        'A partir dos 35 anos, recomendamos um check-up médico anual, especialmente cardiovascular, antes de evoluir a carga de treino.',
    };
  }

  return undefined;
}
