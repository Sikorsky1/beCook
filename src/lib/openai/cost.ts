import "server-only";

type OpenAIModelPrice = {
  inputUsdPerMillionTokens: number;
  cachedInputUsdPerMillionTokens?: number;
  outputUsdPerMillionTokens: number;
};

const pricesByModel: Record<string, OpenAIModelPrice> = {
  "gpt-4.1-nano": {
    inputUsdPerMillionTokens: 0.1,
    outputUsdPerMillionTokens: 0.4,
  },
  "gpt-4.1-mini": {
    inputUsdPerMillionTokens: 0.4,
    outputUsdPerMillionTokens: 1.6,
  },
  "gpt-5.6-sol": {
    inputUsdPerMillionTokens: 4,
    cachedInputUsdPerMillionTokens: 0.4,
    outputUsdPerMillionTokens: 20,
  },
  "gpt-5.6-terra": {
    inputUsdPerMillionTokens: 2,
    cachedInputUsdPerMillionTokens: 0.2,
    outputUsdPerMillionTokens: 12,
  },
  "gpt-5.6": {
    inputUsdPerMillionTokens: 4,
    cachedInputUsdPerMillionTokens: 0.4,
    outputUsdPerMillionTokens: 20,
  },
};

export function estimateOpenAICostUsd({
  model,
  promptTokens,
  cachedPromptTokens,
  cacheWriteTokens,
  completionTokens,
}: {
  model: string;
  promptTokens: number | null;
  cachedPromptTokens?: number | null;
  cacheWriteTokens?: number | null;
  completionTokens: number | null;
}) {
  const modelPrice = pricesByModel[model];

  if (!modelPrice || promptTokens === null || completionTokens === null) {
    return null;
  }

  const normalizedCachedPromptTokens = Math.min(
    Math.max(cachedPromptTokens ?? 0, 0),
    promptTokens,
  );
  const uncachedPromptTokens = promptTokens - normalizedCachedPromptTokens;
  const cacheWriteSurcharge = model.startsWith("gpt-5.6")
    ? Math.min(Math.max(cacheWriteTokens ?? 0, 0), uncachedPromptTokens) * modelPrice.inputUsdPerMillionTokens * 0.25 / 1_000_000
    : 0;
  const cachedInputRate =
    modelPrice.cachedInputUsdPerMillionTokens ??
    modelPrice.inputUsdPerMillionTokens;

  const estimatedCost =
    (uncachedPromptTokens / 1_000_000) *
      modelPrice.inputUsdPerMillionTokens +
    (normalizedCachedPromptTokens / 1_000_000) * cachedInputRate +
    (completionTokens / 1_000_000) * modelPrice.outputUsdPerMillionTokens + cacheWriteSurcharge;

  return Number(estimatedCost.toFixed(6));
}
