// The user's nutritionist plan for the rest of the day: its breakfast, mid-morning, snack and bedtime
// options, saved when the PDF is imported (public.nutrition_plans for a signed-in user, always on
// this device too). Crear menú plans those meals from it instead of beCook's own options.
import type { DataIdentity } from "@/lib/data/repositories";
import type { NutritionPlan, PlanDailyMealKey, PlanOption } from "@/lib/nutritionPlan";
import { readScoped, removeScoped, writeScoped } from "@/lib/storage/scoped-storage";
import { supabase } from "@/lib/supabase/client";

export type DailyPlanOptions = Record<PlanDailyMealKey, PlanOption[]>;

const mealKeys: PlanDailyMealKey[] = ["breakfast", "midMorning", "snack", "bedtime"];

export function parseDailyPlanOptions(value: unknown): DailyPlanOptions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const options = Object.fromEntries(
    mealKeys.map((meal) => {
      const list = Array.isArray(record[meal]) ? (record[meal] as unknown[]) : [];
      return [
        meal,
        list.flatMap((entry): PlanOption[] => {
          const option = entry as { text?: unknown; fillings?: unknown } | null;
          if (!option || typeof option.text !== "string" || !option.text.trim()) return [];
          const fillings = Array.isArray(option.fillings) ? option.fillings.filter((filling): filling is string => typeof filling === "string") : [];
          return [{ text: option.text.slice(0, 300), fillings: fillings.slice(0, 12) }];
        }),
      ];
    }),
  ) as DailyPlanOptions;
  return options.breakfast.length + options.midMorning.length + options.snack.length ? options : null;
}

export function dailyPlanOptionsOf(plan: NutritionPlan): DailyPlanOptions {
  return { breakfast: plan.breakfast, midMorning: plan.midMorning, snack: plan.snack, bedtime: plan.bedtime };
}

// A plan with only these options (lunch and dinner are not planned from it here).
export function planFromDailyOptions(options: DailyPlanOptions): NutritionPlan {
  return {
    ...options,
    lunch: { rules: [], examples: [] },
    dinner: { rules: [], examples: [] },
    sides: [],
    noRedMeatAtDinner: false,
  };
}

// null: the user stops using the plan.
export async function saveDailyPlanOptions(identity: DataIdentity, options: DailyPlanOptions | null) {
  if (options) writeScoped(identity.scope, "nutrition-plan", options);
  else removeScoped(identity.scope, "nutrition-plan");
  if (!identity.userId || !supabase) return;
  const { error } = options
    ? await supabase.from("nutrition_plans").upsert({ user_id: identity.userId, options, updated_at: new Date().toISOString() })
    : await supabase.from("nutrition_plans").delete().eq("user_id", identity.userId);
  if (error) console.warn("nutrition_plan_save_failed");
}

// The account's copy when it answers, else this device's.
export async function loadDailyPlanOptions(identity: DataIdentity): Promise<DailyPlanOptions | null> {
  const local = parseDailyPlanOptions(readScoped<unknown>(identity.scope, "nutrition-plan"));
  if (!identity.userId || !supabase) return local;
  const { data, error } = await supabase.from("nutrition_plans").select("options").eq("user_id", identity.userId).maybeSingle();
  if (error) return local;
  const remote = data ? parseDailyPlanOptions((data as { options: unknown }).options) : null;
  if (remote) writeScoped(identity.scope, "nutrition-plan", remote);
  else removeScoped(identity.scope, "nutrition-plan");
  return remote;
}
