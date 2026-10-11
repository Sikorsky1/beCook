import type { ImportedMenuResponse } from "@/lib/importMenu";
import { normalizeFood } from "@/lib/recipes/food-lexicon";
import { blocksAutomaticProposal, checkDish } from "@/lib/recipes/restriction-check";
import { culinaryIssue } from "./culinary-rules";

export const dayNames = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"] as const;

// One normaliser for titles and the food lexicon (C3). Re-exported for existing callers.
export { normalizeFood };

export type MenuProfile = {
  dietaryRestrictions: string[];
  allergies: string[];
  otherAllergies: string;
  dislikedFoods: string[];
  goals: string[];
  otherGoal: string;
  weeklyTrainingDays: number;
  trainingTypes: string[];
};

// Conflicts visible in a dish title (C3 lexicon: diets, allergies and «otras alergias»). Blocks automatic
// proposals: a certain conflict, or a possible one of an allergy. Titles are NOT ingredient lists:
// passing never certifies absence of allergens or cross-contamination.
export function visibleFoodConflict(name: string, profile: MenuProfile): boolean {
  return blocksAutomaticProposal(checkDish({ title: name, card: null }, profile));
}

export function isGenericDish(dish: string) {
  return /^(pescado con verduras|carne con guarnicion|pasta con salsa|ensalada completa|crema de verduras|verduras variadas|salteado saludable|bowl mediterraneo|power bowl|ensalada mixta)$/.test(normalizeFood(dish));
}

export const menuSelectionSchema = {
  type: "object", additionalProperties: false, required: ["lunches", "dinners"],
  properties: Object.fromEntries(["lunches", "dinners"].map(key => [key, {
    type: "array", minItems: 7, maxItems: 7,
    items: { type: "string", minLength: 8, maxLength: 110 },
  }])),
};

export function selectionToMenu(value: unknown, profile: MenuProfile): ImportedMenuResponse {
  if (!value || typeof value !== "object") throw new Error("invalid_structure");
  const selection = value as { lunches?: unknown; dinners?: unknown };
  if (!Array.isArray(selection.lunches) || !Array.isArray(selection.dinners) || selection.lunches.length !== 7 || selection.dinners.length !== 7) throw new Error("invalid_structure");
  const dishes = [...selection.lunches, ...selection.dinners];
  if (dishes.some(dish => typeof dish !== "string" || dish.trim().length < 8 || dish.length > 110)) throw new Error("invalid_dish");
  if (new Set(dishes.map(normalizeFood)).size !== 14) throw new Error("duplicate_dish");
  if (dishes.some(dish => visibleFoodConflict(dish, profile))) throw new Error("restriction_conflict");
  if (dishes.some(isGenericDish)) throw new Error("generic_dish");
  if (dishes.some(dish => culinaryIssue(dish) !== null)) throw new Error("ambiguous_dish");
  const lunches = selection.lunches as string[];
  const dinners = selection.dinners as string[];
  return {
    week: "Semana creada con beCook",
    days: dayNames.map((dayName, i) => ({dayName,
      lunch: {status: "planned", dishName: lunches[i].trim()},
      dinner: {status: "planned", dishName: dinners[i].trim()},
    })),
  };
}
