import "server-only";

const DEFAULT_OPENAI_MODEL = "gpt-4.1-nano";
const DEFAULT_OPENAI_FALLBACK_MODEL = "gpt-4.1-mini";

function readModelEnvValue(value: string | undefined, fallback: string) {
  const model = value?.trim();

  return model || fallback;
}

export const OPENAI_MODEL = readModelEnvValue(
  process.env.OPENAI_MODEL,
  DEFAULT_OPENAI_MODEL,
);

export const OPENAI_FALLBACK_MODEL = readModelEnvValue(
  process.env.OPENAI_FALLBACK_MODEL,
  DEFAULT_OPENAI_FALLBACK_MODEL,
);

export function logOpenAIModelUsage(flow: string, model = OPENAI_MODEL) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  console.log("OpenAI model:", {
    flow,
    model,
    fallbackModel: OPENAI_FALLBACK_MODEL,
  });
}
