import type { WeekDay } from "@/data/mockWeek";
import type { IsoWeek } from "@/lib/isoWeek";
import type { VerifiedFoodContext } from "@/lib/menu-generation/food-context";
import { withWeekDates } from "@/lib/weekStorage";

export type ImportedMealSlot = {
  status: "planned" | "free";
  dishName: string;
};

export type ImportedMenuDay = {
  dayName: "Lunes" | "Martes" | "Miércoles" | "Jueves" | "Viernes" | "Sábado" | "Domingo";
  lunch: ImportedMealSlot;
  dinner: ImportedMealSlot;
};

export type ImportedMenuResponse = {
  week: string;
  days: ImportedMenuDay[];
  // C6: who ordered the pasted text (the device's parser or the AI) and what the parser filled in.
  parsedBy?: "local" | "ai";
  warnings?: string[];
};

export type OpenAIMenuGenerationTelemetry = {
  reasoningEffort?: string;
  reasoningTokens?: number | null;
  cachedPromptTokens?: number | null;
  attempts?: number;
  fallbackUsed?: boolean;
  preparationMs?: number;
  parseMs?: number;
  totalMs?: number;
  modelUsed: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  responseTimeMs: number;
};

export type GeneratedMenuApiResponse = ImportedMenuResponse & {
  openaiTelemetry?: OpenAIMenuGenerationTelemetry;
  // C1: servings and restrictions read from the account on the server and used for this menu.
  foodContext?: VerifiedFoodContext;
};

export type MenuGenerationApiErrorResponse = {
  error?: string;
  openaiTelemetry?: OpenAIMenuGenerationTelemetry;
};

const orderedDayNames: ImportedMenuDay["dayName"][] = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
];

const validDayNames = new Set<ImportedMenuDay["dayName"]>([
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
]);

const validStatuses = new Set<ImportedMealSlot["status"]>(["planned", "free"]);

export const importedMenuSchema = {
  type: "object",
  additionalProperties: false,
  required: ["week", "days"],
  properties: {
    week: {
      type: "string",
    },
    days: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["dayName", "lunch", "dinner"],
        properties: {
          dayName: {
            type: "string",
            enum: [
              "Lunes",
              "Martes",
              "Miércoles",
              "Jueves",
              "Viernes",
              "Sábado",
              "Domingo",
            ],
          },
          lunch: {
            type: "object",
            additionalProperties: false,
            required: ["status", "dishName"],
            properties: {
              status: {
                type: "string",
                enum: ["planned", "free"],
              },
              dishName: {
                type: "string",
              },
            },
          },
          dinner: {
            type: "object",
            additionalProperties: false,
            required: ["status", "dishName"],
            properties: {
              status: {
                type: "string",
                enum: ["planned", "free"],
              },
              dishName: {
                type: "string",
              },
            },
          },
        },
      },
    },
  },
} as const;

// Proposal and import days are dated inside the target week by their real day name.
export function importedMenuToWeekDays(
  days: ImportedMenuDay[],
  isoWeek: IsoWeek,
): WeekDay[] {
  return withWeekDates(
    days.map((day) => ({
      day: day.dayName,
      date: "",
      lunch: day.lunch.status === "free" ? "LIBRE" : day.lunch.dishName,
      dinner: day.dinner.status === "free" ? "LIBRE" : day.dinner.dishName,
    })),
    isoWeek,
  );
}

export function isImportedMenuResponse(
  value: unknown,
): value is ImportedMenuResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const menu = value as Partial<ImportedMenuResponse>;

  if (typeof menu.week !== "string" || !Array.isArray(menu.days)) {
    return false;
  }

  return menu.days.every((day) => {
    if (!day || typeof day !== "object") {
      return false;
    }

    const parsedDay = day as Partial<ImportedMenuDay>;

    return (
      typeof parsedDay.dayName === "string" &&
      validDayNames.has(parsedDay.dayName as ImportedMenuDay["dayName"]) &&
      isImportedMealSlot(parsedDay.lunch) &&
      isImportedMealSlot(parsedDay.dinner)
    );
  });
}

function isImportedMealSlot(value: unknown): value is ImportedMealSlot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const mealSlot = value as Partial<ImportedMealSlot>;

  return (
    typeof mealSlot.dishName === "string" &&
    typeof mealSlot.status === "string" &&
    validStatuses.has(mealSlot.status as ImportedMealSlot["status"])
  );
}

export function completeImportedMenuDays(
  text: string,
  importedDays: ImportedMenuDay[],
): ImportedMenuDay[] {
  const localDays = parseMenuTextToDays(text);
  const mergedDays = new Map<ImportedMenuDay["dayName"], ImportedMenuDay>();

  for (const day of importedDays) {
    mergedDays.set(day.dayName, day);
  }

  for (const day of localDays) {
    if (!mergedDays.has(day.dayName)) {
      mergedDays.set(day.dayName, day);
    }
  }

  return orderedDayNames.filter((dayName) => mergedDays.has(dayName)).map(
    (dayName) => mergedDays.get(dayName)!,
  );
}

function parseMenuTextToDays(text: string): ImportedMenuDay[] {
  const parsedDays = new Map<ImportedMenuDay["dayName"], ImportedMenuDay>();
  let currentDayName: ImportedMenuDay["dayName"] | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const tabularDay = parseTabularLine(line);

    if (tabularDay) {
      parsedDays.set(tabularDay.dayName, tabularDay);
      currentDayName = tabularDay.dayName;
      continue;
    }

    const dayName = normalizeDayName(line);

    if (dayName) {
      currentDayName = dayName;

      if (!parsedDays.has(dayName)) {
        parsedDays.set(dayName, createEmptyImportedDay(dayName));
      }

      continue;
    }

    if (!currentDayName) {
      continue;
    }

    const lunchMatch = line.match(/^comida\s*:\s*(.+)$/i);
    const dinnerMatch = line.match(/^cena\s*:\s*(.+)$/i);

    if (lunchMatch) {
      parsedDays.set(currentDayName, {
        ...getImportedDay(parsedDays, currentDayName),
        lunch: createMealSlot(lunchMatch[1]),
      });
    }

    if (dinnerMatch) {
      parsedDays.set(currentDayName, {
        ...getImportedDay(parsedDays, currentDayName),
        dinner: createMealSlot(dinnerMatch[1]),
      });
    }
  }

  return orderedDayNames
    .filter((dayName) => parsedDays.has(dayName))
    .map((dayName) => parsedDays.get(dayName)!);
}

function parseTabularLine(line: string): ImportedMenuDay | null {
  const normalizedLine = line.replace(/\s*\|\s*/g, "\t");
  const columns = normalizedLine
    .split(/\t+|\s{2,}/)
    .map((column) => column.trim())
    .filter(Boolean);

  if (columns.length < 3) {
    return null;
  }

  const dayName = normalizeDayName(columns[0]);

  if (!dayName || normalizeWord(columns[0]) === "DIA") {
    return null;
  }

  return {
    dayName,
    lunch: createMealSlot(columns[1]),
    dinner: createMealSlot(columns[2]),
  };
}

function normalizeDayName(value: string): ImportedMenuDay["dayName"] | null {
  const normalizedValue = normalizeWord(value);

  const dayMap: Record<string, ImportedMenuDay["dayName"]> = {
    LUNES: "Lunes",
    MARTES: "Martes",
    MIERCOLES: "Miércoles",
    MIERCOLES_: "Miércoles",
    JUEVES: "Jueves",
    VIERNES: "Viernes",
    SABADO: "Sábado",
    DOMINGO: "Domingo",
  };

  return dayMap[normalizedValue] ?? null;
}

function normalizeWord(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
}

function createEmptyImportedDay(
  dayName: ImportedMenuDay["dayName"],
): ImportedMenuDay {
  return {
    dayName,
    lunch: { status: "free", dishName: "" },
    dinner: { status: "free", dishName: "" },
  };
}

function getImportedDay(
  parsedDays: Map<ImportedMenuDay["dayName"], ImportedMenuDay>,
  dayName: ImportedMenuDay["dayName"],
) {
  return parsedDays.get(dayName) ?? createEmptyImportedDay(dayName);
}

function createMealSlot(rawValue: string): ImportedMealSlot {
  const dishName = rawValue.trim();

  if (!dishName || /^libre$/i.test(dishName)) {
    return {
      status: "free",
      dishName: "",
    };
  }

  return {
    status: "planned",
    dishName,
  };
}

// --- C6 (roadmap step 22): local parsing first, the AI only for what it cannot read ------------
// An unambiguous paste is ordered on the device: no request, no quota, no cost (guests too). It is
// unambiguous when every non-empty line is a day header, a «Comida:»/«Cena:» line under a day, a
// three-column row (day, lunch, dinner) or the DÍA|COMIDA|CENA header; no day or meal repeats and
// no title is longer than maxLocalTitleLength. Anything else is left to the AI (signed in only).
export type LocalParseResult =
  | { kind: "parsed"; days: ImportedMenuDay[]; warnings: string[] }
  | { kind: "ambiguous"; reason: LocalParseAmbiguity };

export type LocalParseAmbiguity =
  | "empty"
  | "unrecognized_line"
  | "repeated_day"
  | "repeated_meal"
  | "meal_without_day"
  | "title_too_long"
  | "no_days";

export const maxLocalTitleLength = 120;

export type ImportErrorReason =
  | "not_text"
  | "empty"
  | "too_long"
  | "too_many_lines"
  | "no_menu_found"
  | "empty_menu";

export type ImportTextLimits = { maxTextLength: number; maxLines: number };

function splitColumns(line: string) {
  return line
    .replace(/\s*\|\s*/g, "\t")
    .split(/\t+|\s{2,}/)
    .map((column) => column.trim())
    .filter(Boolean);
}

function isTableHeader(columns: string[]) {
  return columns.length === 3 && columns.map(normalizeWord).join("|") === "DIA|COMIDA|CENA";
}

export function parseMenuTextLocally(text: string): LocalParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return { kind: "ambiguous", reason: "empty" };

  const days = new Map<ImportedMenuDay["dayName"], ImportedMenuDay>();
  // Meals given for each day written as a header block (rows give both at once).
  const given = new Map<ImportedMenuDay["dayName"], Set<"lunch" | "dinner">>();
  let currentDay: ImportedMenuDay["dayName"] | null = null;

  for (const line of lines) {
    const columns = splitColumns(line);

    if (isTableHeader(columns)) {
      currentDay = null;
      continue;
    }

    const rowDay = columns.length === 3 ? normalizeDayName(columns[0]) : null;

    if (rowDay) {
      if (days.has(rowDay)) return { kind: "ambiguous", reason: "repeated_day" };
      if (columns[1].length > maxLocalTitleLength || columns[2].length > maxLocalTitleLength) {
        return { kind: "ambiguous", reason: "title_too_long" };
      }
      days.set(rowDay, { dayName: rowDay, lunch: createMealSlot(columns[1]), dinner: createMealSlot(columns[2]) });
      currentDay = null;
      continue;
    }

    const headerDay = normalizeDayName(line);

    if (headerDay) {
      if (days.has(headerDay)) return { kind: "ambiguous", reason: "repeated_day" };
      days.set(headerDay, createEmptyImportedDay(headerDay));
      given.set(headerDay, new Set());
      currentDay = headerDay;
      continue;
    }

    const meal = line.match(/^(comida|cena)\s*:\s*(.*)$/i);

    if (!meal) return { kind: "ambiguous", reason: "unrecognized_line" };
    if (!currentDay) return { kind: "ambiguous", reason: "meal_without_day" };

    const key = meal[1].toLowerCase() === "comida" ? "lunch" : "dinner";
    const seen = given.get(currentDay)!;
    if (seen.has(key)) return { kind: "ambiguous", reason: "repeated_meal" };
    if (meal[2].trim().length > maxLocalTitleLength) return { kind: "ambiguous", reason: "title_too_long" };
    seen.add(key);
    days.set(currentDay, { ...days.get(currentDay)!, [key]: createMealSlot(meal[2]) });
  }

  if (!days.size) return { kind: "ambiguous", reason: "no_days" };

  const ordered = orderedDayNames.filter((dayName) => days.has(dayName));
  const warnings: string[] = [];

  for (const dayName of ordered) {
    const seen = given.get(dayName);
    if (!seen) continue;
    if (!seen.size) warnings.push(`${dayName}: no tiene platos; queda libre.`);
    else if (!seen.has("lunch")) warnings.push(`${dayName}: no indica la comida; queda libre.`);
    else if (!seen.has("dinner")) warnings.push(`${dayName}: no indica la cena; queda libre.`);
  }

  return { kind: "parsed", days: ordered.map((dayName) => days.get(dayName)!), warnings };
}

// A paste with no day of the week anywhere is not a weekly menu: answered without the AI (422).
export function mentionsAnyDayName(text: string) {
  return /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(
    text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(),
  );
}

export function hasPlannedDish(days: ImportedMenuDay[]) {
  return days.some((day) => day.lunch.status === "planned" || day.dinner.status === "planned");
}

export function localMenuResponse(days: ImportedMenuDay[], warnings: string[]): ImportedMenuResponse {
  return { week: "Semana importada", days, parsedBy: "local", warnings };
}

// The same checks in the browser (before any request) and in the route (400).
export function validateImportText(
  value: unknown,
  limits: ImportTextLimits,
): { ok: true; text: string } | { ok: false; reason: ImportErrorReason; error: string } {
  const fail = (reason: ImportErrorReason) => ({ ok: false as const, reason, error: importErrorMessage(reason, "", limits) });
  if (value !== undefined && typeof value !== "string") return fail("not_text");
  const text = (value ?? "").trim();
  if (!text) return fail("empty");
  if (text.length > limits.maxTextLength) return fail("too_long");
  if (text.split(/\r?\n/).filter((line) => line.trim()).length > limits.maxLines) return fail("too_many_lines");
  return { ok: true, text };
}

export function importErrorMessage(
  reason: unknown,
  fallback: string,
  limits: ImportTextLimits = { maxTextLength: 8000, maxLines: 80 },
) {
  switch (reason) {
    case "not_text":
      return "El menú pegado debe ser texto.";
    case "empty":
      return "Pega un menú antes de procesarlo.";
    case "too_long":
      return `El menú pegado es demasiado largo (máximo ${limits.maxTextLength} caracteres). Pega solo una semana.`;
    case "too_many_lines":
      return `El menú pegado tiene demasiadas líneas (máximo ${limits.maxLines}). Pega solo una semana.`;
    case "no_menu_found":
      return "No encontramos ningún día de la semana en el texto. Escribe cada día (Lunes, Martes…) con su comida y su cena.";
    case "empty_menu":
      return "No hemos encontrado ningún plato en el menú. Revisa que cada día tenga su comida o su cena.";
    default:
      return fallback;
  }
}
