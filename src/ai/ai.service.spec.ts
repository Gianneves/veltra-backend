import { Test, TestingModule } from '@nestjs/testing';
import { AiService, splitCoachReply } from './ai.service';
import {
  AiProvider,
  AiProviderUnavailableError,
  type AiProviderRequest,
  type AiProviderResult,
} from './ai-provider';
import { OpenAiProvider } from './openai-provider';
import type { AiTier, AiTask } from './model-router';

type FakeProvider = {
  decide: jest.Mock;
  complete: jest.Mock;
  stream: jest.Mock;
  canEscalate: jest.Mock;
};

const INSIGHT_JSON = JSON.stringify({
  summary: 'Resumo',
  performance: 'Performance',
  workoutType: 'Leve',
  plan: null,
  tips: ['Dica'],
});

const PLAN_REVIEW_JSON = JSON.stringify({
  overview: 'Visão geral',
  weeks: [
    {
      weekStart: '2026-11-23',
      focus: 'Base',
      rationale: 'Rationale',
      tips: [{ dia: 'Seg', dica: 'Dica' }],
    },
  ],
});

const MATCH_JSON = JSON.stringify({ sessionId: 'session-1', reason: 'ok' });

function result(text: string, tier: AiTier = 'cheap'): AiProviderResult {
  return {
    text,
    decision: {
      tier,
      model: tier === 'premium' ? 'gpt-4o' : 'gpt-4o-mini',
      reason: 'test',
    },
    usage: { total_tokens: 1 },
  };
}

function textForTask(task: AiTask): string {
  switch (task) {
    case 'activity_insight':
      return INSIGHT_JSON;
    case 'plan_review':
      return PLAN_REVIEW_JSON;
    case 'activity_match':
      return MATCH_JSON;
    case 'coach_reply':
      return 'Resposta do coach';
    default:
      return 'Texto genérico';
  }
}

describe('AiService', () => {
  let service: AiService;
  let provider: FakeProvider;
  let openAi: { createEmbedding: jest.Mock };
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    provider = {
      decide: jest.fn(() => ({
        tier: 'cheap' as const,
        model: 'gpt-4o-mini',
        reason: 'test',
      })),
      complete: jest.fn((request: AiProviderRequest) =>
        Promise.resolve(result(textForTask(request.task))),
      ),
      stream: jest.fn(
        (
          request: AiProviderRequest,
          tier: AiTier,
          onToken: (token: string) => void,
        ) => {
          const text = textForTask(request.task);
          onToken(text);
          return Promise.resolve(result(text, tier));
        },
      ),
      canEscalate: jest.fn(() => true),
    };
    openAi = { createEmbedding: jest.fn(() => Promise.resolve([0.1, 0.2])) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: AiProvider, useValue: provider },
        { provide: OpenAiProvider, useValue: openAi },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('pede cada tarefa ao fornecedor com o prompt, a temperatura, o teto e o timeout do LLD', async () => {
    const completeCalls = provider.complete.mock.calls as unknown as Array<
      [AiProviderRequest, AiTier]
    >;
    const streamCalls = provider.stream.mock.calls as unknown as Array<
      [AiProviderRequest, AiTier, (token: string) => void]
    >;
    const lastComplete = () => completeCalls[completeCalls.length - 1][0];
    const lastStream = () => streamCalls[streamCalls.length - 1]?.[0];

    const expectRequest = (
      request: AiProviderRequest | undefined,
      expected: {
        task: AiTask;
        temperature: number;
        maxTokens: number;
        timeoutMs: number;
        systemStartsWith: string;
        lastContent: string;
      },
    ) => {
      expect(request).toBeDefined();
      expect(request?.task).toBe(expected.task);
      expect(request?.temperature).toBe(expected.temperature);
      expect(request?.maxTokens).toBe(expected.maxTokens);
      expect(request?.timeoutMs).toBe(expected.timeoutMs);
      expect(request?.routing.task).toBe(expected.task);
      expect(request?.messages[0].role).toBe('system');
      expect(
        request?.messages[0].content.startsWith(expected.systemStartsWith),
      ).toBe(true);
      expect(request?.messages[request.messages.length - 1]).toEqual({
        role: 'user',
        content: expected.lastContent,
      });
    };

    await service.generateInsight('contexto genérico');
    expectRequest(lastComplete(), {
      task: 'generic',
      temperature: 0,
      maxTokens: 700,
      timeoutMs: 0,
      systemStartsWith: "You're an experienced running coach",
      lastContent: 'contexto genérico',
    });

    await service.generateActivityInsight('contexto da corrida');
    expectRequest(lastComplete(), {
      task: 'activity_insight',
      temperature: 0.3,
      maxTokens: 900,
      timeoutMs: 30000,
      systemStartsWith:
        'Você é o Veltra Coach, treinador de corrida experiente. Analise a corrida',
      lastContent: 'contexto da corrida',
    });

    await service.generatePlanReview('contexto do plano');
    expectRequest(lastComplete(), {
      task: 'plan_review',
      temperature: 0.2,
      maxTokens: 2000,
      timeoutMs: 45000,
      systemStartsWith:
        'Você é o Veltra Coach, treinador de corrida experiente. Analise o plano',
      lastContent: 'contexto do plano',
    });

    await service.classifyActivityMatch('contexto do pareamento');
    expectRequest(lastComplete(), {
      task: 'activity_match',
      temperature: 0,
      maxTokens: 300,
      timeoutMs: 20000,
      systemStartsWith: 'Você é o Veltra Coach. Dada uma atividade realizada',
      lastContent: 'contexto do pareamento',
    });

    const systemPrompt = 'Prompt do coach';
    const history = [
      { role: 'user' as const, content: 'oi' },
      { role: 'coach' as const, content: 'olá' },
    ];

    await service.generateCoachReplyStream(
      systemPrompt,
      history,
      'como estou?',
      () => undefined,
    );
    expectRequest(lastStream(), {
      task: 'coach_reply',
      temperature: 0.3,
      maxTokens: 1400,
      timeoutMs: 60000,
      systemStartsWith: systemPrompt,
      lastContent: 'como estou?',
    });
    expect(lastStream()?.messages).toEqual([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: 'olá' },
      { role: 'user', content: 'como estou?' },
    ]);

    const tokens: string[] = [];
    await service.generateCoachReplyStream(
      systemPrompt,
      history,
      'como estou?',
      (token) => tokens.push(token),
    );
    expectRequest(lastStream(), {
      task: 'coach_reply',
      temperature: 0.3,
      maxTokens: 1400,
      timeoutMs: 60000,
      systemStartsWith: systemPrompt,
      lastContent: 'como estou?',
    });
    expect(tokens).toEqual(['Resposta do coach']);
  });

  it('escala para o premium quando o texto do cheap não passa no parser', async () => {
    provider.complete
      .mockResolvedValueOnce(result('não é json'))
      .mockResolvedValueOnce(result(INSIGHT_JSON, 'premium'));

    const content = await service.generateActivityInsight('contexto');
    const completeCalls = provider.complete.mock.calls as unknown as Array<
      [AiProviderRequest, AiTier]
    >;

    expect(content?.summary).toBe('Resumo');
    expect(provider.complete).toHaveBeenCalledTimes(2);
    expect(completeCalls[0][1]).toBe('cheap');
    expect(completeCalls[1][1]).toBe('premium');
  });

  it('repete no premium quando o streaming falha antes do primeiro token', async () => {
    provider.stream
      .mockRejectedValueOnce(
        new AiProviderUnavailableError(
          'openai',
          'transport',
          undefined,
          new Error('boom'),
        ),
      )
      .mockImplementationOnce(
        (
          _request: AiProviderRequest,
          tier: AiTier,
          onToken: (token: string) => void,
        ) => {
          onToken('Resposta premium');
          return Promise.resolve(result('Resposta premium', tier));
        },
      );

    const reply = await service.generateCoachReplyStream(
      'Prompt do coach',
      [],
      'oi',
      () => undefined,
    );
    const streamCalls = provider.stream.mock.calls as unknown as Array<
      [AiProviderRequest, AiTier, (token: string) => void]
    >;

    expect(reply?.text).toBe('Resposta premium');
    expect(provider.stream).toHaveBeenCalledTimes(2);
    expect(streamCalls[0][1]).toBe('cheap');
    expect(streamCalls[1][1]).toBe('premium');
  });

  it('devolve o texto parcial quando o streaming falha depois do primeiro token', async () => {
    provider.stream.mockImplementationOnce(
      (
        _request: AiProviderRequest,
        _tier: AiTier,
        onToken: (token: string) => void,
      ) => {
        onToken('Texto parcial');
        throw new AiProviderUnavailableError(
          'openai',
          'transport',
          undefined,
          new Error('boom'),
        );
      },
    );

    const reply = await service.generateCoachReplyStream(
      'Prompt do coach',
      [],
      'oi',
      () => undefined,
    );

    expect(reply?.text).toBe('Texto parcial');
    expect(provider.stream).toHaveBeenCalledTimes(1);
  });

  it('gera o embedding pelo adaptador do OpenAI sem passar pela porta', async () => {
    const vector = await service.createEmbedding('texto   com espaços');

    expect(vector).toEqual([0.1, 0.2]);
    expect(openAi.createEmbedding).toHaveBeenCalledWith('texto   com espaços');
    expect(provider.decide).not.toHaveBeenCalled();
    expect(provider.complete).not.toHaveBeenCalled();
    expect(provider.stream).not.toHaveBeenCalled();
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

  it('tolerates code fences and trailing commas in the block', () => {
    const result = splitCoachReply(
      'Ajustes.\n<proposta>```json\n[{"session":1,"changes":{"plannedDistance":8000,},"reason":"leve",}]\n```</proposta>',
    );

    expect(result.text).toBe('Ajustes.');
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      session: 1,
      changes: { plannedDistance: 8000 },
    });
    expect(result.malformed).toBe(false);
  });
});
