import OpenAI from "openai";
import { NextResponse } from "next/server";
import type { GeneratedMenuApiResponse, OpenAIMenuGenerationTelemetry } from "@/lib/importMenu";
import { estimateOpenAICostUsd } from "@/lib/openai/cost";
import { buildMenuInput } from "@/lib/menu-generation/prompt";
import { selectionToMenu } from "@/lib/menu-generation/validation";
import { createMenuCompletion, menuReasoningEffort, menuTimeoutMs, type MenuAttempt } from "@/lib/menu-generation/runtime";
import { aiRequestLimits } from "@/lib/server/ai-limits";
import { guardAiRequest } from "@/lib/server/ai-request";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function POST(request: Request) {
  const startedAt = performance.now();
  const attempts: MenuAttempt[] = [];
  let telemetry: OpenAIMenuGenerationTelemetry | undefined;
  let preparationMs = 0;
  let parseMs = 0;
  let outcome = "error";
  const guard = await guardAiRequest(request, aiRequestLimits.generateMenu);
  if (!guard.ok) return guard.response;
  let input: ReturnType<typeof buildMenuInput>;
  try { input = buildMenuInput(guard.body); } catch {
    return NextResponse.json({error: "Revisa el número de personas (1–6) y los datos de restricciones del perfil."}, {status: 400});
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({error: "Falta configurar OpenAI en el servidor."}, {status: 500});
  try {
    const openai = new OpenAI({apiKey, maxRetries: 0, timeout: menuTimeoutMs});
    preparationMs = Math.round(performance.now() - startedAt);
    const openAIStartedAt = performance.now();
    const {completion, modelUsed} = await createMenuCompletion(openai, input.userPrompt, attempts, request.signal);
    const usage = completion.usage;
    const details = usage?.prompt_tokens_details as {cached_tokens?: number; cache_write_tokens?: number} | undefined;
    telemetry = {
      modelUsed, reasoningEffort: menuReasoningEffort,
      promptTokens: usage?.prompt_tokens ?? null, completionTokens: usage?.completion_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null, reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? null,
      cachedPromptTokens: details?.cached_tokens ?? null,
      estimatedCostUsd: estimateOpenAICostUsd({model: modelUsed, promptTokens: usage?.prompt_tokens ?? null, cachedPromptTokens: details?.cached_tokens, cacheWriteTokens: details?.cache_write_tokens, completionTokens: usage?.completion_tokens ?? null}),
      responseTimeMs: Math.round(performance.now() - openAIStartedAt), attempts: attempts.length, fallbackUsed: attempts.length > 1,
    };
    const choice = completion.choices[0];
    if (choice?.finish_reason !== "stop" || choice.message.refusal || !choice.message.content) {
      return NextResponse.json({error: "No se ha podido completar un menú válido. Inténtalo de nuevo.", openaiTelemetry: telemetry}, {status: 502});
    }
    const parseStartedAt = performance.now();
    let menu;
    try { menu = selectionToMenu(JSON.parse(choice.message.content), input.profile); } catch {
      parseMs = Math.round(performance.now() - parseStartedAt);
      return NextResponse.json({error: "El menú no ha superado las comprobaciones de formato, variedad o restricciones. Inténtalo de nuevo.", openaiTelemetry: telemetry}, {status: 422});
    }
    parseMs = Math.round(performance.now() - parseStartedAt);
    outcome = "success";
    const totalMs = Math.round(performance.now() - startedAt);
    const response: GeneratedMenuApiResponse = {...menu, openaiTelemetry: {...telemetry, preparationMs, parseMs, totalMs}};
    return NextResponse.json(response, {headers: {"Server-Timing": `prepare;dur=${preparationMs}, openai;dur=${telemetry.responseTimeMs}, parse;dur=${parseMs}, total;dur=${totalMs}`}});
  } catch {
    return NextResponse.json({error: "Ha fallado la generación del menú. Inténtalo de nuevo.", ...(telemetry ? {openaiTelemetry: telemetry} : {})}, {status: 502});
  } finally {
    // No prompts, dishes, profile data, IDs, API errors or secrets in logs.
    console.info("menu_generation", {outcome, preparationMs, parseMs, totalMs: Math.round(performance.now() - startedAt), attempts, telemetry});
  }
}
