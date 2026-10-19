import { normalizeFood } from "@/lib/recipes/food-lexicon";
import type { DishIngredients } from "./food-groups";

// Training days and starchy dishes (Perfil → Entrenamiento): on the days the user trains, lunch
// and dinner bring a starchy carbohydrate (pasta, rice, potato, bread, couscous…); on the other
// days, dishes without one. Legumes are not counted here: they keep their own weekly frequency
// (quotas.ts). A preference, never a hard rule: when the catalogue has nothing that fits, the
// other rules decide.

// Words of normalizeFood text (lower case, no accents).
const starchWords =
  /\b(pasta|espaguetis?|macarrones|tallarines|fideos?|fideua|lasana|canelones|raviolis?|tortellini|nocchis?|noquis|gnocchi|penne|fusilli|tagliatelle|arroz|paella|risotto|patatas?|papas|boniatos?|batatas?|cuscus|couscous|quinoa|bulgur|trigo|cebada|polenta|pan|bocadillos?|sandwich(es)?|tostas?|wraps?|burritos?|tortillas? de (trigo|maiz)|noodles|udon|pizza|empanadillas?|mijo)\b/;

// Bread crumbs and flour coat or thicken; they do not make a dish starchy.
const notStarch = /\b(pan rallado|harina( de \w+)?|maicena|almidon)\b/g;

const hasStarch = (text: string) => starchWords.test(normalizeFood(text).replace(notStarch, " "));

// A dish is starchy when its title names a starch, or (catalogue recipes) a main ingredient is one.
export function isStarchyDish(title: string, ingredients: DishIngredients | null = null): boolean {
  if (hasStarch(title)) return true;
  return (ingredients ?? []).some((ingredient) => !ingredient.optional && hasStarch(ingredient.name));
}

// 0 = Monday … 6 = Sunday. null: the profile has no training days, so no preference.
export function prefersStarch(trainingWeekdays: number[], dayIndex: number): boolean | null {
  if (!trainingWeekdays.length) return null;
  return trainingWeekdays.includes(dayIndex + 1);
}
