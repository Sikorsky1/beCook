import type { ImportedMenuDay } from "@/lib/importMenu";
import { generatePlanRulesWeek, planFreeDinners, type NutritionPlan } from "@/lib/nutritionPlan";
import type { RestrictionProfile } from "@/lib/recipes/restriction-check";
import { catalogMenu } from "./catalog-menu";
import { rulesFromPlan } from "./menu-rules";
import type { MenuProfile } from "./validation";

// The lunches and dinners of a nutritionist's plan: the same week as Crear menú (catalog-menu.ts)
// from the recipes Sergio marked, with no preference of menu type and the plan's own weekly rules
// («Un día a la semana: arroz + carne o pescado», «Dos días a la semana: pescado azul»…) in place
// of the default ones (menu-rules.ts, Sergio, 2026-10-24): the week that breaks the fewest, with
// the carbohydrates on the training days. Also: lunch and dinner recipes in their meal, no dish
// twice, the profile's diets, allergies and disliked foods, the plan's free dinner and, when the
// plan says so, no red meat at dinner (Sergio, 2026-10-22; fried dishes stay). The plan gives
// breakfasts, mid-mornings, snacks, bedtime, pre- and post-workout and their shopping
// (nutritionPlan.ts).
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
  const freeDinners = planFreeDinners(plan);
  const menu = catalogMenu({ profile: planMenuProfile(profile, trainingDays), styles: [], seed, noRedMeatAtDinner: plan.noRedMeatAtDinner, rules: rulesFromPlan(plan), freeDinners });
  if (!menu) return generatePlanRulesWeek(plan, seed, profile, trainingDays);
  const free = new Set(freeDinners);
  return menu.days.map((day, index) => (free.has(index) ? { ...day, dinner: { status: "free", dishName: "" } } : day));
}
