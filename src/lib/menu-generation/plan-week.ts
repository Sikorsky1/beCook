import type { ImportedMenuDay } from "@/lib/importMenu";
import { generatePlanRulesWeek, planFreeDinners, type NutritionPlan } from "@/lib/nutritionPlan";
import type { RestrictionProfile } from "@/lib/recipes/restriction-check";
import { catalogMenu } from "./catalog-menu";
import type { MenuProfile } from "./validation";

// The lunches and dinners of a nutritionist's plan (Sergio's choice, 2026-10-22): the same week as
// Crear menú (catalog-menu.ts) from the recipes Sergio marked, with no preference of menu type.
// Every marked recipe has the same chance whether or not it keeps the plan's protein and
// carbohydrate rules (blue fish or a starch at dinner, legumes without meat, fried dishes…). What
// stays: lunch and dinner recipes in their meal, a starch on the training days and none on the
// others, no dish twice, the weekly food-group frequencies (AESAN), the profile's diets, allergies
// and disliked foods, the plan's free dinner and, when the plan says so, no red meat at dinner
// (Sergio, 2026-10-22; fried dishes stay). The plan gives breakfasts, mid-mornings, snacks,
// bedtime, pre- and post-workout and their shopping (nutritionPlan.ts).
// Only when the marked recipes cannot fill the week (a very restrictive profile), the plan's rules
// with its examples and ideas decide (generatePlanRulesWeek).
// Loaded on demand by Crear menú: it brings the catalogue tags with it.

function planMenuProfile(profile: RestrictionProfile | null, trainingDays: number[]): MenuProfile {
  return {
    goals: [],
    otherGoal: "",
    trainingTypes: [],
    ...(profile ?? { dietaryRestrictions: [], allergies: [], otherAllergies: "", dislikedFoods: [] }),
    weeklyTrainingDays: trainingDays.length,
    trainingWeekdays: trainingDays,
  };
}

// profile: the user's (readMenuProfile), or null without one. trainingDays: 1 = Monday … 7 = Sunday.
export function generatePlanWeek(plan: NutritionPlan, seed: number, profile: RestrictionProfile | null = null, trainingDays: number[] = []): ImportedMenuDay[] {
  const menu = catalogMenu({ profile: planMenuProfile(profile, trainingDays), styles: [], seed, noRedMeatAtDinner: plan.noRedMeatAtDinner });
  if (!menu) return generatePlanRulesWeek(plan, seed, profile, trainingDays);
  const free = new Set(planFreeDinners(plan));
  return menu.days.map((day, index) => (free.has(index) ? { ...day, dinner: { status: "free", dishName: "" } } : day));
}
