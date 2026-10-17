import catalog from "@/data/nutritionist-recipes.json";
import type { MealKey, WeekDay } from "@/data/mockWeek";
import { catalogCardForCheck } from "@/lib/recipes/catalogChecks";
import { checkDish, mentionsDislikedFood, blocksAutomaticProposal, type DishCardForCheck } from "@/lib/recipes/restriction-check";
import { culinaryIssue } from "./culinary-rules";
import { dishGroups, mainProtein, type DishGroup } from "./food-groups";
import { addGroups, countGroups, weekQuotas, withinMaximums } from "./quotas";
import { dayNames, isGenericDish, type MenuProfile, normalizeFood } from "./validation";

// Single-slot substitution (step 21): change one meal, keep the other thirteen.
// Shared by the week page (catalogue ideas, no cost) and /api/substitute-dish (one AI attempt).

export type SubstitutionSlot = { day: string; meal: MealKey };

export type SubstitutionRequest = SubstitutionSlot & {
  currentDish: string;
  // Every other planned dish of the week (up to 13).
  otherDishes: string[];
  // Ideas already shown and discarded for this slot.
  rejected: string[];
};

export type SubstituteDishResponse = { dish: string; source: "catalog" | "ai" };

export type ReplacementIssue =
  | "invalid_dish"
  | "same_dish"
  | "duplicate_dish"
  | "already_rejected"
  | "restriction_conflict"
  | "disliked_food"
  | "generic_dish"
  | "ambiguous_dish";

export const substitutionLimits = { maxDishLength: 110, maxOtherDishes: 13, maxRejected: 10 } as const;

const isPlanned = (dish: string) => dish.trim() !== "" && dish !== "LIBRE";

// A reviewed card of the dish, when the catalogue has one (C3): its ingredients are checked too.
// Without it, the catalogue recipe of the title (N01), which can only add conflicts. Cards
// estimated by the AI never decide an automatic idea; the title check still applies.
export type ReviewedCardLookup = (title: string) => DishCardForCheck | null;

export function checkReplacement(
  dish: unknown,
  request: SubstitutionRequest,
  profile: MenuProfile,
  card: DishCardForCheck | null = null,
): ReplacementIssue | null {
  if (typeof dish !== "string" || dish.trim().length < 3 || dish.length > substitutionLimits.maxDishLength) return "invalid_dish";
  const key = normalizeFood(dish);
  if (!key) return "invalid_dish";
  if (key === normalizeFood(request.currentDish)) return "same_dish";
  if (request.otherDishes.some((other) => normalizeFood(other) === key)) return "duplicate_dish";
  if (request.rejected.some((other) => normalizeFood(other) === key)) return "already_rejected";
  const recipe = card?.reviewStatus === "reviewed" ? card : catalogCardForCheck(dish);
  const check = checkDish({ title: dish, card: recipe }, profile, { automatic: true });
  if (blocksAutomaticProposal(check)) return "restriction_conflict";
  if (mentionsDislikedFood(check)) return "disliked_food";
  if (isGenericDish(dish)) return "generic_dish";
  if (culinaryIssue(dish) !== null) return "ambiguous_dish";
  return null;
}

// Stable per-slot order, so two slots of the same week do not propose the same first idea.
function slotRank(slot: SubstitutionSlot, recipeId: string) {
  let hash = 2166136261;
  for (const char of `${slot.day}|${slot.meal}|${recipeId}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

const groupsOf = (title: string): DishGroup[] => dishGroups(title, catalogCardForCheck(title)?.ingredients ?? null);

// Next catalogue recipe compatible with the profile and the rest of the week. Recipes for the same
// meal come first, then those of the same food group as the current dish (N05: a legume for a
// legume); none that takes the week past a maximum of meat, fish or eggs (quotas.ts). Null when the catalogue has nothing left.
export function catalogAlternative(
  request: SubstitutionRequest,
  profile: MenuProfile,
  reviewedCard: ReviewedCardLookup = () => null,
): { dish: string; recipeId: string } | null {
  // Titles of the week and the discarded ones first (cheap), then the full check of the rest.
  // Those already left out need no second comparison in checkReplacement.
  const taken = new Set([request.currentDish, ...request.otherDishes, ...request.rejected].map(normalizeFood));
  const rest = { ...request, otherDishes: [], rejected: [] };
  const quotas = weekQuotas(profile);
  const others = countGroups(request.otherDishes.map(groupsOf));
  const current = mainProtein(groupsOf(request.currentDish));
  // Never past a maximum the week keeps, never worse than the week already is (an imported menu).
  const now = addGroups(others, groupsOf(request.currentDish));
  const limits = {
    ...quotas,
    meatMax: Math.max(quotas.meatMax, now.meat),
    redMeatMax: Math.max(quotas.redMeatMax, now.redMeat),
    processedMeatMax: Math.max(quotas.processedMeatMax, now.processedMeat),
    fishMax: Math.max(quotas.fishMax, now.fish),
    eggMax: Math.max(quotas.eggMax, now.egg),
  };
  const fitsWeek = (title: string) => withinMaximums(addGroups(others, groupsOf(title)), limits);
  const sameGroup = (title: string) => Number(current !== null && mainProtein(groupsOf(title)) === current);
  const candidates = catalog.recipes
    .filter((recipe) => !taken.has(normalizeFood(recipe.name)))
    .filter((recipe) => checkReplacement(recipe.name, rest, profile, reviewedCard(recipe.name)) === null)
    .filter((recipe) => fitsWeek(recipe.name))
    .sort(
      (a, b) =>
        Number(b.slot === request.meal) - Number(a.slot === request.meal) ||
        sameGroup(b.name) - sameGroup(a.name) ||
        slotRank(request, a.id) - slotRank(request, b.id),
    );
  const recipe = candidates[0];
  return recipe ? { dish: recipe.name, recipeId: recipe.id } : null;
}

export function substitutionRequestFor(weekDays: WeekDay[], slot: SubstitutionSlot, rejected: string[]): SubstitutionRequest {
  const day = weekDays.find((weekDay) => weekDay.day === slot.day);
  const otherDishes = weekDays.flatMap((weekDay) =>
    (["lunch", "dinner"] as const)
      .filter((meal) => !(weekDay.day === slot.day && meal === slot.meal))
      .map((meal) => weekDay[meal])
      .filter(isPlanned),
  );
  const currentDish = day && isPlanned(day[slot.meal]) ? day[slot.meal] : "";
  return { ...slot, currentDish, otherDishes, rejected: [...new Set(rejected.filter(isPlanned))].slice(-substitutionLimits.maxRejected) };
}

// Replaces exactly one slot. The other thirteen keep their value and order.
export function replaceSlot(weekDays: WeekDay[], slot: SubstitutionSlot, dish: string): WeekDay[] {
  return weekDays.map((day) => (day.day === slot.day ? { ...day, [slot.meal]: dish } : day));
}

// Revalidates the whole menu after a substitution: only the slot changed, and the new dish
// is valid against the profile and the other dishes.
export function validateSubstitutedWeek(
  before: WeekDay[],
  after: WeekDay[],
  slot: SubstitutionSlot,
  profile: MenuProfile,
  rejected: string[] = [],
): ReplacementIssue | "other_slots_changed" | null {
  if (before.length !== after.length) return "other_slots_changed";
  for (const [index, day] of before.entries()) {
    const next = after[index];
    if (next.day !== day.day || next.date !== day.date) return "other_slots_changed";
    for (const meal of ["lunch", "dinner"] as const) {
      if (!(day.day === slot.day && meal === slot.meal) && next[meal] !== day[meal]) return "other_slots_changed";
    }
  }
  const newDay = after.find((day) => day.day === slot.day);
  if (!newDay) return "invalid_dish";
  return checkReplacement(newDay[slot.meal], substitutionRequestFor(before, slot, rejected), profile);
}

export function readSubstitutionRequest(body: Record<string, unknown>): SubstitutionRequest {
  const { day, meal, currentDish, otherDishes, rejected } = body;
  const dishList = (value: unknown, max: number) => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > max || value.some((dish) => typeof dish !== "string" || dish.length > substitutionLimits.maxDishLength)) {
      throw new Error("invalid_substitution");
    }
    return (value as string[]).map((dish) => dish.trim()).filter(isPlanned);
  };
  if (typeof day !== "string" || !(dayNames as readonly string[]).includes(day)) throw new Error("invalid_substitution");
  if (meal !== "lunch" && meal !== "dinner") throw new Error("invalid_substitution");
  if (currentDish !== undefined && (typeof currentDish !== "string" || currentDish.length > substitutionLimits.maxDishLength)) {
    throw new Error("invalid_substitution");
  }
  return {
    day,
    meal,
    currentDish: typeof currentDish === "string" && isPlanned(currentDish.trim()) ? currentDish.trim() : "",
    otherDishes: dishList(otherDishes, substitutionLimits.maxOtherDishes),
    rejected: dishList(rejected, substitutionLimits.maxRejected),
  };
}
