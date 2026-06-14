import "server-only";

type OpenAIModelPrice = {
  inputUsdPerMillionTokens: number;
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
};

export function estimateOpenAICostUsd({
  model,
  promptTokens,
  completionTokens,
}: {
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
}) {
  const modelPrice = pricesByModel[model];

  if (!modelPrice || promptTokens === null || completionTokens === null) {
    return null;
  }

  const estimatedCost =
    (promptTokens / 1_000_000) * modelPrice.inputUsdPerMillionTokens +
    (completionTokens / 1_000_000) * modelPrice.outputUsdPerMillionTokens;

  return Number(estimatedCost.toFixed(6));
}
