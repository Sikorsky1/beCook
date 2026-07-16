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
    inputUsdPerMillionTokens: 5,
    cachedInputUsdPerMillionTokens: 0.5,
    outputUsdPerMillionTokens: 30,
  },
  "gpt-5.6-terra": {
    inputUsdPerMillionTokens: 2.5,
    cachedInputUsdPerMillionTokens: 0.25,
    outputUsdPerMillionTokens: 15,
  },
  "gpt-5.6": {
    inputUsdPerMillionTokens: 5,
    cachedInputUsdPerMillionTokens: 0.5,
    outputUsdPerMillionTokens: 30,
  },
};

export function estimateOpenAICostUsd({
  model,
  promptTokens,
  cachedPromptTokens,
  completionTokens,
}: {
  model: string;
  promptTokens: number | null;
  cachedPromptTokens?: number | null;
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
  const cachedInputRate =
    modelPrice.cachedInputUsdPerMillionTokens ??
    modelPrice.inputUsdPerMillionTokens;

  const estimatedCost =
    (uncachedPromptTokens / 1_000_000) *
      modelPrice.inputUsdPerMillionTokens +
    (normalizedCachedPromptTokens / 1_000_000) * cachedInputRate +
    (completionTokens / 1_000_000) * modelPrice.outputUsdPerMillionTokens;

  return Number(estimatedCost.toFixed(6));
}
