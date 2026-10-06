import type { MealSlot, WeekDay } from "@/data/mockWeek";
import { getIsoWeekStartDate, type IsoWeek } from "@/lib/isoWeek";
import type { SupabaseMealSlot, SupabaseWeek } from "@/lib/supabase/weeks";

// Pure week helpers. Persistence lives in @/lib/data/repositories (scoped by identity).

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
