import type { MealSlot, WeekDay } from "@/data/mockWeek";
import { getDayPosition, getIsoWeekDay, type IsoWeek } from "@/lib/isoWeek";
import type { SupabaseMealSlot, SupabaseWeek } from "@/lib/supabase/weeks";

// Pure week helpers. Persistence lives in @/lib/data/repositories (scoped by identity).

// Each day is dated by its name inside the ISO week, never by its index: a partial week
// (only Wednesday, or skipped days) keeps the real dates. Days are returned Monday→Sunday.
export function withWeekDates(weekDays: WeekDay[], isoWeek: IsoWeek) {
  const order = (day: WeekDay) => {
    const position = getDayPosition(day.day);
    return position === -1 ? Number.MAX_SAFE_INTEGER : position;
  };

  return [...weekDays]
    .sort((left, right) => order(left) - order(right))
    .map((day) => ({
      ...day,
      date: getIsoWeekDay(isoWeek, day.day)?.label ?? "",
    }));
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

function supabaseMealSlotToWeekMeal(slot: SupabaseMealSlot) {
  return slot.status === "free" ? "LIBRE" : slot.dishName;
}

export function supabaseWeekToWeekDays(week: SupabaseWeek, isoWeek: IsoWeek): WeekDay[] {
  return withWeekDates(
    week.days.map((day) => ({
      day: day.dayName,
      date: "",
      lunch: supabaseMealSlotToWeekMeal(day.lunch),
      dinner: supabaseMealSlotToWeekMeal(day.dinner),
    })),
    isoWeek,
  );
}
