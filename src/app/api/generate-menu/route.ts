import OpenAI from "openai";
import { NextResponse } from "next/server";
import type { GeneratedMenuApiResponse, OpenAIMenuGenerationTelemetry } from "@/lib/importMenu";
import { estimateOpenAICostUsd } from "@/lib/openai/cost";
import { menuProfileFromContext, verifiedFoodContext, type VerifiedFoodContext } from "@/lib/menu-generation/food-context";
import { catalogMenu, elaborationForLevel, readCatalogMenuStyles } from "@/lib/menu-generation/catalog-menu";
import { buildMenuInput, stringList } from "@/lib/menu-generation/prompt";
import { weekFrequencies } from "@/lib/menu-generation/quotas";
import { selectionToMenu } from "@/lib/menu-generation/validation";
import { createMenuCompletion, menuReasoningEffort, menuTimeoutMs, type MenuAttempt } from "@/lib/menu-generation/runtime";
import { aiRequestLimits } from "@/lib/server/ai-limits";
import { guardAiRequest } from "@/lib/server/ai-request";
import { readProfileFoodContext } from "@/lib/server/food-context";
import { blockedOpenAIEndpointResponse } from "@/lib/openai/config";
import { beginAiUsage, withRequestId } from "@/lib/server/ai-usage";

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
  // Restrictions and preferences come from the saved profile (C1); a profile in the body is ignored.
  const context = await readProfileFoodContext(guard.accessToken);
  if (!context.ok) return context.response;
  let input: ReturnType<typeof buildMenuInput>;
  try { input = buildMenuInput(guard.body, menuProfileFromContext(context.value)); } catch {
    return NextResponse.json({error: "Revisa el número de personas (1–6)."}, {status: 400});
  }
  const foodContext: VerifiedFoodContext = verifiedFoodContext(context.value, input.peopleCount);
  // Without a weekly request, the week comes from the recipe catalogue: no AI, no cost, no quota.
  // A weekly request in words, or a profile the catalogue cannot serve, goes to the AI.
  if (!input.weeklyRequest) {
    const fromCatalog = catalogMenu({
      profile: input.profile,
      styles: readCatalogMenuStyles(guard.body.menuStyle),
      elaboration: elaborationForLevel(guard.body.elaborationLevel),
      recentDishes: stringList(guard.body.recentDishes),
      pantry: stringList(guard.body.pantryItems, 80, 80),
      batch: guard.body.batchCooking === true,
      seed: Math.floor(Math.random() * 2 ** 31),
      month: Number(new Intl.DateTimeFormat("en-GB", {month: "numeric", timeZone: "Europe/Madrid"}).format(new Date())),
    });
    if (fromCatalog) {
      const totalMs = Math.round(performance.now() - startedAt);
      const catalogTelemetry: OpenAIMenuGenerationTelemetry = {
        modelUsed: "catalog", promptTokens: null, completionTokens: null, totalTokens: null,
        estimatedCostUsd: 0, responseTimeMs: 0, attempts: 0, fallbackUsed: false, totalMs,
      };
      const frequencies = weekFrequencies(fromCatalog.days.flatMap(day => [day.lunch.dishName, day.dinner.dishName]), input.profile);
      console.info("menu_generation", {outcome: "success", source: "catalog", totalMs, frequencies});
      const response: GeneratedMenuApiResponse & {foodContext: VerifiedFoodContext} = {...fromCatalog, openaiTelemetry: catalogTelemetry, foodContext};
      return NextResponse.json(response, {headers: {"Server-Timing": `catalog;dur=${totalMs}, total;dur=${totalMs}`}});
    }
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({error: "Falta configurar OpenAI en el servidor."}, {status: 500});
  const blockedEndpoint = blockedOpenAIEndpointResponse("generate-menu");
  if (blockedEndpoint) return blockedEndpoint;
  const begin = await beginAiUsage(request, {userId: guard.user.id, flow: "menu"});
  if (!begin.ok) return begin.response;
  const aiUsage = begin.usage;
  let failureReason = "error";
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
      failureReason = "incomplete_output";
      return withRequestId(NextResponse.json({error: "No se ha podido completar un menú válido. Inténtalo de nuevo.", openaiTelemetry: telemetry}, {status: 502}), aiUsage.requestId);
    }
    const parseStartedAt = performance.now();
    let menu;
    try { menu = selectionToMenu(JSON.parse(choice.message.content), input.profile); } catch {
      parseMs = Math.round(performance.now() - parseStartedAt);
      failureReason = "invalid_output";
      return withRequestId(NextResponse.json({error: "El menú no ha superado las comprobaciones de formato, variedad o restricciones. Inténtalo de nuevo.", openaiTelemetry: telemetry}, {status: 422}), aiUsage.requestId);
    }
    parseMs = Math.round(performance.now() - parseStartedAt);
    outcome = "success";
    const frequencies = weekFrequencies(menu.days.flatMap(day => [day.lunch.dishName, day.dinner.dishName]), input.profile);
    console.info("menu_frequencies", {source: "ai", frequencies});
    const totalMs = Math.round(performance.now() - startedAt);
    // foodContext (added in C1): servings and restrictions this menu was planned with.
    const response: GeneratedMenuApiResponse & {foodContext: VerifiedFoodContext} = {...menu, openaiTelemetry: {...telemetry, preparationMs, parseMs, totalMs}, foodContext};
    return withRequestId(NextResponse.json(response, {headers: {"Server-Timing": `prepare;dur=${preparationMs}, openai;dur=${telemetry.responseTimeMs}, parse;dur=${parseMs}, total;dur=${totalMs}`}}), aiUsage.requestId);
  } catch (error) {
    failureReason = request.signal.aborted ? "client_aborted" : error instanceof OpenAI.APIConnectionTimeoutError ? "timeout" : error instanceof OpenAI.APIError ? `openai_${error.status ?? "error"}` : "error";
    return withRequestId(NextResponse.json({error: "Ha fallado la generación del menú. Inténtalo de nuevo.", ...(telemetry ? {openaiTelemetry: telemetry} : {})}, {status: 502}), aiUsage.requestId);
  } finally {
    await aiUsage.finish({
      status: outcome === "success" ? "succeeded" : "failed",
      reason: outcome === "success" ? undefined : failureReason,
      model: telemetry?.modelUsed ?? attempts.at(-1)?.model ?? null,
      promptTokens: telemetry?.promptTokens ?? null,
      completionTokens: telemetry?.completionTokens ?? null,
      costUsd: telemetry?.estimatedCostUsd ?? null,
      attempts: attempts.length,
    });
    // No prompts, dishes, profile data, IDs, API errors or secrets in logs.
    console.info("menu_generation", {outcome, preparationMs, parseMs, totalMs: Math.round(performance.now() - startedAt), attempts, telemetry});
  }
}
