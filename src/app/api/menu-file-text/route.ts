import OpenAI from "openai";
import { NextResponse } from "next/server";

import { menuFileErrorMessage, menuFileLimits, validateMenuImages } from "@/lib/menuFile";
import { logOpenAIModelUsage, OPENAI_MODEL, blockedOpenAIEndpointResponse } from "@/lib/openai/config";
import { estimateOpenAICostUsd } from "@/lib/openai/cost";
import { importTimeoutMs, withOneRetry } from "@/lib/openai/retry";
import { aiRequestLimits } from "@/lib/server/ai-limits";
import { guardAiRequest } from "@/lib/server/ai-request";
import { beginAiUsage, withRequestId, type AiUsageOutcome } from "@/lib/server/ai-usage";

export const runtime = "nodejs";
export const maxDuration = 60;

// «Ya tengo un menú» from a photo or a scanned PDF (see @/lib/menuFile): the page images, already
// downscaled in the browser, become plain text for the paste box. Nothing is stored: the images
// are only sent to OpenAI (store: false). It counts as an import in the AI quota.
const systemPrompt = `
Eres un asistente que transcribe menús semanales en español a partir de imágenes (fotos o páginas escaneadas).

Tu tarea es devolver el texto del menú para que el usuario lo revise y lo pegue en una aplicación.

Reglas importantes:
- Transcribe solo el menú: días de la semana y los platos de comida y cena. Ignora logotipos, precios, notas y decoración.
- Escribe cada día en su línea seguido de sus comidas, con este formato:
  Lunes
  Comida: <plato>
  Cena: <plato>
- Si el menú solo tiene una comida por día, usa solo «Comida:».
- Si una comida pone «Libre», escribe «LIBRE».
- Conserva el nombre de cada plato tal como aparece, corrigiendo solo errores evidentes de lectura.
- Escribe siempre el nombre completo del día. Si aparece abreviado («L, M, X, J, V, S, D», con X para el miércoles, o «Lun, Mar, Mié…») o numerado («Día 1» es Lunes, «Día 2» Martes… hasta «Día 7» Domingo), conviértelo.
- Si los días van en columnas (cabecera con los días y filas de comida y cena), lee cada columna como un día.
- Si el menú no dice los días, asígnalos en orden: el primer valor o fila es Lunes, el segundo Martes, y así sucesivamente, hasta 7.
- No inventes platos que no estén en la imagen.
- Si no hay ningún menú legible, devuelve found false y text vacío.
`.trim();

const menuFileTextSchema = {
  type: "object",
  additionalProperties: false,
  required: ["found", "text"],
  properties: {
    found: { type: "boolean" },
    text: { type: "string" },
  },
} as const;

function fileTextError(status: number, reason: string, error: string) {
  return NextResponse.json({ error, reason }, { status });
}

function isMenuFileText(value: unknown): value is { found: boolean; text: string } {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { found?: unknown }).found === "boolean" &&
    typeof (value as { text?: unknown }).text === "string"
  );
}

export async function POST(request: Request) {
  const guard = await guardAiRequest(request, aiRequestLimits.menuFileText);

  if (!guard.ok) {
    return guard.response;
  }

  const checked = validateMenuImages(guard.body.images);

  if (!checked.ok) {
    return fileTextError(400, "invalid_images", menuFileErrorMessage("unreadable"));
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Falta configurar OPENAI_API_KEY en el servidor." },
      { status: 500 },
    );
  }

  const blockedEndpoint = blockedOpenAIEndpointResponse("menu-file-text");
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
    logOpenAIModelUsage("menu-file-text");

    const completion = await withOneRetry(
      () =>
        openai.chat.completions.create(
          {
            model: OPENAI_MODEL,
            store: false,
            ...(/^gpt-5/.test(OPENAI_MODEL) ? { reasoning_effort: "low" as const } : {}),
            max_completion_tokens: menuFileLimits.maxCompletionTokens,
            response_format: {
              type: "json_schema",
              json_schema: { name: "menu_file_text", strict: true, schema: menuFileTextSchema },
            },
            messages: [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content: [
                  { type: "text", text: "Transcribe el menú semanal de estas imágenes." },
                  ...checked.images.map((url) => ({
                    type: "image_url" as const,
                    image_url: { url, detail: "high" as const },
                  })),
                ],
              },
            ],
          },
          { signal: request.signal },
        ),
      { signal: request.signal, onAttempt: () => attempts++ },
    );

    const promptTokens = completion.usage?.prompt_tokens ?? null;
    const completionTokens = completion.usage?.completion_tokens ?? null;
    const cachedPromptTokens = completion.usage?.prompt_tokens_details?.cached_tokens ?? null;
    Object.assign(outcome, {
      model: completion.model || OPENAI_MODEL,
      promptTokens,
      completionTokens,
      costUsd: estimateOpenAICostUsd({ model: OPENAI_MODEL, promptTokens, cachedPromptTokens, completionTokens }),
    });

    const choice = completion.choices[0];
    const content = choice?.message?.content;

    if (!content || choice?.finish_reason === "length") {
      outcome.reason = choice?.finish_reason === "length" ? "truncated_output" : "empty_output";
      return withRequestId(
        fileTextError(502, outcome.reason, "No hemos podido leer el archivo. Inténtalo de nuevo."),
        usage.requestId,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = null;
    }

    if (!isMenuFileText(parsed)) {
      outcome.reason = "invalid_output";
      return withRequestId(
        fileTextError(502, "invalid_output", "No hemos podido leer el archivo. Inténtalo de nuevo."),
        usage.requestId,
      );
    }

    const text = parsed.text.trim();

    // Read, but no menu in it: a 422 that still counts (it used tokens).
    if (!parsed.found || !text) {
      outcome.reason = "no_text_found";
      return withRequestId(
        fileTextError(422, "no_text_found", menuFileErrorMessage("no_text_found")),
        usage.requestId,
      );
    }

    outcome.status = "succeeded";
    outcome.reason = undefined;

    return withRequestId(NextResponse.json({ text }), usage.requestId);
  } catch (error) {
    outcome.reason = request.signal.aborted
      ? "client_aborted"
      : error instanceof OpenAI.APIConnectionTimeoutError
        ? "timeout"
        : error instanceof OpenAI.APIError
          ? `openai_${error.status ?? "error"}`
          : "error";

    return withRequestId(
      fileTextError(
        502,
        outcome.reason === "timeout" ? "timeout" : "ai_failed",
        "Ha fallado la lectura del archivo. Inténtalo de nuevo.",
      ),
      usage.requestId,
    );
  } finally {
    await usage.finish({ ...outcome, attempts });
  }
}
