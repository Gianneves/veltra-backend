import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import {
  AiProviderUnavailableError,
  type AiProviderMessage,
  type AiProviderName,
} from './ai-provider';

export function toProviderMessages(
  messages: AiProviderMessage[],
): BaseMessage[] {
  return messages.map((message) => {
    if (message.role === 'system') return new SystemMessage(message.content);
    if (message.role === 'assistant') return new AIMessage(message.content);
    return new HumanMessage(message.content);
  });
}

export function messageText(response: { content: unknown }): string {
  return typeof response.content === 'string'
    ? response.content
    : JSON.stringify(response.content);
}

export async function runProviderCall<T>(
  providerName: AiProviderName,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = startTimeout(timeoutMs, controller);

  try {
    return await run(controller.signal);
  } catch (err) {
    throw unavailable(providerName, err, timeout.timedOut());
  } finally {
    timeout.clear();
  }
}

function startTimeout(
  timeoutMs: number,
  controller: AbortController,
): { clear: () => void; timedOut: () => boolean } {
  if (timeoutMs <= 0) {
    return { clear: () => undefined, timedOut: () => false };
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    clear: () => clearTimeout(timer),
    timedOut: () => timedOut,
  };
}

function unavailable(
  providerName: AiProviderName,
  err: unknown,
  timedOut: boolean,
): AiProviderUnavailableError {
  if (err instanceof AiProviderUnavailableError) return err;

  if (timedOut) {
    return new AiProviderUnavailableError(
      providerName,
      'timeout',
      undefined,
      err,
    );
  }

  const status = statusOf(err);
  if (status !== undefined) {
    return new AiProviderUnavailableError(providerName, 'http', status, err);
  }

  return new AiProviderUnavailableError(
    providerName,
    'transport',
    undefined,
    err,
  );
}

function statusOf(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const record = err as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  };
  const status = record.status ?? record.statusCode ?? record.response?.status;
  return typeof status === 'number' ? status : undefined;
}
