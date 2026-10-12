import "server-only";

import { NextResponse } from "next/server";

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

// P35 / wave 8: OPENAI_BASE_URL only exists to point the local E2E run at the simulated OpenAI
// (tests/e2e/mock-openai.cjs). In any Vercel deployment (Production, Preview or Development) it
// would send prompts and the real key to another host, so an AI route must refuse before
// contacting OpenAI or opening a ledger row. next.config.ts also fails the Vercel build when both
// variables are present; this is the runtime guard for a variable added after the build.
export function openAIBaseUrlBlocked(env: Record<string, string | undefined> = process.env) {
  return Boolean(env.VERCEL_ENV?.trim()) && Boolean(env.OPENAI_BASE_URL?.trim());
}

const knownVercelEnvs = new Set(["production", "preview", "development"]);

// Null when the endpoint is allowed; otherwise a 503 for the route to return as is. The log
// carries the flow and the Vercel environment only: never the URL, the key or the request content.
export function blockedOpenAIEndpointResponse(flow: string, env: Record<string, string | undefined> = process.env) {
  if (!openAIBaseUrlBlocked(env)) return null;
  const vercelEnv = env.VERCEL_ENV?.trim() ?? "";
  console.error("openai_base_url_blocked", { flow, vercelEnv: knownVercelEnvs.has(vercelEnv) ? vercelEnv : "other" });
  return NextResponse.json(
    { error: "La generación con IA no está disponible temporalmente. Inténtalo más tarde." },
    { status: 503 },
  );
}
