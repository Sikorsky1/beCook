import type { MealSlot, WeekDay } from "@/data/mockWeek";
import type { SupabaseWeek } from "@/lib/supabase/weeks";

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
};

export async function saveWeekWithSupabaseSync(
  weekDays: WeekDay[],
  options: SaveWeekWithSupabaseSyncOptions = {},
) {
  saveWeek(weekDays);

  try {
    const week = weekDaysToSupabaseWeek(weekDays);
    const { getCurrentUser } = await import("@/lib/supabase/auth");
    const { saveWeekToSupabase } = await import("@/lib/supabase/weeks");
    const currentUser = await getCurrentUser();
    const weekId = await saveWeekToSupabase(week, {
      generationRequestId: options.generationRequestId ?? undefined,
      userId: currentUser?.id,
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
