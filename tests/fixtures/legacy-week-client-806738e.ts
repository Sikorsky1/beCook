// Frozen copy of src/lib/supabase/weeks.ts as served by main (806738e) before B4.
// Used only by scripts/week-write-db-tests.cjs to prove the B4 migration keeps the deployed
// client working during the rollout. Do not edit except for the import path.
import { supabase } from "../../src/lib/supabase/client";

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
  id?: string;
  title?: string;
  isoYear?: number | null;
  isoWeek?: number | null;
  // Remote updated_at, used as the version for local cache revalidation.
  updatedAt?: string | null;
  days: SupabaseWeekDay[];
};

type WeekRow = {
  id: string;
  title: string | null;
  iso_year?: number | null;
  iso_week?: number | null;
  updated_at?: string | null;
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
  userId?: string | null;
  isoYear?: number | null;
  isoWeek?: number | null;
  replaceExisting?: boolean;
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

async function insertWeekRow(
  weekRow: Record<string, string | number | null>,
  baseWeekRow: Record<string, string | number | null>,
  generationRequestId?: string,
) {
  let weekInsert = await supabase!
    .from("weeks")
    .insert(weekRow)
    .select("id")
    .single();

  if (weekInsert.error && generationRequestId) {
    console.warn(
      "No se pudo vincular la semana al request de generación en weeks.generation_request_id; se guardará la semana sin ese vínculo:",
      weekInsert.error.message,
    );

    weekInsert = await supabase!
      .from("weeks")
      .insert(baseWeekRow)
      .select("id")
      .single();
  }

  if (weekInsert.error) {
    throw new Error(`Could not save week: ${weekInsert.error.message}`);
  }

  if (!weekInsert.data?.id) {
    throw new Error("Could not save week: Supabase did not return a week id.");
  }

  return weekInsert.data.id as string;
}

async function replaceWeekDays(weekId: string, week: SupabaseWeek) {
  const { error: deleteDaysError } = await supabase!
    .from("week_days")
    .delete()
    .eq("week_id", weekId);

  if (deleteDaysError) {
    throw new Error(`Could not replace week days: ${deleteDaysError.message}`);
  }

  await insertWeekDays(weekId, week);
}

async function insertWeekDays(weekId: string, week: SupabaseWeek) {
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

  const { error: daysError } = await supabase!
    .from("week_days")
    .insert(weekDays);

  if (daysError) {
    throw new Error(`Could not save week days: ${daysError.message}`);
  }
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

  const baseWeekRow = {
    title: week.title ?? "",
    user_id: options.userId ?? null,
    iso_year: options.isoYear ?? week.isoYear ?? null,
    iso_week: options.isoWeek ?? week.isoWeek ?? null,
  };
  console.log("Saving week with user:", options.userId ?? null);

  const weekRow = options.generationRequestId
    ? {
        ...baseWeekRow,
        generation_request_id: options.generationRequestId,
      }
    : baseWeekRow;
  const hasCalendarIdentity =
    Boolean(options.userId) &&
    Number.isInteger(baseWeekRow.iso_year) &&
    Number.isInteger(baseWeekRow.iso_week);

  if (hasCalendarIdentity) {
    const { data: existingWeek, error: existingWeekError } = await supabase
      .from("weeks")
      .select("id")
      .eq("user_id", options.userId)
      .eq("iso_year", baseWeekRow.iso_year)
      .eq("iso_week", baseWeekRow.iso_week)
      .maybeSingle<Pick<WeekRow, "id">>();

    if (existingWeekError) {
      throw new Error(
        `Could not check existing calendar week: ${existingWeekError.message}`,
      );
    }

    if (existingWeek?.id) {
      if (!options.replaceExisting) {
        throw new Error("A week already exists for this calendar week.");
      }

      const { error: updateWeekError } = await supabase
        .from("weeks")
        .update(weekRow)
        .eq("id", existingWeek.id);

      if (updateWeekError) {
        throw new Error(`Could not update week: ${updateWeekError.message}`);
      }

      await replaceWeekDays(existingWeek.id, week);

      return existingWeek.id;
    }
  }

  const weekId = await insertWeekRow(
    weekRow,
    baseWeekRow,
    options.generationRequestId,
  );
  await insertWeekDays(weekId, week);

  return weekId;
}

async function readWeekDays(weekId: string) {
  const { data: weekDays, error: daysError } = await supabase!
    .from("week_days")
    .select(
      "day_name,position,lunch_status,lunch_dish_name,dinner_status,dinner_dish_name",
    )
    .eq("week_id", weekId)
    .order("position", { ascending: true });

  if (daysError) {
    throw new Error(`Could not read week days: ${daysError.message}`);
  }

  return ((weekDays ?? []) as WeekDayRow[]).map((day) => ({
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
  }));
}

export async function getWeekFromSupabaseByIsoWeek({
  isoYear,
  isoWeek,
  userId,
}: {
  isoYear: number;
  isoWeek: number;
  userId?: string | null;
}): Promise<SupabaseWeek | null> {
  if (!supabase) {
    throw new Error(
      "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  let query = supabase
    .from("weeks")
    .select("id,title,iso_year,iso_week,updated_at")
    .eq("iso_year", isoYear)
    .eq("iso_week", isoWeek)
    .order("created_at", { ascending: false })
    .limit(1);

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data: week, error: weekError } = await query.maybeSingle<WeekRow>();

  if (weekError) {
    throw new Error(`Could not read calendar week: ${weekError.message}`);
  }

  if (!week) {
    return null;
  }

  return {
    id: week.id,
    title: week.title ?? "",
    isoYear: week.iso_year ?? null,
    isoWeek: week.iso_week ?? null,
    updatedAt: week.updated_at ?? null,
    days: await readWeekDays(week.id),
  };
}

export async function getWeeksPresenceForIsoWeeks({
  isoWeeks,
  userId,
}: {
  isoWeeks: { isoYear: number; isoWeek: number }[];
  userId?: string | null;
}) {
  if (!supabase || !userId || isoWeeks.length === 0) {
    return new Set<string>();
  }

  const isoYears = Array.from(new Set(isoWeeks.map((week) => week.isoYear)));
  const { data: weeks, error: weeksError } = await supabase
    .from("weeks")
    .select("iso_year,iso_week")
    .eq("user_id", userId)
    .in("iso_year", isoYears)
    .not("iso_week", "is", null);

  if (weeksError) {
    throw new Error(`Could not read weeks presence: ${weeksError.message}`);
  }

  const requestedKeys = new Set(
    isoWeeks.map((week) => `${week.isoYear}-${week.isoWeek}`),
  );
  const presentKeys = new Set<string>();

  for (const week of (weeks ?? []) as Pick<
    WeekRow,
    "iso_year" | "iso_week"
  >[]) {
    if (!week.iso_year || !week.iso_week) {
      continue;
    }

    const key = `${week.iso_year}-${week.iso_week}`;

    if (requestedKeys.has(key)) {
      presentKeys.add(key);
    }
  }

  return presentKeys;
}

export async function getRecentWeekDishNamesFromSupabase({
  userId,
  limit = 4,
  excludeIsoYear,
  excludeIsoWeek,
}: {
  userId?: string | null;
  limit?: number;
  excludeIsoYear?: number | null;
  excludeIsoWeek?: number | null;
} = {}) {
  if (!supabase || !userId) {
    return [];
  }

  const query = supabase
    .from("weeks")
    .select("id,iso_year,iso_week")
    .eq("user_id", userId)
    .not("iso_year", "is", null)
    .not("iso_week", "is", null)
    .order("iso_year", { ascending: false })
    .order("iso_week", { ascending: false })
    .limit(limit + 1);

  const { data: weeks, error: weeksError } = await query;

  if (weeksError) {
    throw new Error(`Could not read recent weeks: ${weeksError.message}`);
  }

  const weekIds = ((weeks ?? []) as WeekRow[])
    .filter(
      (week) =>
        week.iso_year !== excludeIsoYear || week.iso_week !== excludeIsoWeek,
    )
    .slice(0, limit)
    .map((week) => week.id);

  if (weekIds.length === 0) {
    return [];
  }

  const { data: days, error: daysError } = await supabase
    .from("week_days")
    .select("lunch_dish_name,dinner_dish_name")
    .in("week_id", weekIds);

  if (daysError) {
    throw new Error(`Could not read recent week dishes: ${daysError.message}`);
  }

  const dishNames = new Set<string>();

  for (const day of (days ?? []) as Pick<
    WeekDayRow,
    "lunch_dish_name" | "dinner_dish_name"
  >[]) {
    for (const dishName of [day.lunch_dish_name, day.dinner_dish_name]) {
      const normalizedDishName = dishName?.trim();

      if (normalizedDishName) {
        dishNames.add(normalizedDishName);
      }
    }
  }

  return Array.from(dishNames).slice(0, 40);
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

  return {
    id: latestWeek.id,
    title: latestWeek.title ?? "",
    days: await readWeekDays(latestWeek.id),
  };
}
