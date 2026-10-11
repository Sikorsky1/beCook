// Frozen copy of src/lib/supabase/weeks.ts as in audit-opt 02aa5b8 (before C2): apply_week without
// recipe links and update_week_slot. Used only by scripts/recipe-cards-db-tests.cjs to prove the C2
// migration keeps the deployed client working during the rollout. Do not edit except for the import path.
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
  // Remote weeks.version: the version for cache revalidation and conflict checks (B4).
  version?: number | null;
  // Remote updated_at: when the week last changed (shopping-list freshness).
  updatedAt?: string | null;
  days: SupabaseWeekDay[];
};

type WeekRow = {
  id: string;
  title: string | null;
  iso_year?: number | null;
  iso_week?: number | null;
  version?: number | null;
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

const orderedDayNames = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
];

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

export type MealKind = "lunch" | "dinner";

// Result of apply_week / update_week_slot. Versions are weeks.version (integer, bumped by every
// write of the week, whatever the write path); the database compares them atomically.
//   applied: written · duplicate: this request key was already applied, nothing changed ·
//   conflict: the week was not at the expected version (or the day/week is gone), nothing changed.
export type WeekWriteResult = {
  status: "applied" | "duplicate" | "conflict";
  weekId: string | null;
  version: number | null;
  updatedAt: string | null;
};

export function parseWeekWriteResult(value: unknown): WeekWriteResult {
  const row = value as Record<string, unknown> | null;
  const status = row?.status;

  if (status !== "applied" && status !== "duplicate" && status !== "conflict") {
    throw new Error(`Unexpected week write result: ${JSON.stringify(status ?? null)}.`);
  }

  const version = row?.version;
  if (version !== null && version !== undefined && !Number.isSafeInteger(version)) {
    throw new Error("Unexpected week write result: invalid version.");
  }
  if (status !== "conflict" && (typeof row?.week_id !== "string" || typeof version !== "number")) {
    throw new Error("Unexpected week write result: missing week or version.");
  }

  return {
    status,
    weekId: typeof row?.week_id === "string" ? row.week_id : null,
    version: typeof version === "number" ? version : null,
    updatedAt: typeof row?.updated_at === "string" ? row.updated_at : null,
  };
}

// Days for apply_week: position comes from the day name (never the index), Monday→Sunday.
export function weekToApplyWeekDays(week: SupabaseWeek) {
  return week.days
    .map((day) => {
      const position = orderedDayNames.indexOf(day.dayName);

      if (position === -1) {
        throw new Error(`Cannot save an unknown day: ${day.dayName}.`);
      }

      return {
        position,
        day_name: day.dayName,
        lunch_status: day.lunch.status,
        lunch_dish_name: getDishNameForStorage(day.lunch),
        dinner_status: day.dinner.status,
        dinner_dish_name: getDishNameForStorage(day.dinner),
      };
    })
    .sort((a, b) => a.position - b.position);
}

function requireSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  return supabase;
}

// Applies or replaces the caller's whole calendar week in one transaction (apply_week).
// Without `overwrite`, it only writes if the week is still at `expectedVersion` (null = no week).
export async function applyWeekInSupabase({
  isoYear,
  isoWeek,
  week,
  requestKey,
  expectedVersion,
  overwrite = false,
  generationRequestId,
}: {
  isoYear: number;
  isoWeek: number;
  week: SupabaseWeek;
  requestKey: string;
  expectedVersion: number | null;
  overwrite?: boolean;
  generationRequestId?: string | null;
}) {
  if (!Array.isArray(week.days) || week.days.length === 0) {
    throw new Error("Cannot save a week without days.");
  }

  const { data, error } = await requireSupabase().rpc("apply_week", {
    p_iso_year: isoYear,
    p_iso_week: isoWeek,
    p_days: weekToApplyWeekDays(week),
    p_request_key: requestKey,
    p_expected_version: expectedVersion,
    p_overwrite: overwrite,
    p_generation_request_id: generationRequestId ?? null,
  });

  if (error) {
    throw new Error(`Could not save week: ${error.message}`);
  }

  return parseWeekWriteResult(data);
}

// Updates one meal of one existing day (update_week_slot), only at `expectedVersion`.
export async function updateWeekSlotInSupabase({
  isoYear,
  isoWeek,
  dayName,
  meal,
  slot,
  expectedVersion,
  requestKey,
}: {
  isoYear: number;
  isoWeek: number;
  dayName: string;
  meal: MealKind;
  slot: SupabaseMealSlot;
  expectedVersion: number;
  requestKey: string;
}) {
  const position = orderedDayNames.indexOf(dayName);

  if (position === -1) {
    throw new Error(`Cannot save an unknown day: ${dayName}.`);
  }

  const { data, error } = await requireSupabase().rpc("update_week_slot", {
    p_iso_year: isoYear,
    p_iso_week: isoWeek,
    p_position: position,
    p_meal: meal,
    p_status: slot.status,
    p_dish_name: getDishNameForStorage(slot),
    p_expected_version: expectedVersion,
    p_request_key: requestKey,
  });

  if (error) {
    throw new Error(`Could not save meal: ${error.message}`);
  }

  return parseWeekWriteResult(data);
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
    .select("id,title,iso_year,iso_week,version,updated_at")
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
    version: week.version ?? null,
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

// --- Food context of a week (C1, roadmap step 16) -----------------------------------------------

// Freezes the caller's saved profile (restrictions, household) and the servings of the applied
// generation request as this week's food context. Called right after apply_week with the same
// request key; repeating it is a no-op. Never changes weeks.version.
export async function freezeWeekFoodContextInSupabase({
  isoYear,
  isoWeek,
  requestKey,
  generationRequestId,
}: {
  isoYear: number;
  isoWeek: number;
  requestKey: string;
  generationRequestId?: string | null;
}) {
  const { data, error } = await requireSupabase().rpc("freeze_week_food_context", {
    p_iso_year: isoYear,
    p_iso_week: isoWeek,
    p_request_key: requestKey,
    p_generation_request_id: generationRequestId ?? null,
  });

  if (error) {
    throw new Error(`Could not freeze the week food context: ${error.message}`);
  }

  const status = (data as { status?: unknown } | null)?.status;
  if (status !== "frozen" && status !== "duplicate" && status !== "superseded" && status !== "not_applied") {
    throw new Error("Unexpected food context result.");
  }
  return status;
}

// The week's frozen context next to the current profile, compared in the database.
export async function getWeekFoodContextStatusFromSupabase({ isoYear, isoWeek }: { isoYear: number; isoWeek: number }) {
  const { parseWeekFoodContextStatus } = await import("@/lib/menu-generation/food-context");
  const { data, error } = await requireSupabase().rpc("week_food_context_status", {
    p_iso_year: isoYear,
    p_iso_week: isoWeek,
  });

  if (error) {
    throw new Error(`Could not read the week food context: ${error.message}`);
  }

  return parseWeekFoodContextStatus(data);
}

// Servings and restrictions version a week's shopping list depends on (null: none frozen).
export async function getWeekFoodContextFromSupabase(weekId: string) {
  const { data, error } = await requireSupabase()
    .from("week_food_contexts")
    .select("servings,context_version")
    .eq("week_id", weekId)
    .maybeSingle<{ servings: number; context_version: string }>();

  if (error) {
    throw new Error(`Could not read the week food context: ${error.message}`);
  }

  return data ? { servings: data.servings, version: data.context_version } : null;
}
