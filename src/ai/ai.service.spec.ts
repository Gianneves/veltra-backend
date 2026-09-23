import { Test, TestingModule } from '@nestjs/testing';
import { AiService, splitCoachReply } from './ai.service';

describe('AiService', () => {
  let service: AiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AiService],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

describe('splitCoachReply', () => {
  it('extracts the proposal block and removes it from the text', () => {
    const result = splitCoachReply(
      'Vamos ajustar seu treino.\n<proposta>{"session":2,"changes":{"plannedDistance":8000},"reason":"cautela"}</proposta>',
    );

    expect(result.text).toBe('Vamos ajustar seu treino.');
    expect(result.proposal).toEqual({
      session: 2,
      changes: { plannedDistance: 8000 },
      reason: 'cautela',
    });
  });

  it('returns plain text when there is no proposal', () => {
    const result = splitCoachReply('Só um conselho.');

    expect(result.text).toBe('Só um conselho.');
    expect(result.proposal).toBeNull();
  });

  it('ignores malformed proposal blocks', () => {
    const result = splitCoachReply('Texto.\n<proposta>não é json</proposta>');

    expect(result.text).toBe('Texto.');
    expect(result.proposal).toBeNull();
    expect(result.proposals).toEqual([]);
    expect(result.malformed).toBe(true);
  });

  it('drops unknown change fields', () => {
    const result = splitCoachReply(
      '<proposta>{"session":1,"changes":{"completed":true,"plannedPace":330},"reason":"x"}</proposta>',
    );

    expect(result.proposal?.changes).toEqual({ plannedPace: 330 });
  });

  it('parses an array of proposals keeping legacy first', () => {
    const result = splitCoachReply(
      'Ajustes.\n<proposta>[{"session":1,"changes":{"plannedDistance":8000},"reason":"leve"},{"session":2,"changes":{"day":"Sex"},"reason":"agenda"}]</proposta>',
    );

    expect(result.text).toBe('Ajustes.');
    expect(result.proposals).toHaveLength(2);
    expect(result.proposals[1]).toMatchObject({ session: 2 });
    expect(result.proposal).toEqual(result.proposals[0]);
    expect(result.malformed).toBe(false);
  });

  it('caps proposals at the maximum and flags overflow', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      session: i + 1,
      changes: { notes: `ajuste ${i + 1}` },
      reason: 'x',
    }));
    const result = splitCoachReply(
      `Ok.\n<proposta>${JSON.stringify(items)}</proposta>`,
    );

    expect(result.proposals).toHaveLength(5);
    expect(result.malformed).toBe(true);
  });
});
