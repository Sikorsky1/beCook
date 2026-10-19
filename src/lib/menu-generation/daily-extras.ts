import { planExtras, type NutritionPlan, type PlanExtras, type PlanOption } from "@/lib/nutritionPlan";
import { blocksAutomaticProposal, checkDish, mentionsDislikedFood, type RestrictionProfile } from "@/lib/recipes/restriction-check";

// Breakfasts, fruit and snacks for a created menu (N09, optional in Crear menú), when the user has
// no nutritionist plan. AESAN 2022: fruit 2–3 times a day (here one, the rest with lunch and
// dinner), dairy up to 3, nuts at least 3 times a week, wholegrain cereals. Simple options
// that rotate day by day, the same way as a nutritionist's plan (planDailyMeals), and what they need
// for the week, for every person at home. Options that break the profile are left out.

const option = (text: string): PlanOption => ({ text, fillings: [] });

// Three options per meal, in the order of the weekly rotation (planDailyMeals: breakfast 1 2 3 1 2 3 2,
// mid-morning 2 1 1 3 1 1 1, snack 2 3 1 3 2 1 2), chosen so no day repeats fruit, bread, yogurt or
// nuts and every day has one piece of fruit. The last ones only come in when the profile leaves an
// option out (allergies).
const breakfasts = [
  "40g de copos de avena + 200ml de leche + pieza de fruta",
  "tostada de pan integral con tomate",
  "200g de yogur natural + 20g de nueces",
  "2 huevos (revueltos, con tomate) + pieza de fruta",
  "4 tortitas de arroz o maíz + pieza de fruta",
];
const midMornings = ["pieza de fruta", "tostada de pan integral con queso fresco", "20g de almendras"];
const snacks = ["tostada de pan integral con aguacate", "200g de yogur natural + 20g de nueces", "4 tortitas de arroz o maíz + queso fresco"];

function fits(text: string, profile: RestrictionProfile) {
  const check = checkDish({ title: text, card: null }, profile, { automatic: true });
  return !blocksAutomaticProposal(check) && !mentionsDislikedFood(check);
}

export function dailyExtras(profile: RestrictionProfile, people: number): PlanExtras | null {
  const pick = (texts: string[]) => texts.filter((text) => fits(text, profile)).map(option);
  const breakfast = pick(breakfasts);
  const midMorning = pick(midMornings);
  const snack = pick(snacks);
  // Fruit alone always fits; without a breakfast there is nothing worth planning.
  if (!breakfast.length) return null;
  const plan = { breakfast, midMorning, snack, bedtime: [] } as unknown as NutritionPlan;
  const extras = planExtras(plan);
  const servings = Math.max(1, Math.min(6, Math.round(people)));
  return { ...extras, fromPlan: false, items: extras.items.map((item) => ({ ...item, quantity: item.quantity * servings })) };
}
