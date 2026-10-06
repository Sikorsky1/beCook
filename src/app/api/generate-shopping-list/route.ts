import OpenAI from "openai";
import { NextResponse } from "next/server";

import type { WeekDay } from "@/data/mockWeek";
import {
  generatedShoppingListSchema,
  isGeneratedShoppingListResponse,
  type GeneratedShoppingListResponse,
} from "@/lib/shoppingList";
import { logOpenAIModelUsage, OPENAI_MODEL } from "@/lib/openai/config";
import { aiRequestLimits } from "@/lib/server/ai-limits";
import { guardAiRequest } from "@/lib/server/ai-request";

export const runtime = "nodejs";

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

  try {
    const openai = new OpenAI({ apiKey });
    logOpenAIModelUsage("generate-shopping-list");

    const response = await openai.responses.create({
      model: OPENAI_MODEL,
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
    });

    if (!response.output_text) {
      return NextResponse.json(
        { error: "OpenAI no devolvió contenido para la lista de la compra." },
        { status: 500 },
      );
    }

    const parsedJson = JSON.parse(response.output_text) as unknown;

    if (!isGeneratedShoppingListResponse(parsedJson)) {
      console.error("Respuesta de lista de la compra con formato inesperado:", parsedJson);

      return NextResponse.json(
        { error: "La respuesta del modelo no tiene el formato esperado." },
        { status: 500 },
      );
    }

    return NextResponse.json(parsedJson as GeneratedShoppingListResponse);
  } catch (error) {
    console.error("Error al generar la lista de la compra:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Error desconocido";

    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === "development"
            ? `Ha fallado la generación de la lista: ${errorMessage}`
            : "Ha fallado la generación de la lista de la compra. Inténtalo de nuevo.",
      },
      { status: 500 },
    );
  }
}
