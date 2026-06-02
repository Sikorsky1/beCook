import OpenAI from "openai";
import { NextResponse } from "next/server";

import {
  importedMenuSchema,
  isImportedMenuResponse,
  type ImportedMenuResponse,
} from "@/lib/importMenu";

export const runtime = "nodejs";

const validMenuStyles = new Set([
  "Saludable y equilibrado",
  "Alto en proteína",
  "Pérdida de grasa",
  "Ganancia muscular",
  "Mediterráneo",
  "Rápido y sencillo",
]);

const systemPrompt = `
Eres beCook, un asistente que crea menús semanales prácticos en español.

Tu tarea es generar una semana de comidas y cenas en JSON estructurado.

Reglas importantes:
- Devuelve exactamente 7 días: Lunes, Martes, Miércoles, Jueves, Viernes, Sábado y Domingo.
- Cada día debe tener comida y cena.
- Usa status "planned" para cada comida y cena generada.
- dishName debe ser un nombre de plato claro, realista y fácil de cocinar.
- Adapta el menú al perfil del usuario si existe.
- Respeta estrictamente alergias y restricciones dietéticas.
- Evita los alimentos que el usuario no quiere.
- Ten en cuenta objetivo, actividad física, tipo de menú y número de personas.
- No generes recetas paso a paso.
- No generes lista de la compra.
- No calcules calorías exactas.
- No hagas recomendaciones médicas ni inventes información clínica.
- El campo "week" debe ser un texto corto como "Semana creada con beCook".
- Devuelve solo JSON válido compatible con el esquema solicitado.
`.trim();

type GenerateMenuBody = {
  profile?: unknown;
  peopleCount?: unknown;
  menuStyle?: unknown;
  freeTextPrompt?: unknown;
};

function clampPeopleCount(value: unknown) {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue < 1 || parsedValue > 6) {
    return null;
  }

  return parsedValue;
}

function sanitizeFreeText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, 300);
}

function buildUserPrompt({
  profile,
  peopleCount,
  menuStyle,
  freeTextPrompt,
}: {
  profile: unknown;
  peopleCount: number;
  menuStyle: string;
  freeTextPrompt: string;
}) {
  return `
Genera un menú semanal de comidas y cenas con estos datos:

Número de personas: ${peopleCount}
Tipo de menú: ${menuStyle}
Preferencia libre del usuario: ${freeTextPrompt || "Sin preferencia adicional."}

Perfil del usuario, si existe:
${profile ? JSON.stringify(profile, null, 2) : "No hay perfil disponible."}

Devuelve estrictamente JSON parseable con el shape:
{
  "week": "Semana creada con beCook",
  "days": [
    {
      "dayName": "Lunes",
      "lunch": { "status": "planned", "dishName": "..." },
      "dinner": { "status": "planned", "dishName": "..." }
    }
  ]
}
`.trim();
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Falta configurar OPENAI_API_KEY en el servidor." },
      { status: 500 },
    );
  }

  try {
    const body = (await request.json()) as GenerateMenuBody;
    const peopleCount = clampPeopleCount(body.peopleCount);
    const menuStyle =
      typeof body.menuStyle === "string" ? body.menuStyle.trim() : "";
    const freeTextPrompt = sanitizeFreeText(body.freeTextPrompt);

    if (!peopleCount) {
      return NextResponse.json(
        { error: "El número de personas debe estar entre 1 y 6." },
        { status: 400 },
      );
    }

    if (!validMenuStyles.has(menuStyle)) {
      return NextResponse.json(
        { error: "Selecciona un tipo de menú válido." },
        { status: 400 },
      );
    }

    const openai = new OpenAI({ apiKey });

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "generated_menu",
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
          content: buildUserPrompt({
            profile: body.profile ?? null,
            peopleCount,
            menuStyle,
            freeTextPrompt,
          }),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        { error: "OpenAI no devolvió contenido para crear el menú." },
        { status: 500 },
      );
    }

    const parsedJson = JSON.parse(content) as unknown;

    if (!isImportedMenuResponse(parsedJson) || parsedJson.days.length !== 7) {
      console.error("Respuesta de menú generado inesperada:", parsedJson);

      return NextResponse.json(
        { error: "La respuesta del modelo no tiene el formato esperado." },
        { status: 500 },
      );
    }

    const generatedMenu = parsedJson as ImportedMenuResponse;

    return NextResponse.json(generatedMenu);
  } catch (error) {
    console.error("Error al generar menú:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Error desconocido";

    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === "development"
            ? `Ha fallado la generación del menú: ${errorMessage}`
            : "Ha fallado la generación del menú. Inténtalo de nuevo.",
      },
      { status: 500 },
    );
  }
}
