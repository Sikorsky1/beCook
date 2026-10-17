import { catalogCardForCheck } from "@/lib/recipes/catalogChecks";
import { dishGroups, isFish, isMeat, type DishGroup } from "./food-groups";

// Weekly frequencies of a 14-dish week (lunch and dinner), from AESAN 2022 (N05): legumes at least
// 4, fish 3–4 with at least one blue, meat at most 3 (at most 1 red, no processed by default) and
// eggs at most 4. The minimums give way only when the profile leaves too few recipes of a group
// (a vegetarian has no fish); the maximums of meat never do. The habit goals of the profile (N06)
// adjust them.

export type WeekQuotas = {
  legumeMin: number;
  fishMin: number;
  fishMax: number;
  blueFishMin: number;
  meatMax: number;
  redMeatMax: number;
  processedMeatMax: number;
  eggMax: number;
};

export type QuotaProfile = { dietaryRestrictions: string[]; goals: string[] };

export function weekQuotas(profile: QuotaProfile): WeekQuotas {
  const diets = new Set(profile.dietaryRestrictions);
  const goals = new Set(profile.goals);
  const quotas: WeekQuotas = { legumeMin: 4, fishMin: 3, fishMax: 4, blueFishMin: 1, meatMax: 3, redMeatMax: 1, processedMeatMax: 0, eggMax: 4 };
  if (diets.has("vegetarian") || diets.has("vegan")) Object.assign(quotas, { legumeMin: 5, fishMin: 0, blueFishMin: 0, fishMax: 0, meatMax: 0, redMeatMax: 0 });
  else if (diets.has("pescatarian")) Object.assign(quotas, { fishMax: 5, meatMax: 0, redMeatMax: 0 });
  // «Más verdura y legumbre»: one more legume and one less meat.
  if (goals.has("more_plants")) Object.assign(quotas, { legumeMin: Math.max(quotas.legumeMin, 5), meatMax: Math.min(quotas.meatMax, 2) });
  // «Gastar menos»: fish at its minimum (the most expensive group of the week).
  if (goals.has("save_money")) quotas.fishMax = Math.min(quotas.fishMax, Math.max(quotas.fishMin, 3));
  return quotas;
}

export type WeekCounts = { legume: number; fish: number; blueFish: number; meat: number; redMeat: number; processedMeat: number; egg: number };

export function countGroups(weekGroups: DishGroup[][]): WeekCounts {
  const counts: WeekCounts = { legume: 0, fish: 0, blueFish: 0, meat: 0, redMeat: 0, processedMeat: 0, egg: 0 };
  for (const groups of weekGroups) {
    if (groups.includes("legume")) counts.legume++;
    if (groups.some(isFish)) counts.fish++;
    if (groups.includes("blue_fish")) counts.blueFish++;
    if (groups.some(isMeat)) counts.meat++;
    if (groups.includes("red_meat")) counts.redMeat++;
    if (groups.includes("processed_meat")) counts.processedMeat++;
    if (groups.includes("egg")) counts.egg++;
  }
  return counts;
}

export function addGroups(counts: WeekCounts, groups: DishGroup[]): WeekCounts {
  const next = countGroups([groups]);
  return Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, value + next[key as keyof WeekCounts]])) as WeekCounts;
}

// The maximums: never exceeded by a proposal (meat, red, processed, fish, eggs).
export function withinMaximums(counts: WeekCounts, quotas: WeekQuotas) {
  return (
    counts.meat <= quotas.meatMax &&
    counts.redMeat <= quotas.redMeatMax &&
    counts.processedMeat <= quotas.processedMeatMax &&
    counts.fish <= quotas.fishMax &&
    counts.egg <= quotas.eggMax
  );
}

// How many dishes are still missing for the minimums (legume, fish, blue fish), limited to what the
// recipes left can give (available counts per group).
export function missingMinimums(counts: WeekCounts, quotas: WeekQuotas, available?: { legume: number; fish: number; blueFish: number }) {
  const cap = (min: number, key: "legume" | "fish" | "blueFish") => (available ? Math.min(min, available[key]) : min);
  return {
    legume: Math.max(0, cap(quotas.legumeMin, "legume") - counts.legume),
    fish: Math.max(0, cap(quotas.fishMin, "fish") - counts.fish),
    blueFish: Math.max(0, cap(quotas.blueFishMin, "blueFish") - counts.blueFish),
  };
}

// The four AESAN frequencies at once (the measure of success of N05).
export function meetsQuotas(counts: WeekCounts, quotas: WeekQuotas) {
  const missing = missingMinimums(counts, quotas);
  return withinMaximums(counts, quotas) && missing.legume === 0 && missing.fish === 0 && missing.blueFish === 0;
}

// The frequencies of a week of titles (catalogue or AI), for the server logs: counts only, no
// dishes or profile data (the measure of N05).
export function weekFrequencies(dishes: string[], profile: QuotaProfile) {
  const counts = countGroups(dishes.map((dish) => dishGroups(dish, catalogCardForCheck(dish)?.ingredients ?? null)));
  return { ...counts, meetsAesan: meetsQuotas(counts, weekQuotas(profile)) };
}
