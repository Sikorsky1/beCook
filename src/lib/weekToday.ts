import type { WeekDay } from "@/data/mockWeek";
import {
  getDayPosition,
  getIsoWeekStorageId,
  isSameIsoWeek,
  type getMadridToday,
  type IsoWeek,
} from "@/lib/isoWeek";

// Step 29: the week opens on «Hoy». Today comes only from isoWeek (Madrid calendar day) and the
// week shown is always the selected one (URL, B3); today never changes the selection.

export type MadridToday = ReturnType<typeof getMadridToday>;

export type WeekTodayLayout = {
  // Position of today inside the selected week, or null when another week is shown.
  todayPosition: number | null;
  // Today's card; null when the week is not the current one or a partial week has no today.
  todayDay: WeekDay | null;
  // Every other day, Monday → Sunday, shown compact.
  otherDays: WeekDay[];
};

export function getWeekTodayLayout(
  weekDays: WeekDay[],
  selectedWeek: IsoWeek,
  today: MadridToday | null,
): WeekTodayLayout {
  const todayPosition = today && isSameIsoWeek(selectedWeek, today.week) ? today.position : null;
  const todayDay =
    todayPosition === null
      ? null
      : (weekDays.find((day) => getDayPosition(day.day) === todayPosition) ?? null);

  return {
    todayPosition,
    todayDay,
    otherDays: weekDays.filter((day) => day !== todayDay),
  };
}

// A day chosen in the strip belongs to the week it was chosen in; it never defaults to today.
export type DaySelection = { weekId: string; position: number } | null;

export function selectedPositionFor(selection: DaySelection, selectedWeek: IsoWeek) {
  return selection && selection.weekId === getIsoWeekStorageId(selectedWeek)
    ? selection.position
    : null;
}

export type DayStripCell = {
  position: number;
  hasMenu: boolean;
  // One accent for today, everywhere in the page.
  isToday: boolean;
  // Selection is only an outline, and only after the user picks a day.
  isSelected: boolean;
};

export function getDayStripCells(
  presentPositions: ReadonlySet<number>,
  todayPosition: number | null,
  selectedPosition: number | null,
): DayStripCell[] {
  return Array.from({ length: 7 }, (_, position) => {
    const hasMenu = presentPositions.has(position);

    return {
      position,
      hasMenu,
      isToday: todayPosition === position,
      isSelected: hasMenu && selectedPosition === position,
    };
  });
}

// An open page keeps «today» right across midnight (Madrid) without a reload.
export function nextMadridToday(current: MadridToday | null, now: MadridToday) {
  return current && current.dateKey === now.dateKey ? current : now;
}
