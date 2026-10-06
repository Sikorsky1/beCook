import "server-only";

import OpenAI from "openai";

export const importTimeoutMs = 25_000;
export const shoppingTimeoutMs = 35_000;

// Timeouts, lost connections and 5xx may succeed on a second try; 4xx (incl. 429) never retry.
export function isTransientOpenAIError(error: unknown) {
  return (
    error instanceof OpenAI.APIConnectionError ||
    (error instanceof OpenAI.APIError && (error.status ?? 0) >= 500)
  );
}

export async function withOneRetry<T>(
  call: () => Promise<T>,
  { signal, onAttempt }: { signal?: AbortSignal; onAttempt?: () => void } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    onAttempt?.();
    try {
      return await call();
    } catch (error) {
      if (attempt >= 2 || signal?.aborted || !isTransientOpenAIError(error)) throw error;
    }
  }
}
