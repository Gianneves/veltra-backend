import { Test, TestingModule } from '@nestjs/testing';
import { AiService, splitCoachReply } from './ai.service';
import {
  AiProvider,
  AiProviderUnavailableError,
  type AiProviderName,
  type AiProviderRequest,
  type AiProviderResult,
} from './ai-provider';
import { AiFailoverService } from './ai-failover.service';
import { AiProviderStateService } from './ai-provider-state.service';
import { DeepSeekProvider } from './deepseek-provider';
import { OpenAiProvider } from './openai-provider';
import type { RedisService } from 'src/redis/redis.service';
import type { AiTier, AiTask, ModelDecision } from './model-router';

type FakeProvider = {
  decide: jest.Mock<ModelDecision, [AiProviderRequest]>;
  complete: jest.Mock<Promise<AiProviderResult>, [AiProviderRequest, AiTier]>;
  stream: jest.Mock<
    Promise<AiProviderResult>,
    [AiProviderRequest, AiTier, (token: string) => void]
  >;
  canEscalate: jest.Mock<boolean, [AiProviderName]>;
  isConfigured: jest.Mock<boolean, []>;
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

function result(
  text: string,
  tier: AiTier = 'cheap',
  provider: AiProviderName = 'openai',
): AiProviderResult {
  return {
    text,
    decision: {
      tier,
      model: tier === 'premium' ? 'gpt-4o' : 'gpt-4o-mini',
      reason: 'test',
    },
    usage: { total_tokens: 1 },
    provider,
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

function completeCalls(
  provider: FakeProvider,
): Array<[AiProviderRequest, AiTier]> {
  return provider.complete.mock.calls;
}

function streamCalls(
  provider: FakeProvider,
): Array<[AiProviderRequest, AiTier, (token: string) => void]> {
  return provider.stream.mock.calls;
}

describe('AiService', () => {
  let service: AiService;
  let provider: FakeProvider;
  let openAi: { createEmbedding: jest.Mock };
  const originalApiKey = process.env.OPENAI_API_KEY;

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
      isConfigured: jest.fn(() => true),
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
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('pede cada tarefa ao fornecedor com o prompt, a temperatura, o teto e o timeout do LLD', async () => {
    const complete = completeCalls(provider);
    const streamed = streamCalls(provider);
    const lastComplete = () => complete[complete.length - 1][0];
    const lastStream = () => streamed[streamed.length - 1]?.[0];

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
    const complete = completeCalls(provider);

    expect(content?.summary).toBe('Resumo');
    expect(provider.complete).toHaveBeenCalledTimes(2);
    expect(complete[0][1]).toBe('cheap');
    expect(complete[1][1]).toBe('premium');
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
    const streamed = streamCalls(provider);

    expect(reply?.text).toBe('Resposta premium');
    expect(provider.stream).toHaveBeenCalledTimes(2);
    expect(streamed[0][1]).toBe('cheap');
    expect(streamed[1][1]).toBe('premium');
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

describe('AiService com failover', () => {
  const PRIMARY_KEY = 'ai:provider:primary:down';
  const originalDeepSeek = process.env.DEEPSEEK_API_KEY;
  const originalCooldown = process.env.AI_FAILOVER_COOLDOWN_SECONDS;

  let primary: FakeProvider;
  let secondary: FakeProvider;
  let redis: {
    values: Map<string, string>;
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
  };
  let service: AiService;

  function providerDouble(provider: AiProviderName): FakeProvider {
    return {
      decide: jest.fn(() => ({
        tier: 'cheap' as const,
        model: provider === 'openai' ? 'gpt-4o-mini' : 'deepseek-chat',
        reason: 'test',
      })),
      complete: jest.fn((request: AiProviderRequest) =>
        Promise.resolve(result(textForTask(request.task), 'cheap', provider)),
      ),
      stream: jest.fn(
        (
          request: AiProviderRequest,
          tier: AiTier,
          onToken: (token: string) => void,
        ) => {
          const text = textForTask(request.task);
          onToken(text);
          return Promise.resolve(result(text, tier, provider));
        },
      ),
      canEscalate: jest.fn(() => provider === 'openai'),
      isConfigured: jest.fn(() => true),
    };
  }

  function fakeRedis() {
    const values = new Map<string, string>();
    return {
      values,
      get: jest.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
      set: jest.fn((key: string, value: string) => {
        values.set(key, value);
        return Promise.resolve();
      }),
      del: jest.fn((key: string) => {
        values.delete(key);
        return Promise.resolve();
      }),
    };
  }

  beforeEach(() => {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.AI_FAILOVER_COOLDOWN_SECONDS;

    primary = providerDouble('openai');
    secondary = providerDouble('deepseek');
    redis = fakeRedis();

    const state = new AiProviderStateService(redis as unknown as RedisService);
    const failover = new AiFailoverService(
      primary as unknown as OpenAiProvider,
      secondary as unknown as DeepSeekProvider,
      state,
    );
    service = new AiService(failover, {
      createEmbedding: jest.fn(() => Promise.resolve([])),
    } as unknown as OpenAiProvider);
  });

  afterEach(() => {
    if (originalDeepSeek === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalDeepSeek;

    if (originalCooldown === undefined)
      delete process.env.AI_FAILOVER_COOLDOWN_SECONDS;
    else process.env.AI_FAILOVER_COOLDOWN_SECONDS = originalCooldown;
  });

  it('atende pelo alternativo quando o principal falha, em cada caminho de texto', async () => {
    primary.complete.mockRejectedValue(
      new AiProviderUnavailableError('openai', 'http', 402),
    );
    primary.stream.mockRejectedValue(
      new AiProviderUnavailableError('openai', 'http', 402),
    );

    await expect(service.generateInsight('genérico')).resolves.toBe(
      'Texto genérico',
    );
    expect((await service.generateActivityInsight('corrida'))?.summary).toBe(
      'Resumo',
    );
    expect((await service.generatePlanReview('plano'))?.overview).toBe(
      'Visão geral',
    );
    expect((await service.classifyActivityMatch('pareamento'))?.sessionId).toBe(
      'session-1',
    );
    const reply = await service.generateCoachReplyStream(
      'Prompt',
      [],
      'oi',
      () => undefined,
    );

    expect(reply?.text).toBe('Resposta do coach');
    expect(reply?.provider).toBe('deepseek');
    expect(secondary.complete).toHaveBeenCalledTimes(4);
    expect(secondary.stream).toHaveBeenCalledTimes(1);
  });

  it('troca de fornecedor quando a resposta sem streaming vem vazia', async () => {
    primary.complete.mockResolvedValue(result('   '));

    expect((await service.generateActivityInsight('corrida'))?.summary).toBe(
      'Resumo',
    );
    expect(secondary.complete).toHaveBeenCalledTimes(1);
  });

  it('não troca de fornecedor em HTTP fora da lista', async () => {
    primary.complete.mockRejectedValue(
      new AiProviderUnavailableError('openai', 'http', 400),
    );

    await expect(
      service.generateActivityInsight('corrida'),
    ).resolves.toBeNull();
    expect(secondary.complete).not.toHaveBeenCalled();
  });

  it('vai direto ao alternativo dentro do cooldown e sonda o principal depois do prazo', async () => {
    primary.complete.mockRejectedValueOnce(
      new AiProviderUnavailableError('openai', 'http', 402),
    );

    await service.generateActivityInsight('corrida');

    expect(redis.set).toHaveBeenCalledTimes(1);
    const [key, value, ttl] = redis.set.mock.calls[0] as [
      string,
      string,
      number,
    ];
    expect(key).toBe(PRIMARY_KEY);
    expect(ttl).toBe(60);
    const until = Number(value);
    expect(until).toBeGreaterThan(Date.now());
    expect(until).toBeLessThanOrEqual(Date.now() + 60_000);

    await service.generateActivityInsight('corrida');
    expect(primary.complete).toHaveBeenCalledTimes(1);
    expect(secondary.complete).toHaveBeenCalledTimes(2);

    redis.values.set(PRIMARY_KEY, String(Date.now() - 1));
    primary.complete.mockResolvedValueOnce(result(INSIGHT_JSON));

    await service.generateActivityInsight('corrida');

    expect(primary.complete).toHaveBeenCalledTimes(2);
    expect(secondary.complete).toHaveBeenCalledTimes(2);
    expect(redis.del).toHaveBeenCalledWith(PRIMARY_KEY);
  });

  it('renova a marca quando a sonda falha', async () => {
    primary.complete
      .mockRejectedValueOnce(
        new AiProviderUnavailableError('openai', 'http', 402),
      )
      .mockRejectedValueOnce(
        new AiProviderUnavailableError('openai', 'http', 500),
      );

    await service.generateActivityInsight('corrida');
    redis.values.set(PRIMARY_KEY, String(Date.now() - 1));
    await service.generateActivityInsight('corrida');

    expect(redis.set).toHaveBeenCalledTimes(2);
    expect(secondary.complete).toHaveBeenCalledTimes(2);
  });

  it('escala para o premium no principal quando o cheap não passa no parser', async () => {
    primary.complete
      .mockResolvedValueOnce(result('não é json'))
      .mockResolvedValueOnce(result(INSIGHT_JSON, 'premium'));

    const content = await service.generateActivityInsight('corrida');

    expect(content?.summary).toBe('Resumo');
    expect(primary.complete).toHaveBeenCalledTimes(2);
    expect(primary.complete.mock.calls[1][1]).toBe('premium');
    expect(secondary.complete).not.toHaveBeenCalled();
  });

  it('não escala no alternativo quando o texto não passa no parser', async () => {
    primary.complete.mockRejectedValue(
      new AiProviderUnavailableError('openai', 'http', 402),
    );
    secondary.complete.mockResolvedValue(
      result('não é json', 'cheap', 'deepseek'),
    );

    await expect(
      service.generateActivityInsight('corrida'),
    ).resolves.toBeNull();
    expect(secondary.complete).toHaveBeenCalledTimes(1);
  });

  it('troca de fornecedor no streaming só antes do primeiro token', async () => {
    primary.stream.mockRejectedValueOnce(
      new AiProviderUnavailableError('openai', 'transport'),
    );

    const switched = await service.generateCoachReplyStream(
      'Prompt',
      [],
      'oi',
      () => undefined,
    );

    expect(switched?.text).toBe('Resposta do coach');
    expect(switched?.provider).toBe('deepseek');
    expect(secondary.stream).toHaveBeenCalledTimes(1);

    redis.values.clear();

    primary.stream.mockImplementationOnce(
      (
        _request: AiProviderRequest,
        _tier: AiTier,
        onToken: (token: string) => void,
      ) => {
        onToken('Texto parcial');
        throw new AiProviderUnavailableError('openai', 'transport');
      },
    );

    const partial = await service.generateCoachReplyStream(
      'Prompt',
      [],
      'oi',
      () => undefined,
    );

    expect(partial?.text).toBe('Texto parcial');
    expect(secondary.stream).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledTimes(2);
  });

  it('devolve a falha do fluxo e volta a tentar o principal quando os dois fornecedores falham', async () => {
    primary.complete.mockRejectedValue(
      new AiProviderUnavailableError('openai', 'http', 402),
    );
    secondary.complete.mockRejectedValue(
      new AiProviderUnavailableError('deepseek', 'http', 429),
    );

    await expect(
      service.generateActivityInsight('corrida'),
    ).resolves.toBeNull();
    expect(redis.del).toHaveBeenCalledWith(PRIMARY_KEY);

    primary.complete.mockResolvedValueOnce(result(INSIGHT_JSON));
    await service.generateActivityInsight('corrida');
    expect(primary.complete).toHaveBeenCalledTimes(2);
  });

  it('devolve a falha do chat quando os dois fornecedores falham', async () => {
    primary.stream.mockRejectedValue(
      new AiProviderUnavailableError('openai', 'http', 402),
    );
    secondary.stream.mockRejectedValue(
      new AiProviderUnavailableError('deepseek', 'http', 503),
    );

    const reply = await service.generateCoachReplyStream(
      'Prompt',
      [],
      'oi',
      () => undefined,
    );

    expect(reply).toBeNull();
    expect(redis.del).toHaveBeenCalledWith(PRIMARY_KEY);
  });

  it('atende pelo alternativo desde a primeira chamada sem a chave do OpenAI', async () => {
    primary.isConfigured.mockReturnValue(false);

    await expect(service.generateInsight('genérico')).resolves.toBe(
      'Texto genérico',
    );
    expect((await service.generateActivityInsight('corrida'))?.summary).toBe(
      'Resumo',
    );
    expect((await service.generatePlanReview('plano'))?.overview).toBe(
      'Visão geral',
    );
    expect((await service.classifyActivityMatch('pareamento'))?.sessionId).toBe(
      'session-1',
    );
    const reply = await service.generateCoachReplyStream(
      'Prompt',
      [],
      'oi',
      () => undefined,
    );

    expect(reply?.provider).toBe('deepseek');
    expect(primary.complete).not.toHaveBeenCalled();
    expect(primary.stream).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('segue sem IA quando nenhum fornecedor está configurado', async () => {
    primary.isConfigured.mockReturnValue(false);
    secondary.isConfigured.mockReturnValue(false);

    await expect(service.generateInsight('genérico')).resolves.toBeNull();
    await expect(
      service.generateActivityInsight('corrida'),
    ).resolves.toBeNull();
    await expect(service.generatePlanReview('plano')).resolves.toBeNull();
    await expect(
      service.classifyActivityMatch('pareamento'),
    ).resolves.toBeNull();
    await expect(
      service.generateCoachReplyStream('Prompt', [], 'oi', () => undefined),
    ).resolves.toBeNull();

    expect(service.isConfigured()).toBe(false);
    expect(secondary.complete).not.toHaveBeenCalled();
    expect(secondary.stream).not.toHaveBeenCalled();
  });

  it('continua tentando o principal a cada chamada com o Redis fora', async () => {
    redis.get.mockRejectedValue(new Error('redis down'));
    redis.set.mockRejectedValue(new Error('redis down'));
    primary.complete.mockRejectedValue(
      new AiProviderUnavailableError('openai', 'http', 402),
    );

    await service.generateActivityInsight('corrida');
    await service.generateActivityInsight('corrida');

    expect(primary.complete).toHaveBeenCalledTimes(2);
    expect(secondary.complete).toHaveBeenCalledTimes(2);
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
