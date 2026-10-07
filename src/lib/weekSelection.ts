import {
  describeInvalidIsoWeek,
  getIsoWeekStorageId,
  parseIsoWeekId,
  validateIsoWeek,
  type IsoWeek,
  type IsoWeekValidation,
} from "@/lib/isoWeek";

// The selected week lives in the URL (?week=YYYY-Www). The stored preference and today are only
// the starting point when the URL has none; an invalid URL is replaced, never silently shifted.

export type WeekSelection = {
  week: IsoWeek;
  needsReplace: boolean;
  notice: string | null;
};

export function resolveWeekSelection({
  weekParam,
  isoYearParam,
  isoWeekParam,
  preference,
  today,
}: {
  weekParam: string | null;
  isoYearParam: string | null;
  isoWeekParam: string | null;
  preference: IsoWeek | null;
  today: IsoWeek;
}): WeekSelection {
  let result: IsoWeekValidation | null = null;

  if (weekParam !== null) {
    result = parseIsoWeekId(weekParam);
  } else if (isoYearParam !== null || isoWeekParam !== null) {
    // Links from before B3 (?isoYear=&isoWeek=) are understood and rewritten.
    result = validateIsoWeek(isoYearParam, isoWeekParam);
  }

  if (!result) {
    return { week: preference ?? today, needsReplace: true, notice: null };
  }

  if (!result.ok) {
    return {
      week: today,
      needsReplace: true,
      notice: `${describeInvalidIsoWeek(result)}. Mostramos la semana actual.`,
    };
  }

  return { week: result.week, needsReplace: weekParam === null, notice: null };
}

export function buildWeekHref(path: "/week" | "/create-menu", isoWeek: IsoWeek) {
  return `${path}?week=${getIsoWeekStorageId(isoWeek)}`;
}
