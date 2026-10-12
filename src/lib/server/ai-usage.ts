import "server-only";

import { createHmac, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { sendOpsAlert } from "@/lib/server/ops-alert";

export type AiFlow = "menu" | "import" | "shopping";

type FlowLimits = { daily: number | null; monthly: number | null };

export type AiUsageConfig = {
  flows: Record<AiFlow, FlowLimits>;
  maxConcurrent: number;
  ipHourly: number;
  monthlyBudgetUsd: number;
};

// Defaults are decision D3; environment variables override them.
const defaults = {
  AI_QUOTA_MENU_DAILY: 4,
  AI_QUOTA_MENU_MONTHLY: 20,
  AI_QUOTA_IMPORT_DAILY: 10,
  AI_QUOTA_SHOPPING_DAILY: 10,
  AI_MAX_CONCURRENT: 1,
  AI_IP_HOURLY: 30,
  AI_MONTHLY_BUDGET_USD: 25,
} as const;

const budgetThresholds = [0.5, 0.8];

const flowLabels: Record<AiFlow, string> = {
  menu: "menús",
  import: "importaciones",
  shopping: "listas de la compra",
};

const unavailableMessage = "La generación con IA no está disponible temporalmente. Inténtalo más tarde.";

function readNumber(name: keyof typeof defaults, { integer }: { integer: boolean }) {
  const raw = process.env[name]?.trim();
  if (!raw) return defaults[name];
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`invalid_${name}`);
  }
  return value;
}

export function readAiUsageConfig(): AiUsageConfig {
  return {
    flows: {
      menu: {
        daily: readNumber("AI_QUOTA_MENU_DAILY", { integer: true }),
        monthly: readNumber("AI_QUOTA_MENU_MONTHLY", { integer: true }),
      },
      import: { daily: readNumber("AI_QUOTA_IMPORT_DAILY", { integer: true }), monthly: null },
      shopping: { daily: readNumber("AI_QUOTA_SHOPPING_DAILY", { integer: true }), monthly: null },
    },
    maxConcurrent: readNumber("AI_MAX_CONCURRENT", { integer: true }),
    ipHourly: readNumber("AI_IP_HOURLY", { integer: true }),
    monthlyBudgetUsd: readNumber("AI_MONTHLY_BUDGET_USD", { integer: false }),
  };
}

function clientIp(request: Request) {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

// The IP itself is never stored or logged; only a keyed hash.
export function hashClientIp(request: Request, salt: string) {
  return createHmac("sha256", salt).update(clientIp(request)).digest("hex");
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function rejectionMessage(flow: AiFlow, reason: string, config: AiUsageConfig) {
  switch (reason) {
    case "concurrency":
      return "Ya tienes una generación en curso. Espera a que termine.";
    case "daily_quota":
      return `Has alcanzado el límite de ${config.flows[flow].daily} ${flowLabels[flow]} por hoy. Podrás seguir mañana.`;
    case "monthly_quota":
      return `Has alcanzado el límite de ${config.flows[flow].monthly} ${flowLabels[flow]} este mes.`;
    case "ip_rate":
      return "Demasiadas peticiones desde esta red. Inténtalo más tarde.";
    default:
      return unavailableMessage;
  }
}

function unavailable(requestId: string) {
  return NextResponse.json(
    { error: unavailableMessage, requestId },
    { status: 503, headers: { "X-Request-Id": requestId } },
  );
}

export type AiUsageOutcome = {
  status: "succeeded" | "failed";
  reason?: string;
  model?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  costUsd?: number | null;
  attempts?: number;
};

export type AiUsageHandle = {
  requestId: string;
  finish: (outcome: AiUsageOutcome) => Promise<void>;
};

type BeginResult =
  | { ok: true; usage: AiUsageHandle }
  | { ok: false; response: NextResponse };

function logUsage(entry: Record<string, unknown>) {
  // Flow, outcome, model, cost, latency and request ID only: no user, profile, dishes or free text.
  console.info("ai_usage", entry);
}

export async function beginAiUsage(
  request: Request,
  { userId, flow }: { userId: string; flow: AiFlow },
): Promise<BeginResult> {
  const requestId = randomUUID();
  const startedAt = performance.now();
  const salt = process.env.AI_IP_HASH_SALT;
  const supabase = serviceClient();

  let config: AiUsageConfig;
  try {
    config = readAiUsageConfig();
  } catch {
    logUsage({ flow, requestId, status: "rejected", reason: "invalid_config" });
    return { ok: false, response: unavailable(requestId) };
  }

  // Fail closed: without the ledger there is no quota and no budget control.
  if (!supabase || !salt) {
    logUsage({ flow, requestId, status: "rejected", reason: "ledger_unconfigured" });
    await sendOpsAlert("ai_ledger_unavailable", { flow, requestId });
    return { ok: false, response: unavailable(requestId) };
  }

  const { data, error } = await supabase.rpc("ai_begin_request", {
    p_user_id: userId,
    p_flow: flow,
    p_ip_hash: hashClientIp(request, salt),
    p_request_id: requestId,
    p_limits: {
      daily: config.flows[flow].daily,
      monthly: config.flows[flow].monthly,
      max_concurrent: config.maxConcurrent,
      ip_hourly: config.ipHourly,
      monthly_budget_usd: config.monthlyBudgetUsd,
    },
  });
  const begin = data as { allowed?: boolean; id?: string; reason?: string; retry_after_seconds?: number } | null;

  if (error || !begin || typeof begin.allowed !== "boolean" || !begin.id) {
    logUsage({ flow, requestId, status: "rejected", reason: "ledger_unavailable" });
    await sendOpsAlert("ai_ledger_unavailable", { flow, requestId });
    return { ok: false, response: unavailable(requestId) };
  }

  if (!begin.allowed) {
    const reason = begin.reason ?? "unknown";
    const retryAfter = String(Math.max(1, Math.ceil(begin.retry_after_seconds ?? 60)));
    logUsage({ flow, requestId, status: "rejected", reason });
    if (reason === "budget_exhausted") {
      console.warn("ai_budget_exhausted", { flow, requestId });
      await sendOpsAlert("ai_budget_exhausted", { flow, requestId, monthlyBudgetUsd: config.monthlyBudgetUsd });
    }
    return {
      ok: false,
      response: NextResponse.json(
        { error: rejectionMessage(flow, reason, config), reason, requestId },
        {
          status: reason === "budget_exhausted" ? 503 : 429,
          headers: { "Retry-After": retryAfter, "X-Request-Id": requestId },
        },
      ),
    };
  }

  const eventId = begin.id;
  let finished = false;

  return {
    ok: true,
    usage: {
      requestId,
      async finish(outcome) {
        if (finished) return;
        finished = true;
        const latencyMs = Math.round(performance.now() - startedAt);
        logUsage({
          flow,
          requestId,
          status: outcome.status,
          reason: outcome.reason ?? null,
          model: outcome.model ?? null,
          costUsd: outcome.costUsd ?? null,
          latencyMs,
          attempts: outcome.attempts ?? null,
        });
        const { data: finishData, error: finishError } = await supabase.rpc("ai_finish_request", {
          p_id: eventId,
          p_status: outcome.status,
          p_model: outcome.model ?? null,
          p_prompt_tokens: outcome.promptTokens ?? null,
          p_completion_tokens: outcome.completionTokens ?? null,
          p_cost_usd: outcome.costUsd ?? null,
          p_latency_ms: latencyMs,
          p_reason: outcome.reason ?? null,
        });
        if (finishError || !finishData) {
          // The row expires after two minutes; the request result is unaffected.
          console.warn("ai_usage_finish_failed", { flow, requestId });
          await sendOpsAlert("ai_usage_finish_failed", { flow, requestId });
          return;
        }
        const totals = finishData as { month_cost_usd?: number; previous_month_cost_usd?: number };
        const after = Number(totals.month_cost_usd ?? 0);
        const before = Number(totals.previous_month_cost_usd ?? after);
        for (const threshold of budgetThresholds) {
          const limit = config.monthlyBudgetUsd * threshold;
          if (before < limit && after >= limit) {
            const alert = {
              threshold: `${threshold * 100}%`,
              monthCostUsd: after,
              monthlyBudgetUsd: config.monthlyBudgetUsd,
            };
            console.warn("ai_budget_threshold", alert);
            await sendOpsAlert("ai_budget_threshold", { ...alert, requestId });
          }
        }
      },
    },
  };
}

export function withRequestId(response: NextResponse, requestId: string) {
  response.headers.set("X-Request-Id", requestId);
  return response;
}
