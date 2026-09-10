import type { ImportedMenuResponse } from "@/lib/importMenu";

export const dayNames = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"] as const;

export function normalizeFood(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Detection of visible conflicts only. Dish titles are NOT ingredient lists.
// Passing this check never certifies absence of allergens or cross-contamination.
const pork = /\b(cerdo|jamon|bacon|beicon|panceta|chorizo|lacon|sobrasada|salchichon|morcilla)\b/;
const meat = /\b(pollo|pavo|ternera|cordero|conejo|carne|vacuno|buey|cecina|solomillo|bolonesa|cocido|fabada)\b/;
const seafood = /\b(gambas?|langostinos?|langosta|cangrejo|marisco|mejillones?|almejas?|chirlas?|sepia|calamares?|pulpo|vieiras?|berberechos?)\b/;
const fish = /\b(pescado|salmon|merluza|bacalao|atun|bonito|sardinas?|anchoas?|boquerones?|lubina|dorada|caballa|ventresca|emperador|rape|trucha|gulas)\b/;
const egg = /\b(huevos?|tortilla|revuelto|mayonesa|mahonesa|carbonara)\b/;
const dairy = /\b(leche|queso|nata|mantequilla|yogur|feta|ricotta|mozzarella|parmesano|bechamel)\b/;
const nuts = /\b(frutos secos|almendras?|nueces|nuez|avellanas?|pistachos?|anacardos?|cacahuetes?|pinones?|pesto)\b/;
const gluten = /\b(trigo|cebada|centeno|pan|tostas?|tostadas?|pasta|espaguetis|macarrones|fideos|cuscus|bulgur|pizza|lasana|rebozado|empanado|seitan)\b/;

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

export function visibleFoodConflict(name: string, profile: MenuProfile): boolean {
  const text = normalizeFood(name);
  const restrictions = new Set(profile.dietaryRestrictions);
  const allergies = new Set(profile.allergies);
  if (restrictions.has("no_pork") && pork.test(text)) return true;
  if (["vegetarian", "vegan", "pescatarian"].some(r => restrictions.has(r)) && (meat.test(text) || pork.test(text))) return true;
  if (["vegetarian", "vegan"].some(r => restrictions.has(r)) && (fish.test(text) || seafood.test(text))) return true;
  if (restrictions.has("vegan") && (egg.test(text) || dairy.test(text) || /\bmiel\b/.test(text))) return true;
  if (restrictions.has("no_alcohol") && /\b(vino|cerveza|ron|brand[yie]|co[nñ]ac|licor)\b/.test(text)) return true;
  if (allergies.has("nuts") && nuts.test(text)) return true;
  if (allergies.has("shellfish") && seafood.test(text)) return true;
  if (allergies.has("egg") && egg.test(text)) return true;
  // Conservative: use naturally compatible recipes instead of uncertain substitutions.
  if (allergies.has("lactose") && dairy.test(text)) return true;
  if (allergies.has("gluten") && gluten.test(text)) return true;
  return false;
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
  if (dishes.some(dish => /^(pescado con verduras|carne con guarnicion|pasta con salsa|ensalada completa|crema de verduras|verduras variadas|salteado saludable|bowl mediterraneo|power bowl|ensalada mixta)$/.test(normalizeFood(dish)))) throw new Error("generic_dish");
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
