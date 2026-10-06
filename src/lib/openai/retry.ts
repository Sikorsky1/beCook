import "server-only";

import OpenAI from "openai";

export const importTimeoutMs = 25_000;
// Shopping is extraction: low reasoning effort, one long attempt, no retry after a timeout.
export const shoppingTimeoutMs = 55_000;
export const shoppingReasoningEffort = "low" as const;
// A retry only makes sense when the first attempt failed fast (lost connection or quick 5xx).
export const shoppingQuickFailureMs = 10_000;

// Timeouts, lost connections and 5xx may succeed on a second try; 4xx (incl. 429) never retry.
export function isTransientOpenAIError(error: unknown) {
  return (
    error instanceof OpenAI.APIConnectionError ||
    (error instanceof OpenAI.APIError && (error.status ?? 0) >= 500)
  );
}

export async function withOneRetry<T>(
  call: () => Promise<T>,
  {
    signal,
    onAttempt,
    retryOnTimeout = true,
    maxFailureMsForRetry,
  }: {
    signal?: AbortSignal;
    onAttempt?: () => void;
    retryOnTimeout?: boolean;
    maxFailureMsForRetry?: number;
  } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    onAttempt?.();
    const startedAt = performance.now();
    try {
      return await call();
    } catch (error) {
      const timedOut = error instanceof OpenAI.APIConnectionTimeoutError;
      const slowFailure =
        maxFailureMsForRetry !== undefined && performance.now() - startedAt > maxFailureMsForRetry;
      if (
        attempt >= 2 ||
        signal?.aborted ||
        !isTransientOpenAIError(error) ||
        (timedOut && !retryOnTimeout) ||
        slowFailure
      ) {
        throw error;
      }
    }
  }
}
