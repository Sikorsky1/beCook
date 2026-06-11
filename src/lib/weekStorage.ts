import type { MealSlot, WeekDay } from "@/data/mockWeek";
import {
  getIsoWeekFromDate,
  getIsoWeekStartDate,
  getIsoWeekStorageId,
  parseIsoWeek,
  type IsoWeek,
} from "@/lib/isoWeek";
import type { SupabaseWeek } from "@/lib/supabase/weeks";

const WEEK_STORAGE_KEY = "becook-week";
const SELECTED_ISO_WEEK_STORAGE_KEY = "becook-selected-iso-week";

function getWeekStorageKey(isoWeek?: IsoWeek | null) {
  return isoWeek
    ? `${WEEK_STORAGE_KEY}:${getIsoWeekStorageId(isoWeek)}`
    : WEEK_STORAGE_KEY;
}

export function readSelectedIsoWeek(): IsoWeek | null {
  if (typeof window === "undefined") {
    return null;
  }

  const savedIsoWeek = window.localStorage.getItem(
    SELECTED_ISO_WEEK_STORAGE_KEY,
  );

  if (!savedIsoWeek) {
    return null;
  }

  try {
    return parseIsoWeek(JSON.parse(savedIsoWeek));
  } catch {
    return null;
  }
}

export function saveSelectedIsoWeek(isoWeek: IsoWeek) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    SELECTED_ISO_WEEK_STORAGE_KEY,
    JSON.stringify(isoWeek),
  );
}

export function readSavedWeek(isoWeek?: IsoWeek | null): WeekDay[] | null {
  if (typeof window === "undefined") {
    return null;
  }

  const selectedIsoWeek = isoWeek ?? readSelectedIsoWeek();
  const savedWeek = window.localStorage.getItem(
    getWeekStorageKey(selectedIsoWeek),
  );

  if (!savedWeek) {
    const legacyWeek = selectedIsoWeek
      ? null
      : window.localStorage.getItem(WEEK_STORAGE_KEY);

    if (!legacyWeek) {
      return null;
    }

    return parseSavedWeek(legacyWeek);
  }

  return parseSavedWeek(savedWeek);
}

function parseSavedWeek(savedWeek: string): WeekDay[] | null {
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

export function saveWeek(weekDays: WeekDay[], isoWeek?: IsoWeek | null) {
  if (typeof window === "undefined") {
    return;
  }

  const weekForStorage = isoWeek ?? readSelectedIsoWeek() ?? getIsoWeekFromDate();

  window.localStorage.setItem(
    getWeekStorageKey(weekForStorage),
    JSON.stringify(weekDays),
  );
  saveSelectedIsoWeek(weekForStorage);
}

export function clearSavedWeek(isoWeek: IsoWeek) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(getWeekStorageKey(isoWeek));
}

export function withWeekDates(weekDays: WeekDay[], isoWeek: IsoWeek) {
  const startDate = getIsoWeekStartDate(isoWeek);

  return weekDays.map((day, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);

    return {
      ...day,
      date: `${date.getDate()} ${date.toLocaleDateString("es-ES", {
        month: "short",
      })}`,
    };
  });
}

function mealSlotToSupabase(slot: MealSlot) {
  if (slot === "LIBRE") {
    return {
      status: "free" as const,
      dishName: "",
    };
  }

  return {
    status: "planned" as const,
    dishName: slot,
  };
}

export function weekDaysToSupabaseWeek(weekDays: WeekDay[]): SupabaseWeek {
  return {
    days: weekDays.map((day) => ({
      dayName: day.day,
      lunch: mealSlotToSupabase(day.lunch),
      dinner: mealSlotToSupabase(day.dinner),
    })),
  };
}

type SaveWeekWithSupabaseSyncOptions = {
  generationRequestId?: string | null;
  isoYear?: number | null;
  isoWeek?: number | null;
  replaceExisting?: boolean;
};

export async function saveWeekWithSupabaseSync(
  weekDays: WeekDay[],
  options: SaveWeekWithSupabaseSyncOptions = {},
) {
  const targetIsoWeek = parseIsoWeek(options) ?? readSelectedIsoWeek();
  saveWeek(weekDays, targetIsoWeek);

  try {
    const week: SupabaseWeek = {
      ...weekDaysToSupabaseWeek(weekDays),
      isoYear: targetIsoWeek?.isoYear ?? null,
      isoWeek: targetIsoWeek?.isoWeek ?? null,
    };
    const { getCurrentUser } = await import("@/lib/supabase/auth");
    const { saveWeekToSupabase } = await import("@/lib/supabase/weeks");
    const currentUser = await getCurrentUser();
    const weekId = await saveWeekToSupabase(week, {
      generationRequestId: options.generationRequestId ?? undefined,
      userId: currentUser?.id,
      isoYear: targetIsoWeek?.isoYear ?? null,
      isoWeek: targetIsoWeek?.isoWeek ?? null,
      replaceExisting: options.replaceExisting,
    });

    if (options.generationRequestId) {
      try {
        const { markMenuGenerationRequestApplied } = await import(
          "@/lib/supabase/menu-generation-requests"
        );

        await markMenuGenerationRequestApplied(
          options.generationRequestId,
          weekId,
        );
      } catch (error: unknown) {
        console.warn(
          "No se pudo marcar el request de generación como aplicado:",
          error instanceof Error ? error.message : error,
        );
      }
    }

    return weekId;
  } catch (error: unknown) {
    console.warn(
      "No se pudo sincronizar la semana actualizada con Supabase:",
      error instanceof Error ? error.message : error,
    );

    return null;
  }
}
