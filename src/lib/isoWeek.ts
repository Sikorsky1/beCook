// Single source for calendar dates. Dates are pure calendar days computed in UTC, so neither the
// browser's time zone nor DST can move a day; «today» is always the calendar day in Europe/Madrid.

export type IsoWeek = {
  isoYear: number;
  isoWeek: number;
};

export const isoDayNames = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
] as const;

export type IsoDayName = (typeof isoDayNames)[number];

export type IsoWeekDay = {
  dayName: IsoDayName;
  position: number;
  dateKey: string;
  dayOfMonth: number;
  label: string;
};

export type IsoWeekValidation =
  | { ok: true; week: IsoWeek }
  | { ok: false; reason: "format" | "range" | "no-week-53"; input: string };

const monthNames = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

// Same abbreviations as es-ES `month: "short"`, fixed so the text never depends on the browser.
const shortMonthNames = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sept",
  "oct",
  "nov",
  "dic",
];

const minIsoYear = 2000;
const maxIsoYear = 2100;
const dayMs = 24 * 60 * 60 * 1000;

function utcDay(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day));
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * dayMs);
}

function dayPosition(date: Date) {
  return (date.getUTCDay() + 6) % 7;
}

function isoWeekOfDay(date: Date): IsoWeek {
  const thursday = addDays(date, 3 - dayPosition(date));
  const isoYear = thursday.getUTCFullYear();
  const dayOfYear = Math.round(
    (thursday.getTime() - Date.UTC(isoYear, 0, 1)) / dayMs,
  );

  return { isoYear, isoWeek: Math.floor(dayOfYear / 7) + 1 };
}

function isoWeekMonday({ isoYear, isoWeek }: IsoWeek) {
  const jan4 = utcDay(isoYear, 0, 4);

  return addDays(jan4, (isoWeek - 1) * 7 - dayPosition(jan4));
}

function toDateKey(date: Date) {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${date.getUTCFullYear()}-${month}-${day}`;
}

export function weeksInIsoYear(isoYear: number) {
  // 28 December always falls in the last ISO week of its year.
  return isoWeekOfDay(utcDay(isoYear, 11, 28)).isoWeek;
}

export function getDayPosition(dayName: string) {
  return isoDayNames.indexOf(dayName as IsoDayName);
}

export function getIsoWeekDays(isoWeek: IsoWeek): IsoWeekDay[] {
  const monday = isoWeekMonday(isoWeek);

  return isoDayNames.map((dayName, position) => {
    const date = addDays(monday, position);

    return {
      dayName,
      position,
      dateKey: toDateKey(date),
      dayOfMonth: date.getUTCDate(),
      label: `${date.getUTCDate()} ${shortMonthNames[date.getUTCMonth()]}`,
    };
  });
}

export function getIsoWeekDay(isoWeek: IsoWeek, dayName: string) {
  const position = getDayPosition(dayName);

  return position === -1 ? null : getIsoWeekDays(isoWeek)[position];
}

const madridDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function getMadridToday(now = new Date()) {
  const parts = Object.fromEntries(
    madridDateFormatter.formatToParts(now).map((part) => [part.type, part.value]),
  );
  const date = utcDay(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  const position = dayPosition(date);

  return {
    dateKey: toDateKey(date),
    week: isoWeekOfDay(date),
    position,
    dayName: isoDayNames[position],
  };
}

export function getCurrentIsoWeek(now = new Date()) {
  return getMadridToday(now).week;
}

export function addIsoWeeks(isoWeek: IsoWeek, offset: number): IsoWeek {
  return isoWeekOfDay(addDays(isoWeekMonday(isoWeek), offset * 7));
}

export function isSameIsoWeek(left: IsoWeek, right: IsoWeek) {
  return left.isoYear === right.isoYear && left.isoWeek === right.isoWeek;
}

export function getIsoWeekStorageId({ isoYear, isoWeek }: IsoWeek) {
  return `${isoYear}-W${String(isoWeek).padStart(2, "0")}`;
}

export function formatIsoWeekTitle(
  isoWeek: IsoWeek,
  { compact = false }: { compact?: boolean } = {},
) {
  const monday = isoWeekMonday(isoWeek);
  const sunday = addDays(monday, 6);
  const months = compact ? shortMonthNames : monthNames;
  const startMonth = months[monday.getUTCMonth()];
  const endMonth = months[sunday.getUTCMonth()];

  if (monday.getUTCFullYear() !== sunday.getUTCFullYear()) {
    return `${monday.getUTCDate()} ${startMonth} ${monday.getUTCFullYear()} – ${sunday.getUTCDate()} ${endMonth} ${sunday.getUTCFullYear()}`;
  }

  if (startMonth === endMonth) {
    return `${monday.getUTCDate()}–${sunday.getUTCDate()} ${endMonth}`;
  }

  return `${monday.getUTCDate()} ${startMonth} – ${sunday.getUTCDate()} ${endMonth}`;
}

export function validateIsoWeek(isoYear: unknown, isoWeek: unknown): IsoWeekValidation {
  const input = `${String(isoYear)}-W${String(isoWeek).padStart(2, "0")}`;
  const year = typeof isoYear === "string" && isoYear.trim() === "" ? NaN : Number(isoYear);
  const week = typeof isoWeek === "string" && isoWeek.trim() === "" ? NaN : Number(isoWeek);

  if (!Number.isInteger(year) || !Number.isInteger(week)) {
    return { ok: false, reason: "format", input };
  }

  if (year < minIsoYear || year > maxIsoYear || week < 1 || week > 53) {
    return { ok: false, reason: "range", input };
  }

  if (week > weeksInIsoYear(year)) {
    return { ok: false, reason: "no-week-53", input };
  }

  return { ok: true, week: { isoYear: year, isoWeek: week } };
}

export function parseIsoWeekId(value: string | null | undefined): IsoWeekValidation {
  const match = /^(\d{4})-W(\d{2})$/.exec(value ?? "");

  return match
    ? validateIsoWeek(match[1], match[2])
    : { ok: false, reason: "format", input: value ?? "" };
}

export function parseIsoWeek(value: {
  isoYear?: unknown;
  isoWeek?: unknown;
}): IsoWeek | null {
  const result = validateIsoWeek(value.isoYear, value.isoWeek);

  return result.ok ? result.week : null;
}

export function describeInvalidIsoWeek(result: Extract<IsoWeekValidation, { ok: false }>) {
  if (result.reason === "no-week-53") {
    return `${result.input.slice(0, 4)} no tiene semana 53`;
  }

  return `«${result.input}» no es una semana válida`;
}
