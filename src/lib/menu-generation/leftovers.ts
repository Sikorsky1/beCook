import { normalizeFood } from "@/lib/recipes/food-lexicon";
import { isFish, isMeat, type DishGroup } from "./food-groups";

// Cook once, eat twice (N17): a legume or vegetable stew at lunch is cooked for twice the servings
// and its second half is the next day's dinner, «Lentejas estofadas (sobras del lunes)». The
// shopping list counts the dish twice and the leftover not at all; the card says how to keep it.

const dayLower: Record<string, string> = {
  Lunes: "lunes",
  Martes: "martes",
  Miércoles: "miércoles",
  Jueves: "jueves",
  Viernes: "viernes",
  Sábado: "sábado",
  Domingo: "domingo",
};

export function leftoverTitle(base: string, dayName: string) {
  return `${base} (sobras del ${dayLower[dayName] ?? dayName.toLowerCase()})`;
}

const leftoverPattern = /^(.+?)\s+\(sobras del (lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\)$/i;

export function parseLeftover(title: string): { base: string; day: string } | null {
  const match = title.trim().match(leftoverPattern);
  return match ? { base: match[1].trim(), day: match[2].toLowerCase() } : null;
}

// Stews, creams and legumes keep well for a day; fish and meat are left out (reheating and the
// weekly maximums).
const stew = /\b(guiso|guisad[oa]s?|estofad[oa]s?|potaje|crema|curry|marmitako|cocido|chili|caldereta|sopa|pisto|fabada|lentejas|garbanzos|alubias|judias|dhal|dal)\b/;

export function batchFriendly(title: string, groups: DishGroup[]) {
  if (groups.some((group) => isMeat(group) || isFish(group))) return false;
  return title.length <= 85 && (groups.includes("legume") || stew.test(normalizeFood(title)));
}

// AESAN advice for leftovers (summer food safety campaign).
export const leftoverAdvice =
  "Guarda la mitad en la nevera antes de que pasen 2 horas y recaliéntala hasta que humee (unos 70 °C). Se conserva bien hasta el día siguiente.";
