import OpenAI from "openai";
import { NextResponse } from "next/server";

import type { WeekDay } from "@/data/mockWeek";
import {
  generatedShoppingListSchema,
  isGeneratedShoppingListResponse,
  type GeneratedShoppingListResponse,
} from "@/lib/shoppingList";
import { logOpenAIModelUsage, OPENAI_MODEL } from "@/lib/openai/config";
import { estimateOpenAICostUsd } from "@/lib/openai/cost";
import { shoppingTimeoutMs, withOneRetry } from "@/lib/openai/retry";
import { aiRequestLimits } from "@/lib/server/ai-limits";
import { guardAiRequest } from "@/lib/server/ai-request";
import { beginAiUsage, withRequestId, type AiUsageOutcome } from "@/lib/server/ai-usage";

export const runtime = "nodejs";
export const maxDuration = 80;

const systemPrompt = `
Eres un asistente que genera listas de la compra semanales en español.

Tu tarea es leer una semana estructurada de platos y devolver solo ingredientes comprables.

Reglas de generación de ingredientes:
- Parte únicamente de la semana estructurada recibida.
- Ignora completamente cualquier slot libre, ya sea "LIBRE" o un slot con status "free".
- Asume 2 personas por defecto.
- Debes devolver ingredientes comprables, no platos.
  Ejemplo correcto: "pavo".
  Ejemplo incorrecto: "pavo a la plancha".
- Usa nombres simples y comunes de supermercado.
  Ejemplo: "tomate" en lugar de "tomate natural" o "tomates maduros".
  Ejemplo: "atún" en lugar de "atún al natural".
- Evita añadir adjetivos innecesarios si no cambian la compra.
- Si el mismo ingrediente aparece en varios platos, intenta unificarlo en un único item con cantidad total.
- Mantén separados ingredientes realmente distintos.
  Ejemplo: "jamón" y "jamón serrano" son distintos.
  Ejemplo: "leche" y "leche sin lactosa" son distintos.
- Devuelve ingredientes útiles para hacer una compra semanal realista.
- Usa unidades prácticas: g, kg, ml, litros, unidades o paquetes si es más lógico.
- Si una cantidad exacta no es evidente, devuelve una estimación razonable para una compra semanal.
- Usa solo estas categorías: frutería, carnicería, pescadería, lácteos, despensa, congelados, otros.
- No incluyas ingredientes opcionales poco relevantes salvo que sean claramente necesarios para preparar el plato.
- No incluyas instrucciones de cocina, pasos de receta ni explicaciones.
- Responde solo con datos válidos para el esquema solicitado.
`.trim();

const limits = aiRequestLimits.generateShoppingList;

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function isWeekDayArray(value: unknown): value is WeekDay[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > limits.maxDays) {
    return false;
  }

  return value.every((day) => {
    if (!day || typeof day !== "object" || Array.isArray(day)) {
      return false;
    }

    const parsedDay = day as Record<string, unknown>;

    return (
      isBoundedString(parsedDay.day, limits.maxDayLabelLength) &&
      isBoundedString(parsedDay.date, limits.maxDayLabelLength) &&
      isBoundedString(parsedDay.lunch, limits.maxSlotLength) &&
      isBoundedString(parsedDay.dinner, limits.maxSlotLength)
    );
  });
}

export async function POST(request: Request) {
  const guard = await guardAiRequest(request, limits);

  if (!guard.ok) {
    return guard.response;
  }

  const week = guard.body.week;

  if (!isWeekDayArray(week)) {
    return NextResponse.json(
      { error: "No hay una semana válida para generar la lista de la compra." },
      { status: 400 },
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Falta configurar OPENAI_API_KEY en el servidor." },
      { status: 500 },
    );
  }

  const begin = await beginAiUsage(request, { userId: guard.user.id, flow: "shopping" });

  if (!begin.ok) {
    return begin.response;
  }

  const { usage } = begin;
  const outcome: AiUsageOutcome = { status: "failed", reason: "error", model: OPENAI_MODEL };
  let attempts = 0;

  try {
    const openai = new OpenAI({ apiKey, maxRetries: 0, timeout: shoppingTimeoutMs });
    logOpenAIModelUsage("generate-shopping-list");

    const response = await withOneRetry(
      () =>
        openai.responses.create(
          {
            model: OPENAI_MODEL,
            store: false,
            instructions: systemPrompt,
            input: `Genera una lista de la compra semanal a partir de esta semana estructurada:\n\n${JSON.stringify(week, null, 2)}`,
            text: {
              format: {
                type: "json_schema",
                name: "shopping_list",
                strict: true,
                schema: generatedShoppingListSchema,
                description:
                  "Lista de la compra semanal estructurada por ingredientes comprables.",
              },
            },
          },
          { signal: request.signal },
        ),
      { signal: request.signal, onAttempt: () => attempts++ },
    );

    const promptTokens = response.usage?.input_tokens ?? null;
    const completionTokens = response.usage?.output_tokens ?? null;
    Object.assign(outcome, {
      model: response.model || OPENAI_MODEL,
      promptTokens,
      completionTokens,
      costUsd: estimateOpenAICostUsd({
        model: OPENAI_MODEL,
        promptTokens,
        cachedPromptTokens: response.usage?.input_tokens_details?.cached_tokens ?? null,
        completionTokens,
      }),
    });

    if (!response.output_text) {
      outcome.reason = "empty_output";
      return withRequestId(
        NextResponse.json(
          { error: "OpenAI no devolvió contenido para la lista de la compra." },
          { status: 502 },
        ),
        usage.requestId,
      );
    }

    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(response.output_text);
    } catch {
      parsedJson = null;
    }

    if (!isGeneratedShoppingListResponse(parsedJson)) {
      outcome.reason = "invalid_output";
      return withRequestId(
        NextResponse.json(
          { error: "La respuesta del modelo no tiene el formato esperado." },
          { status: 502 },
        ),
        usage.requestId,
      );
    }

    outcome.status = "succeeded";
    outcome.reason = undefined;

    return withRequestId(
      NextResponse.json(parsedJson as GeneratedShoppingListResponse),
      usage.requestId,
    );
  } catch (error) {
    outcome.reason = request.signal.aborted
      ? "client_aborted"
      : error instanceof OpenAI.APIConnectionTimeoutError
        ? "timeout"
        : error instanceof OpenAI.APIError
          ? `openai_${error.status ?? "error"}`
          : "error";

    return withRequestId(
      NextResponse.json(
        { error: "Ha fallado la generación de la lista de la compra. Inténtalo de nuevo." },
        { status: 502 },
      ),
      usage.requestId,
    );
  } finally {
    await usage.finish({ ...outcome, attempts });
  }
}
