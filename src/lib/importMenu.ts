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

// A day label as menus write it: the full name, an abbreviation («Lun», «Mié.»), one letter of
// «L M X J V S D» or «Día 1» to «Día 7» (Día 1 is Monday). Only a whole label counts: a line or a
// cell that is just the day, never a word inside a dish.
const dayLabels: Record<string, ImportedMenuDay["dayName"]> = {
  LUNES: "Lunes",
  MARTES: "Martes",
  MIERCOLES: "Miércoles",
  JUEVES: "Jueves",
  VIERNES: "Viernes",
  SABADO: "Sábado",
  DOMINGO: "Domingo",
  LUN: "Lunes",
  MAR: "Martes",
  MIE: "Miércoles",
  MIER: "Miércoles",
  MIERC: "Miércoles",
  JUE: "Jueves",
  VIE: "Viernes",
  SAB: "Sábado",
  DOM: "Domingo",
  L: "Lunes",
  M: "Martes",
  X: "Miércoles",
  J: "Jueves",
  V: "Viernes",
  S: "Sábado",
  D: "Domingo",
};

function normalizeDayName(value: string): ImportedMenuDay["dayName"] | null {
  const numbered = value.trim().match(/^d[ií]a\s*([1-7])\s*[:.]?$/i);
  if (numbered) return orderedDayNames[Number(numbered[1]) - 1];

  return dayLabels[normalizeWord(value)] ?? null;
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

// «LIBRE», «Libre.», «-», «–», «—», «·», «x» or «/»: nothing planned for that meal.
const freeMealPattern = /^([-–—·x/]|libre\.?)$/i;

function createMealSlot(rawValue: string): ImportedMealSlot {
  const dishName = rawValue.trim();

  if (!dishName || freeMealPattern.test(dishName)) {
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
  | "no_days"
  // C6 review: «Comida: X; Cena: Y» in one line, or a «Cena:» label in the lunch cell.
  | "several_meals_in_line"
  | "label_mismatch"
  // Columns split by spaces only when every such row has 3 aligned columns (a fixed-width table).
  | "unaligned_columns";

export const maxLocalTitleLength = 120;

export type ImportErrorReason =
  | "not_text"
  | "empty"
  | "too_long"
  | "too_many_lines"
  | "no_menu_found"
  | "empty_menu";

export type ImportTextLimits = { maxTextLength: number; maxLines: number };

// Text and import limits the browser checks before any request; the route uses the same values
// (aiRequestLimits.importMenu repeats them; a test keeps both equal). Kept here so client code never
// imports the server folder.
export const importTextLimits: ImportTextLimits = { maxTextLength: 8000, maxLines: 80 };

const mealLabel = /^(comida|cena)\s*:\s*(.*)$/i;
const anyMealLabel = /\b(comida|cena)\s*:/i;

type SplitRow = { columns: string[]; spaced: boolean; offsets: number[] };

// One separator per line: tab if there is one, else «|», else two or more spaces. Inside a tab or
// pipe row, spaces belong to the dish name («Lentejas con  chorizo»).
function splitRow(line: string): SplitRow | null {
  if (line.includes("\t") || line.includes("|")) {
    const cells = line.split(line.includes("\t") ? "\t" : "|").map((cell) => cell.trim());
    if (!line.includes("\t") && cells[0] === "") cells.shift();
    while (cells.length && cells[cells.length - 1] === "") cells.pop();
    return { columns: cells, spaced: false, offsets: [] };
  }
  const separators = [...line.matchAll(/\s{2,}/g)];
  if (!separators.length) return null;
  return {
    columns: line.split(/\s{2,}/).map((cell) => cell.trim()),
    spaced: true,
    offsets: separators.map((match) => (match.index ?? 0) + match[0].length),
  };
}

function isTableHeader(columns: string[]) {
  return columns.length === 3 && columns.map(normalizeWord).join("|") === "DIA|COMIDA|CENA";
}

// A cell may repeat its own label («Comida: Lentejas»); the other meal's label is ambiguous.
function cellValue(cell: string, expected: "comida" | "cena"): string | null {
  const labelled = cell.match(mealLabel);
  const value = labelled ? (labelled[1].toLowerCase() === expected ? labelled[2] : null) : cell;
  return value === null || anyMealLabel.test(value) ? null : value.trim();
}

export function parseMenuTextLocally(text: string): LocalParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return { kind: "ambiguous", reason: "empty" };

  const byDay = parseDayLines(lines);
  if (byDay.kind === "parsed") return byDay;

  // Tables whose days are not in a first column: days across the top, or no days at all.
  return parseDaysAcross(lines) ?? parseRowsInOrder(lines) ?? byDay;
}

const sequentialDaysWarning =
  "El menú no dice los días: hemos puesto la primera fila en el lunes, la segunda en el martes y así sucesivamente.";

// Only tab or «|» tables: with spaces alone, a dish name cannot be told apart from a column.
function splitTableRow(line: string) {
  const row = splitRow(line);
  return row && !row.spaced ? row.columns : null;
}

function mealOfLabel(cell: string): "lunch" | "dinner" | null {
  const word = normalizeWord(cell);
  if (word === "COMIDA" || word === "ALMUERZO") return "lunch";
  if (word === "CENA") return "dinner";
  return null;
}

function validTitles(...titles: string[]) {
  return titles.every((title) => !anyMealLabel.test(title) && title.trim().length <= maxLocalTitleLength);
}

// Days as columns: a header row of days («L M X J V», «Lunes | Martes…», «Día 1 | Día 2…»), maybe
// after an empty or «Día» corner cell, then one row of lunches and one of dinners. A row may start
// with «Comida»/«Cena»; without labels the first row is lunch and the second dinner.
function parseDaysAcross(lines: string[]): LocalParseResult | null {
  const [headerLine, ...rows] = lines;
  let header = splitTableRow(headerLine) ?? headerLine.split(/\s+/);
  if (header.length >= 2 && (header[0] === "" || normalizeWord(header[0]) === "DIA")) header = header.slice(1);
  const dayNames = header.map(normalizeDayName);
  if (header.length < 2 || dayNames.some((day) => !day) || new Set(dayNames).size !== dayNames.length) return null;
  if (!rows.length || rows.length > 2) return null;

  const meals: Partial<Record<"lunch" | "dinner", string[]>> = {};
  for (const [index, line] of rows.entries()) {
    const cells = splitTableRow(line);
    if (!cells) return null;
    let meal: "lunch" | "dinner" | null = index === 0 ? "lunch" : "dinner";
    let values = cells;
    if (cells.length === dayNames.length + 1) {
      meal = mealOfLabel(cells[0]);
      values = cells.slice(1);
    }
    if (!meal || meals[meal] || values.length !== dayNames.length || !validTitles(...values)) return null;
    meals[meal] = values;
  }

  const days = new Map<ImportedMenuDay["dayName"], ImportedMenuDay>();
  dayNames.forEach((dayName, index) =>
    days.set(dayName!, {
      dayName: dayName!,
      lunch: createMealSlot(meals.lunch?.[index] ?? ""),
      dinner: createMealSlot(meals.dinner?.[index] ?? ""),
    }),
  );
  const warnings = [
    ...(meals.lunch ? [] : ["El menú no indica las comidas; quedan libres."]),
    ...(meals.dinner ? [] : ["El menú no indica las cenas; quedan libres."]),
  ];
  return {
    kind: "parsed",
    days: orderedDayNames.filter((dayName) => days.has(dayName)).map((dayName) => days.get(dayName)!),
    warnings,
  };
}

// No days at all: rows of two cells (lunch, dinner), maybe under a «Comida | Cena» header. The
// first row is Monday, the second Tuesday… up to seven rows.
function parseRowsInOrder(lines: string[]): LocalParseResult | null {
  const rows = lines.map(splitTableRow);
  if (rows.some((row) => !row || row.length !== 2)) return null;
  const cells = rows as string[][];
  // A header of days whose columns did not fit is not a row of dishes.
  if (cells.some((row) => row.every((cell) => normalizeDayName(cell)))) return null;
  const body =
    mealOfLabel(cells[0][0]) === "lunch" && mealOfLabel(cells[0][1]) === "dinner" ? cells.slice(1) : cells;
  if (!body.length || body.length > orderedDayNames.length) return null;
  if (body.some(([lunch, dinner]) => !validTitles(lunch, dinner))) return null;

  return {
    kind: "parsed",
    days: body.map(([lunch, dinner], index) => ({
      dayName: orderedDayNames[index],
      lunch: createMealSlot(lunch),
      dinner: createMealSlot(dinner),
    })),
    warnings: [sequentialDaysWarning],
  };
}

// Days named in each line or row: «Lunes» headers with «Comida:»/«Cena:» lines, or rows of
// day, lunch and dinner.
function parseDayLines(lines: string[]): LocalParseResult {

  const days = new Map<ImportedMenuDay["dayName"], ImportedMenuDay>();
  // Meals given for each day written as a header block (rows give both at once).
  const given = new Map<ImportedMenuDay["dayName"], Set<"lunch" | "dinner">>();
  let currentDay: ImportedMenuDay["dayName"] | null = null;

  const spacedRows: SplitRow[] = [];
  const emptyCells: string[] = [];

  for (const line of lines) {
    const meal = line.match(mealLabel);

    if (meal) {
      if (!currentDay) return { kind: "ambiguous", reason: "meal_without_day" };
      if (anyMealLabel.test(meal[2])) return { kind: "ambiguous", reason: "several_meals_in_line" };
      const key = meal[1].toLowerCase() === "comida" ? "lunch" : "dinner";
      const seen = given.get(currentDay)!;
      if (seen.has(key)) return { kind: "ambiguous", reason: "repeated_meal" };
      if (meal[2].trim().length > maxLocalTitleLength) return { kind: "ambiguous", reason: "title_too_long" };
      seen.add(key);
      days.set(currentDay, { ...days.get(currentDay)!, [key]: createMealSlot(meal[2]) });
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

    const row = splitRow(line);

    if (!row || row.columns.length !== 3) return { kind: "ambiguous", reason: "unrecognized_line" };
    if (row.spaced) spacedRows.push(row);
    currentDay = null;

    if (isTableHeader(row.columns)) continue;

    const rowDay = normalizeDayName(row.columns[0]);
    if (!rowDay) return { kind: "ambiguous", reason: "unrecognized_line" };
    if (days.has(rowDay)) return { kind: "ambiguous", reason: "repeated_day" };

    const lunch = cellValue(row.columns[1], "comida");
    const dinner = cellValue(row.columns[2], "cena");
    if (lunch === null || dinner === null) return { kind: "ambiguous", reason: "label_mismatch" };
    if (lunch.length > maxLocalTitleLength || dinner.length > maxLocalTitleLength) {
      return { kind: "ambiguous", reason: "title_too_long" };
    }
    if (!lunch) emptyCells.push(`${rowDay}: la comida está vacía; queda libre.`);
    if (!dinner) emptyCells.push(`${rowDay}: la cena está vacía; queda libre.`);
    days.set(rowDay, { dayName: rowDay, lunch: createMealSlot(lunch), dinner: createMealSlot(dinner) });
  }

  // Columns by spaces only for a real fixed-width table: at least two rows, all aligned. A single
  // line like «Lunes  Lentejas con  chorizo» cannot be told apart from a dish with two spaces.
  if (spacedRows.length) {
    const [first] = spacedRows;
    const aligned =
      spacedRows.length >= 2 &&
      spacedRows.every((row) => row.offsets.length === 2 && row.offsets.every((offset, index) => offset === first.offsets[index]));
    if (!aligned) return { kind: "ambiguous", reason: "unaligned_columns" };
  }

  if (!days.size) return { kind: "ambiguous", reason: "no_days" };

  const ordered = orderedDayNames.filter((dayName) => days.has(dayName));
  const warnings: string[] = [...emptyCells];

  for (const dayName of ordered) {
    const seen = given.get(dayName);
    if (!seen) continue;
    if (!seen.size) warnings.push(`${dayName}: no tiene platos; queda libre.`);
    else if (!seen.has("lunch")) warnings.push(`${dayName}: no indica la comida; queda libre.`);
    else if (!seen.has("dinner")) warnings.push(`${dayName}: no indica la cena; queda libre.`);
  }

  return { kind: "parsed", days: ordered.map((dayName) => days.get(dayName)!), warnings };
}

// A paste with no day of the week and no sign of a menu is not a weekly menu: answered without the
// AI (422). Lenient on purpose: it only decides whether the AI is worth asking, so abbreviations
// («lun», «mié», «sáb»…), one-letter days as a cell or line («L», «X:»), «Día 1»…, English names,
// meal words and tables (the AI reads their rows in order as Monday, Tuesday…) also count.
export function mentionsAnyDayName(text: string) {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const tableRows = normalized.split(/\n/).filter((line) => /\S\s*(\t|\|)\s*\S/.test(line)).length;
  return (
    /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|lun|mar|mie|jue|vie|sab|dom)\b/.test(normalized) ||
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/.test(normalized) ||
    /(^|\n|\t|\|)[ ]*[lmxjvsd][ ]*([:.\t|-]|\n|$)/.test(normalized) ||
    /\bdia\s*[1-7]\b/.test(normalized) ||
    /\b(comida|cena|almuerzo)s?\b/.test(normalized) ||
    tableRows >= 2
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
  limits: ImportTextLimits = importTextLimits,
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
      return "No encontramos ningún día ni ninguna comida en el texto. Escribe cada día (Lunes, Martes… o L, M, X…) con su comida y su cena.";
    case "empty_menu":
      return "No hemos encontrado ningún plato en el menú. Revisa que cada día tenga su comida o su cena.";
    case "empty_menu_ai":
      return "La IA no ha encontrado ningún plato en el menú y esta lectura cuenta como una de tus importaciones de hoy. Revisa que cada día tenga su comida o su cena.";
    default:
      return fallback;
  }
}
