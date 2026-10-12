import OpenAI from "openai";
import { NextResponse } from "next/server";

import {
  completeImportedMenuDays,
  hasPlannedDish,
  importedMenuSchema,
  importErrorMessage,
  isImportedMenuResponse,
  localMenuResponse,
  mentionsAnyDayName,
  parseMenuTextLocally,
  validateImportText,
  type ImportedMenuResponse,
} from "@/lib/importMenu";
import { logOpenAIModelUsage, OPENAI_MODEL, blockedOpenAIEndpointResponse } from "@/lib/openai/config";
import { estimateOpenAICostUsd } from "@/lib/openai/cost";
import { importTimeoutMs, withOneRetry } from "@/lib/openai/retry";
import { aiRequestLimits } from "@/lib/server/ai-limits";
import { guardAiRequest } from "@/lib/server/ai-request";
import { beginAiUsage, withRequestId, type AiUsageOutcome } from "@/lib/server/ai-usage";

export const runtime = "nodejs";
export const maxDuration = 60;

const systemPrompt = `
Eres un asistente que interpreta menús semanales en español.

Tu tarea es convertir texto pegado por un usuario en JSON estructurado.

Reglas importantes:
- Debes aceptar tanto formato estructurado por días como formato tabular copiado desde Excel.
- Puede haber mayúsculas, tabs, espacios irregulares, filas vacías y símbolos como (*).
- Ignora filas vacías.
- Normaliza los nombres de días exactamente a: Lunes, Martes, Miércoles, Jueves, Viernes, Sábado, Domingo.
- Devuelve exactamente los días presentes en el input. No inventes días ausentes.
- Si el plato es "Libre" o "LIBRE", convierte ese slot a status "free" y dishName "".
- Si un slot contiene un plato, usa status "planned".
- Conserva el nombre del plato con la mayor fidelidad posible.
- Si no puedes interpretar un slot con total confianza, usa status "planned" y el texto más aproximado que encuentres.
- El campo "week" puede ser un texto corto descriptivo como "Semana importada".
- Devuelve solo datos compatibles con el esquema solicitado.
`.trim();

// Error bodies carry a machine reason (C6) so the client can say what to change.
function importError(status: number, reason: string, error: string) {
  return NextResponse.json({ error, reason }, { status });
}

export async function POST(request: Request) {
  const guard = await guardAiRequest(request, aiRequestLimits.importMenu);

  if (!guard.ok) {
    return guard.response;
  }

  const limits = aiRequestLimits.importMenu;
  const checked = validateImportText(guard.body.text, limits);

  if (!checked.ok) {
    return importError(400, checked.reason, checked.error);
  }

  const { text } = checked;

  // C6: the same local attempt the browser makes first. A client deployed before C6 still gets an
  // unambiguous paste ordered without the AI, without opening a usage record and without cost.
  const local = parseMenuTextLocally(text);

  if (local.kind === "parsed") {
    if (!hasPlannedDish(local.days)) {
      return importError(422, "empty_menu", importErrorMessage("empty_menu", "", limits));
    }

    return NextResponse.json(localMenuResponse(local.days, local.warnings));
  }

  // Not a weekly menu at all: answered before the AI, free.
  if (!mentionsAnyDayName(text)) {
    return importError(422, "no_menu_found", importErrorMessage("no_menu_found", "", limits));
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Falta configurar OPENAI_API_KEY en el servidor." },
      { status: 500 },
    );
  }

  const blockedEndpoint = blockedOpenAIEndpointResponse("import-menu");
  if (blockedEndpoint) return blockedEndpoint;
  const begin = await beginAiUsage(request, { userId: guard.user.id, flow: "import" });

  if (!begin.ok) {
    return begin.response;
  }

  const { usage } = begin;
  const outcome: AiUsageOutcome = { status: "failed", reason: "error", model: OPENAI_MODEL };
  let attempts = 0;

  try {
    const openai = new OpenAI({ apiKey, maxRetries: 0, timeout: importTimeoutMs });
    logOpenAIModelUsage("import-menu");

    const completion = await withOneRetry(
      () =>
        openai.chat.completions.create(
          {
            model: OPENAI_MODEL,
            store: false,
            // Extraction: little reasoning, and a cap on the answer (a week is ~600 tokens).
            ...(/^gpt-5/.test(OPENAI_MODEL) ? { reasoning_effort: "low" as const } : {}),
            max_completion_tokens: limits.maxCompletionTokens,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "imported_menu",
                strict: true,
                schema: importedMenuSchema,
              },
            },
            messages: [
              {
                role: "system",
                content: systemPrompt,
              },
              {
                role: "user",
                content: `Interpreta este menú semanal y devuélvelo en JSON:\n\n${text}`,
              },
            ],
          },
          { signal: request.signal },
        ),
      { signal: request.signal, onAttempt: () => attempts++ },
    );

    const promptTokens = completion.usage?.prompt_tokens ?? null;
    const completionTokens = completion.usage?.completion_tokens ?? null;
    const cachedPromptTokens =
      completion.usage?.prompt_tokens_details?.cached_tokens ?? null;
    Object.assign(outcome, {
      model: completion.model || OPENAI_MODEL,
      promptTokens,
      completionTokens,
      costUsd: estimateOpenAICostUsd({
        model: OPENAI_MODEL,
        promptTokens,
        cachedPromptTokens,
        completionTokens,
      }),
    });

    const choice = completion.choices[0];
    const content = choice?.message?.content;

    if (!content || choice?.finish_reason === "length") {
      outcome.reason = choice?.finish_reason === "length" ? "truncated_output" : "empty_output";
      return withRequestId(
        importError(502, outcome.reason, "No hemos podido ordenar el menú. Inténtalo de nuevo."),
        usage.requestId,
      );
    }

    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(content);
    } catch {
      parsedJson = null;
    }

    if (!isImportedMenuResponse(parsedJson)) {
      outcome.reason = "invalid_output";
      return withRequestId(
        importError(502, "invalid_output", "No hemos podido ordenar el menú. Inténtalo de nuevo."),
        usage.requestId,
      );
    }

    const parsedMenu = parsedJson as ImportedMenuResponse;
    const completedMenu: ImportedMenuResponse = {
      week: parsedMenu.week,
      days: completeImportedMenuDays(text, parsedMenu.days),
      parsedBy: "ai",
    };

    // The AI read it and found no dish: a 422 that still counts (it used tokens, A4).
    if (!hasPlannedDish(completedMenu.days)) {
      outcome.reason = "empty_menu";
      return withRequestId(
        importError(422, "empty_menu", importErrorMessage("empty_menu_ai", "", limits)),
        usage.requestId,
      );
    }

    outcome.status = "succeeded";
    outcome.reason = undefined;

    return withRequestId(NextResponse.json(completedMenu), usage.requestId);
  } catch (error) {
    outcome.reason = request.signal.aborted
      ? "client_aborted"
      : error instanceof OpenAI.APIConnectionTimeoutError
        ? "timeout"
        : error instanceof OpenAI.APIError
          ? `openai_${error.status ?? "error"}`
          : "error";

    return withRequestId(
      importError(
        502,
        outcome.reason === "timeout" ? "timeout" : "ai_failed",
        "Ha fallado el procesamiento del menú. Inténtalo de nuevo.",
      ),
      usage.requestId,
    );
  } finally {
    await usage.finish({ ...outcome, attempts });
  }
}
