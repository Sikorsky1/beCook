import OpenAI from "openai";
import { NextResponse } from "next/server";

import {
  completeImportedMenuDays,
  importedMenuSchema,
  isImportedMenuResponse,
  type ImportedMenuResponse,
} from "@/lib/importMenu";

export const runtime = "nodejs";

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

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Falta configurar OPENAI_API_KEY en el servidor." },
      { status: 500 },
    );
  }

  try {
    const body = await request.json();
    const text = typeof body?.text === "string" ? body.text.trim() : "";

    if (!text) {
      return NextResponse.json(
        { error: "Pega un menú antes de procesarlo." },
        { status: 400 },
      );
    }

    const openai = new OpenAI({ apiKey });

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
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
    });

    const content = completion.choices[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        { error: "OpenAI no devolvió contenido para interpretar el menú." },
        { status: 500 },
      );
    }

    const parsedJson = JSON.parse(content) as unknown;

    if (!isImportedMenuResponse(parsedJson)) {
      console.error("Respuesta de menú con formato inesperado:", parsedJson);

      return NextResponse.json(
        { error: "La respuesta del modelo no tiene el formato esperado." },
        { status: 500 },
      );
    }

    const parsedMenu = parsedJson as ImportedMenuResponse;
    const completedMenu: ImportedMenuResponse = {
      ...parsedMenu,
      days: completeImportedMenuDays(text, parsedMenu.days),
    };

    console.log("Import menu days:", {
      modelDays: parsedMenu.days.length,
      finalDays: completedMenu.days.length,
    });

    return NextResponse.json(completedMenu);
  } catch (error) {
    console.error("Error al importar menú:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Error desconocido";

    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === "development"
            ? `Ha fallado el procesamiento del menú: ${errorMessage}`
            : "Ha fallado el procesamiento del menú. Inténtalo de nuevo.",
      },
      { status: 500 },
    );
  }
}
