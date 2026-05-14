import type { WeekDay } from "@/data/mockWeek";

const WEEK_STORAGE_KEY = "becook-week";

export function readSavedWeek(): WeekDay[] | null {
  if (typeof window === "undefined") {
    return null;
  }

  const savedWeek = window.localStorage.getItem(WEEK_STORAGE_KEY);

  if (!savedWeek) {
    return null;
  }

  try {
    const parsedWeek = JSON.parse(savedWeek);

    if (!Array.isArray(parsedWeek)) {
      return null;
    }

    return parsedWeek;
  } catch {
    return null;
  }
}

export function saveWeek(weekDays: WeekDay[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(WEEK_STORAGE_KEY, JSON.stringify(weekDays));
}
