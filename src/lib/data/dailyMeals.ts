// The breakfasts, mid-mornings and snacks of a week (a nutritionist's plan, or the optional ones of
// Crear menú), day by day, so Semana shows today's with lunch and dinner. Saved when the menu is
// used: in the account (public.week_daily_meals) for a signed-in user, always on this device too.
// A menu without them saves an empty list, so an older week's breakfasts never stay.
import type { DataIdentity } from "@/lib/data/repositories";
import { getIsoWeekStorageId, type IsoWeek } from "@/lib/isoWeek";
import type { PlanDailyMealKey, PlanExtras } from "@/lib/nutritionPlan";
import { readScoped, writeScoped } from "@/lib/storage/scoped-storage";
import { supabase } from "@/lib/supabase/client";

export type DailyMealsDay = PlanExtras["days"][number];

const mealKeys: PlanDailyMealKey[] = ["breakfast", "midMorning", "snack", "bedtime"];

export function parseDailyMeals(value: unknown): DailyMealsDay[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((day): DailyMealsDay[] => {
    if (!day || typeof day !== "object") return [];
    const { dayName, meals } = day as Record<string, unknown>;
    if (typeof dayName !== "string" || !Array.isArray(meals)) return [];
    const valid = meals.filter(
      (meal): meal is DailyMealsDay["meals"][number] =>
        !!meal &&
        typeof meal === "object" &&
        mealKeys.includes((meal as { meal?: PlanDailyMealKey }).meal as PlanDailyMealKey) &&
        typeof (meal as { text?: unknown }).text === "string" &&
        Number.isInteger((meal as { option?: unknown }).option) &&
        Number.isInteger((meal as { options?: unknown }).options),
    );
    return [{ dayName, meals: valid } as DailyMealsDay];
  });
}

export async function saveWeekDailyMeals(identity: DataIdentity, isoWeek: IsoWeek, days: DailyMealsDay[] | null | undefined) {
  const list = days ?? [];
  writeScoped(identity.scope, "daily-meals", list, { week: getIsoWeekStorageId(isoWeek) });
  if (!identity.userId || !supabase) return;
  const { error } = await supabase
    .from("week_daily_meals")
    .upsert({ user_id: identity.userId, iso_year: isoWeek.isoYear, iso_week: isoWeek.isoWeek, days: list, updated_at: new Date().toISOString() });
  if (error) console.warn("daily_meals_save_failed");
}

// The account's copy when it answers, else this device's.
export async function loadWeekDailyMeals(identity: DataIdentity, isoWeek: IsoWeek): Promise<DailyMealsDay[]> {
  const local = parseDailyMeals(readScoped<unknown>(identity.scope, "daily-meals", getIsoWeekStorageId(isoWeek)));
  if (!identity.userId || !supabase) return local;
  const { data, error } = await supabase
    .from("week_daily_meals")
    .select("days")
    .eq("user_id", identity.userId)
    .eq("iso_year", isoWeek.isoYear)
    .eq("iso_week", isoWeek.isoWeek)
    .maybeSingle();
  if (error) return local;
  if (!data) return local;
  const remote = parseDailyMeals((data as { days: unknown }).days);
  writeScoped(identity.scope, "daily-meals", remote, { week: getIsoWeekStorageId(isoWeek) });
  return remote;
}
