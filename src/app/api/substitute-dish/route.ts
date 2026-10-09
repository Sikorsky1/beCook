import OpenAI from "openai";
import { NextResponse } from "next/server";
import { estimateOpenAICostUsd } from "@/lib/openai/cost";
import { buildSubstitutionInput } from "@/lib/menu-generation/prompt";
import { createSubstitutionCompletion, substitutionTimeoutMs, type MenuAttempt } from "@/lib/menu-generation/runtime";
import { catalogAlternative, checkReplacement, readSubstitutionRequest, type SubstituteDishResponse, type SubstitutionRequest } from "@/lib/menu-generation/substitution";
import { aiRequestLimits } from "@/lib/server/ai-limits";
import { guardAiRequest } from "@/lib/server/ai-request";
import { beginAiUsage, withRequestId } from "@/lib/server/ai-usage";

export const runtime = "nodejs";
export const maxDuration = 30;

// «Otra idea» for one slot (step 21). A compatible reviewed catalogue recipe is returned without
// AI or cost; otherwise one bounded AI attempt, billed and counted as a menu (flow «menu»).
export async function POST(request: Request) {
  const startedAt = performance.now();
  const attempts: MenuAttempt[] = [];
  let outcome = "error";
  let failureReason = "error";
  const guard = await guardAiRequest(request, aiRequestLimits.substituteDish);
  if (!guard.ok) return guard.response;
  let slot: SubstitutionRequest;
  let input: ReturnType<typeof buildSubstitutionInput>;
  try {
    slot = readSubstitutionRequest(guard.body);
    input = buildSubstitutionInput(guard.body, slot);
  } catch {
    return NextResponse.json({error: "Revisa el plato que quieres cambiar y los datos de restricciones del perfil."}, {status: 400});
  }
  const fromCatalog = catalogAlternative(slot, input.profile);
  if (fromCatalog) {
    return NextResponse.json({dish: fromCatalog.dish, source: "catalog"} satisfies SubstituteDishResponse);
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({error: "Falta configurar OpenAI en el servidor."}, {status: 500});
  const begin = await beginAiUsage(request, {userId: guard.user.id, flow: "menu"});
  if (!begin.ok) return begin.response;
  const aiUsage = begin.usage;
  let usage: OpenAI.CompletionUsage | undefined;
  let costUsd: number | null = null;
  try {
    const openai = new OpenAI({apiKey, maxRetries: 0, timeout: substitutionTimeoutMs});
    const completion = await createSubstitutionCompletion(openai, input.userPrompt, attempts, request.signal);
    usage = completion.usage;
    const details = usage?.prompt_tokens_details as {cached_tokens?: number; cache_write_tokens?: number} | undefined;
    costUsd = estimateOpenAICostUsd({model: attempts.at(-1)?.model ?? "", promptTokens: usage?.prompt_tokens ?? null, cachedPromptTokens: details?.cached_tokens, cacheWriteTokens: details?.cache_write_tokens, completionTokens: usage?.completion_tokens ?? null});
    const choice = completion.choices[0];
    if (choice?.finish_reason !== "stop" || choice.message.refusal || !choice.message.content) {
      failureReason = "incomplete_output";
      return withRequestId(NextResponse.json({error: "No se ha podido proponer otro plato. Inténtalo de nuevo."}, {status: 502}), aiUsage.requestId);
    }
    let dish: unknown;
    try { dish = (JSON.parse(choice.message.content) as {dish?: unknown}).dish; } catch { dish = null; }
    // The title is checked as returned: never repaired by adding or removing ingredients.
    const issue = checkReplacement(typeof dish === "string" ? dish.trim() : dish, slot, input.profile);
    if (issue) {
      failureReason = `invalid_output:${issue}`;
      return withRequestId(NextResponse.json({error: "La propuesta no ha superado las comprobaciones de restricciones, variedad o claridad del plato. Inténtalo de nuevo.", reason: issue}, {status: 422}), aiUsage.requestId);
    }
    outcome = "success";
    return withRequestId(NextResponse.json({dish: (dish as string).trim(), source: "ai"} satisfies SubstituteDishResponse), aiUsage.requestId);
  } catch (error) {
    failureReason = request.signal.aborted ? "client_aborted" : error instanceof OpenAI.APIConnectionTimeoutError ? "timeout" : error instanceof OpenAI.APIError ? `openai_${error.status ?? "error"}` : "error";
    return withRequestId(NextResponse.json({error: "Ha fallado la propuesta de otro plato. Inténtalo de nuevo."}, {status: 502}), aiUsage.requestId);
  } finally {
    await aiUsage.finish({
      status: outcome === "success" ? "succeeded" : "failed",
      reason: outcome === "success" ? undefined : failureReason,
      model: attempts.at(-1)?.model ?? null,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
      costUsd,
      attempts: attempts.length,
    });
    // No prompts, dishes, profile data, IDs, API errors or secrets in logs.
    console.info("dish_substitution", {outcome, reason: outcome === "success" ? null : failureReason, totalMs: Math.round(performance.now() - startedAt), attempts, costUsd});
  }
}
