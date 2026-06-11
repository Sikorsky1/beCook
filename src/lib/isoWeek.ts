export type IsoWeek = {
  isoYear: number;
  isoWeek: number;
};

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

export function getIsoWeekFromDate(inputDate = new Date()): IsoWeek {
  const date = new Date(inputDate);
  date.setHours(0, 0, 0, 0);

  const dayIndex = (date.getDay() + 6) % 7;
  const thursday = new Date(date);
  thursday.setDate(date.getDate() - dayIndex + 3);

  const isoYear = thursday.getFullYear();
  const firstThursday = new Date(isoYear, 0, 4);
  const firstThursdayDayIndex = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstThursdayDayIndex + 3);

  const isoWeek =
    1 +
    Math.round(
      (thursday.getTime() - firstThursday.getTime()) /
        (7 * 24 * 60 * 60 * 1000),
    );

  return { isoYear, isoWeek };
}

export function getIsoWeekStartDate({ isoYear, isoWeek }: IsoWeek) {
  const jan4 = new Date(isoYear, 0, 4);
  jan4.setHours(0, 0, 0, 0);

  const jan4DayIndex = (jan4.getDay() + 6) % 7;
  const weekOneMonday = new Date(jan4);
  weekOneMonday.setDate(jan4.getDate() - jan4DayIndex);

  const monday = new Date(weekOneMonday);
  monday.setDate(weekOneMonday.getDate() + (isoWeek - 1) * 7);

  return monday;
}

export function getIsoWeekRange(isoWeek: IsoWeek) {
  const startDate = getIsoWeekStartDate(isoWeek);
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 6);

  return { startDate, endDate };
}

export function formatDateForQuery(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function addIsoWeeks(isoWeek: IsoWeek, offset: number): IsoWeek {
  const date = getIsoWeekStartDate(isoWeek);
  date.setDate(date.getDate() + offset * 7);

  return getIsoWeekFromDate(date);
}

export function isSameIsoWeek(left: IsoWeek, right: IsoWeek) {
  return left.isoYear === right.isoYear && left.isoWeek === right.isoWeek;
}

export function getIsoWeekStorageId({ isoYear, isoWeek }: IsoWeek) {
  return `${isoYear}-W${String(isoWeek).padStart(2, "0")}`;
}

export function getIsoWeekKey({ isoYear, isoWeek }: IsoWeek) {
  return `${isoYear}-${isoWeek}`;
}

export function formatIsoWeekRange(isoWeek: IsoWeek) {
  const { startDate, endDate } = getIsoWeekRange(isoWeek);
  const startMonth = monthNames[startDate.getMonth()];
  const endMonth = monthNames[endDate.getMonth()];

  if (startMonth === endMonth) {
    return `${startDate.getDate()}-${endDate.getDate()} ${endMonth}`;
  }

  return `${startDate.getDate()} ${startMonth}-${endDate.getDate()} ${endMonth}`;
}

export function parseIsoWeek(value: {
  isoYear?: unknown;
  isoWeek?: unknown;
}): IsoWeek | null {
  const isoYear = Number(value.isoYear);
  const isoWeek = Number(value.isoWeek);

  if (
    !Number.isInteger(isoYear) ||
    !Number.isInteger(isoWeek) ||
    isoYear < 2000 ||
    isoYear > 2100 ||
    isoWeek < 1 ||
    isoWeek > 53
  ) {
    return null;
  }

  return { isoYear, isoWeek };
}
