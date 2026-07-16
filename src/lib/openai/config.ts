import "server-only";

const DEFAULT_OPENAI_MODEL = "gpt-5.6-sol";
const DEFAULT_OPENAI_FALLBACK_MODEL = "gpt-5.6-terra";
const DEFAULT_OPENAI_REASONING_EFFORT = "high";

export type OpenAIReasoningEffort =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

const validOpenAIReasoningEfforts = new Set<OpenAIReasoningEffort>([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function readModelEnvValue(value: string | undefined, fallback: string) {
  const model = value?.trim();

  return model || fallback;
}

function readReasoningEffortEnvValue(
  value: string | undefined,
): OpenAIReasoningEffort {
  const reasoningEffort = value?.trim();

  return validOpenAIReasoningEfforts.has(
    reasoningEffort as OpenAIReasoningEffort,
  )
    ? (reasoningEffort as OpenAIReasoningEffort)
    : DEFAULT_OPENAI_REASONING_EFFORT;
}

export const OPENAI_MODEL = readModelEnvValue(
  process.env.OPENAI_MODEL,
  DEFAULT_OPENAI_MODEL,
);

export const OPENAI_FALLBACK_MODEL = readModelEnvValue(
  process.env.OPENAI_FALLBACK_MODEL,
  DEFAULT_OPENAI_FALLBACK_MODEL,
);

export const OPENAI_REASONING_EFFORT = readReasoningEffortEnvValue(
  process.env.OPENAI_REASONING_EFFORT,
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
