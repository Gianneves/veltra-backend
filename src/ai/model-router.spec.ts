import { AiModelRouter } from './model-router';

describe('AiModelRouter', () => {
  const router = new AiModelRouter();
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.OPENAI_MODEL_ROUTING;
    delete process.env.OPENAI_MODEL_CHEAP;
    delete process.env.OPENAI_MODEL_PREMIUM;
    delete process.env.OPENAI_MODEL_ESCALATION;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses the cheap model for structured activity matching', () => {
    const decision = router.decide({ task: 'activity_match' });

    expect(decision.tier).toBe('cheap');
    expect(decision.model).toBe('gpt-4o-mini');
  });

  it('uses the premium model for plan reviews', () => {
    const decision = router.decide({ task: 'plan_review' });

    expect(decision.tier).toBe('premium');
    expect(decision.model).toBe('gpt-4o');
  });

  it('keeps simple coach chat on the cheap tier', () => {
    const decision = router.decide({
      task: 'coach_reply',
      text: 'Qual foi meu pace médio na última corrida?',
    });

    expect(decision.tier).toBe('cheap');
  });

  it('escalates coach chat when the athlete asks for plan changes', () => {
    const decision = router.decide({
      task: 'coach_reply',
      text: 'Pode reduzir o treino de quarta para 8 km?',
    });

    expect(decision.tier).toBe('premium');
    expect(decision.reason).toBe('plan_negotiation');
  });

  it('escalates coach chat on health signals', () => {
    const decision = router.decide({
      task: 'coach_reply',
      text: 'Sinto dor no joelho ao correr.',
    });

    expect(decision.tier).toBe('premium');
    expect(decision.reason).toBe('health_context');
  });

  it('escalates long insight contexts', () => {
    const decision = router.decide({
      task: 'activity_insight',
      contextLength: 9000,
    });

    expect(decision.tier).toBe('premium');
    expect(decision.reason).toBe('long_context');
  });

  it('honors the forced cheap routing mode', () => {
    process.env.OPENAI_MODEL_ROUTING = 'cheap';

    const decision = router.decide({ task: 'plan_review' });

    expect(decision.tier).toBe('cheap');
    expect(decision.reason).toBe('routing_forced_cheap');
  });

  it('reads model names from the environment', () => {
    process.env.OPENAI_MODEL_CHEAP = 'gpt-4.1-nano';
    process.env.OPENAI_MODEL_PREMIUM = 'gpt-4.1';

    expect(router.modelName('cheap')).toBe('gpt-4.1-nano');
    expect(router.modelName('premium')).toBe('gpt-4.1');
  });

  it('disables escalation only when explicitly set to false', () => {
    expect(router.escalationEnabled()).toBe(true);

    process.env.OPENAI_MODEL_ESCALATION = 'false';
    expect(router.escalationEnabled()).toBe(false);
  });
});
