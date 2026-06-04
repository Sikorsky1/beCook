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

type WeekRow = {
  id: string;
  title: string | null;
};

type WeekDayRow = {
  day_name: string | null;
  position: number | null;
  lunch_status: string | null;
  lunch_dish_name: string | null;
  dinner_status: string | null;
  dinner_dish_name: string | null;
};

type SaveWeekToSupabaseOptions = {
  generationRequestId?: string;
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

function parseMealStatus(status: string | null, columnName: string): MealStatus {
  if (status === "planned" || status === "free") {
    return status;
  }

  throw new Error(`Unexpected meal status in ${columnName}: ${status ?? "null"}.`);
}

function buildMealSlot(
  status: string | null,
  dishName: string | null,
  columnName: string,
): SupabaseMealSlot {
  const parsedStatus = parseMealStatus(status, columnName);

  return {
    status: parsedStatus,
    dishName: parsedStatus === "free" ? "" : dishName ?? "",
  };
}

export async function saveWeekToSupabase(
  week: SupabaseWeek,
  options: SaveWeekToSupabaseOptions = {},
) {
  if (!supabase) {
    throw new Error(
      "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  if (!Array.isArray(week.days) || week.days.length === 0) {
    throw new Error("Cannot save a week without days.");
  }

  const weekRow = options.generationRequestId
    ? {
        title: week.title ?? "",
        generation_request_id: options.generationRequestId,
      }
    : { title: week.title ?? "" };
  let weekInsert = await supabase
    .from("weeks")
    .insert(weekRow)
    .select("id")
    .single();

  if (weekInsert.error && options.generationRequestId) {
    console.warn(
      "No se pudo vincular la semana al request de generación en weeks.generation_request_id; se guardará la semana sin ese vínculo:",
      weekInsert.error.message,
    );

    weekInsert = await supabase
      .from("weeks")
      .insert({ title: week.title ?? "" })
      .select("id")
      .single();
  }

  if (weekInsert.error) {
    throw new Error(`Could not save week: ${weekInsert.error.message}`);
  }

  if (!weekInsert.data?.id) {
    throw new Error("Could not save week: Supabase did not return a week id.");
  }

  const weekId = weekInsert.data.id as string;
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

export async function getLatestWeekFromSupabase(): Promise<SupabaseWeek | null> {
  if (!supabase) {
    throw new Error(
      "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  const { data: latestWeek, error: weekError } = await supabase
    .from("weeks")
    .select("id,title")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<WeekRow>();

  if (weekError) {
    throw new Error(`Could not read latest week: ${weekError.message}`);
  }

  if (!latestWeek) {
    return null;
  }

  const { data: weekDays, error: daysError } = await supabase
    .from("week_days")
    .select(
      "day_name,position,lunch_status,lunch_dish_name,dinner_status,dinner_dish_name",
    )
    .eq("week_id", latestWeek.id)
    .order("position", { ascending: true });

  if (daysError) {
    throw new Error(`Could not read latest week days: ${daysError.message}`);
  }

  return {
    title: latestWeek.title ?? "",
    days: ((weekDays ?? []) as WeekDayRow[]).map((day) => ({
      dayName: day.day_name ?? "",
      lunch: buildMealSlot(
        day.lunch_status,
        day.lunch_dish_name,
        "week_days.lunch_status",
      ),
      dinner: buildMealSlot(
        day.dinner_status,
        day.dinner_dish_name,
        "week_days.dinner_status",
      ),
    })),
  };
}
