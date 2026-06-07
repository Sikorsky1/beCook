import OpenAI from "openai";
import { NextResponse } from "next/server";

import {
  importedMenuSchema,
  isImportedMenuResponse,
  type ImportedMenuResponse,
} from "@/lib/importMenu";

export const runtime = "nodejs";

const menuStyleLabelsById = {
  healthy_balanced: "Saludable y equilibrado",
  high_protein: "Alto en proteína",
  fat_loss: "Pérdida de grasa",
  muscle_gain: "Ganancia muscular",
  mediterranean: "Mediterráneo",
  quick_simple: "Rápido y sencillo",
} as const;

const legacyMenuStyleIdsByLabel = new Map<string, MenuStyleId>(
  Object.entries(menuStyleLabelsById).map(([id, label]) => [
    label,
    id as MenuStyleId,
  ]),
);

type MenuStyleId = keyof typeof menuStyleLabelsById;

const validMenuStyles = new Set<MenuStyleId>(
  Object.keys(menuStyleLabelsById) as MenuStyleId[],
);
const defaultMenuStyles: MenuStyleId[] = ["healthy_balanced"];

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
- Ten en cuenta los ingredientes activos de despensa como ingredientes disponibles en casa.
- Usa ingredientes de despensa cuando encajen de forma natural, sin forzarlos todos.
- No crees platos raros ni poco realistas solo para usar la despensa.
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
  elaborationLevel?: unknown;
  freeTextPrompt?: unknown;
  pantryItems?: unknown;
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

function sanitizeMenuStyles(value: unknown): MenuStyleId[] {
  const rawMenuStyles = Array.isArray(value) ? value : [value];
  const menuStyles = new Set<MenuStyleId>();

  for (const rawMenuStyle of rawMenuStyles) {
    if (typeof rawMenuStyle !== "string") {
      continue;
    }

    const trimmedMenuStyle = rawMenuStyle.trim();
    const menuStyleId =
      validMenuStyles.has(trimmedMenuStyle as MenuStyleId)
        ? (trimmedMenuStyle as MenuStyleId)
        : legacyMenuStyleIdsByLabel.get(trimmedMenuStyle);

    if (menuStyleId) {
      menuStyles.add(menuStyleId);
    }
  }

  return menuStyles.size > 0 ? Array.from(menuStyles) : defaultMenuStyles;
}

function sanitizeElaborationLevel(value: unknown) {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue)) {
    return 4;
  }

  return Math.min(Math.max(parsedValue, 1), 7);
}

function sanitizePantryItems(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const pantryItems = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const normalizedItem = item.trim().replace(/\s+/g, " ").slice(0, 80);

    if (normalizedItem) {
      pantryItems.add(normalizedItem);
    }
  }

  return Array.from(pantryItems).slice(0, 80);
}

function buildUserPrompt({
  profile,
  pantryItems,
  peopleCount,
  menuStyles,
  elaborationLevel,
  freeTextPrompt,
}: {
  profile: unknown;
  pantryItems: string[];
  peopleCount: number;
  menuStyles: MenuStyleId[];
  elaborationLevel: number;
  freeTextPrompt: string;
}) {
  const pantryContext =
    pantryItems.length > 0
      ? pantryItems.map((item) => `- ${item}`).join("\n")
      : "No hay ingredientes activos de despensa disponibles.";
  const menuStyleLabels = menuStyles.map(
    (menuStyle) => menuStyleLabelsById[menuStyle],
  );
  const elaborationGuidance =
    elaborationLevel <= 2
      ? "Nivel bajo: platos muy sencillos, pocos pasos, ingredientes comunes y comidas/cenas rápidas."
      : elaborationLevel <= 5
        ? "Nivel medio: platos algo más variados, elaboración moderada y sin complicar demasiado los días laborables."
        : "Nivel alto: platos más elaborados, más variedad y preparaciones más cuidadas, concentrando preferentemente lo más elaborado en fin de semana.";

  return `
Genera un menú semanal de comidas y cenas con estos datos:

Número de personas: ${peopleCount}
Tipos de menú seleccionados: ${menuStyleLabels.join(", ")}
Nivel de elaboración deseado: ${elaborationLevel}/7
Preferencia libre del usuario: ${freeTextPrompt || "Sin preferencia adicional."}

Perfil del usuario, si existe. Úsalo explícitamente para adaptar objetivo, actividad física, restricciones alimentarias, alergias y alimentos que no gustan:
${profile ? JSON.stringify(profile, null, 2) : "No hay perfil disponible."}

Ingredientes activos en despensa, disponibles en casa:
${pantryContext}

Instrucciones de adaptación:
- Respeta siempre alergias, restricciones alimentarias y alimentos no deseados del perfil.
- Ajusta el estilo del menú al objetivo y al nivel de actividad del perfil.
- Ajusta el menú a todos los tipos de menú seleccionados, priorizando combinaciones coherentes.
- ${elaborationGuidance}
- Aunque el nivel sea medio o alto, los días entre semana no deben ser excesivamente complejos salvo que el texto libre lo pida explícitamente.
- Si el nivel es alto, concentra preferentemente los platos más elaborados en sábado y domingo.
- Usa ingredientes de despensa cuando encajen de forma natural en platos realistas.
- No fuerces todos los ingredientes de despensa ni sacrifiques variedad por usarlos.
- Mantén comidas y cenas normales, claras y fáciles de reconocer.

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
    const menuStyles = sanitizeMenuStyles(body.menuStyle);
    const elaborationLevel = sanitizeElaborationLevel(body.elaborationLevel);
    const freeTextPrompt = sanitizeFreeText(body.freeTextPrompt);
    const pantryItems = sanitizePantryItems(body.pantryItems);

    if (!peopleCount) {
      return NextResponse.json(
        { error: "El número de personas debe estar entre 1 y 6." },
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
            pantryItems,
            peopleCount,
            menuStyles,
            elaborationLevel,
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
