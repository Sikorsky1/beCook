import { supabase } from "./client";

export type MealStatus = "planned" | "free";

export type SupabaseMealSlot = {
  status: MealStatus;
  dishName: string;
};

export type SupabaseWeekDay = {
  dayName: string;
  lunch: SupabaseMealSlot;
  dinner: SupabaseMealSlot;
};

export type SupabaseWeek = {
  title?: string;
  days: SupabaseWeekDay[];
};

const orderedDayNames = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
];

function getDayPosition(dayName: string, fallbackPosition: number) {
  const position = orderedDayNames.indexOf(dayName);

  return position === -1 ? fallbackPosition : position;
}

function getDishNameForStorage(slot: SupabaseMealSlot) {
  return slot.status === "free" ? "" : slot.dishName.trim();
}

export async function saveWeekToSupabase(week: SupabaseWeek) {
  if (!supabase) {
    throw new Error(
      "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  if (!Array.isArray(week.days) || week.days.length === 0) {
    throw new Error("Cannot save a week without days.");
  }

  const { data: insertedWeek, error: weekError } = await supabase
    .from("weeks")
    .insert({ title: week.title ?? "" })
    .select("id")
    .single();

  if (weekError) {
    throw new Error(`Could not save week: ${weekError.message}`);
  }

  if (!insertedWeek?.id) {
    throw new Error("Could not save week: Supabase did not return a week id.");
  }

  const weekId = insertedWeek.id as string;
  const weekDays = week.days
    .map((day, index) => ({
      week_id: weekId,
      day_name: day.dayName,
      position: getDayPosition(day.dayName, index),
      lunch_status: day.lunch.status,
      lunch_dish_name: getDishNameForStorage(day.lunch),
      dinner_status: day.dinner.status,
      dinner_dish_name: getDishNameForStorage(day.dinner),
    }))
    .sort((a, b) => a.position - b.position);

  const { error: daysError } = await supabase
    .from("week_days")
    .insert(weekDays);

  if (daysError) {
    throw new Error(`Could not save week days: ${daysError.message}`);
  }

  return weekId;
}
