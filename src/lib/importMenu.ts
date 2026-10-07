import type { WeekDay } from "@/data/mockWeek";
import type { IsoWeek } from "@/lib/isoWeek";
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
