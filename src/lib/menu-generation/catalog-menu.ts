import type { ImportedMenuResponse } from "@/lib/importMenu";
import { dishProtein, seededRandom } from "@/lib/nutritionPlan";
import { catalogCardForCheck } from "@/lib/recipes/catalogChecks";
import { catalogTags } from "@/lib/recipes/catalogTags";
import { selectedCatalogRecipes } from "@/lib/recipes/selectedCatalog";
import { checkDish, blocksAutomaticProposal, mentionsDislikedFood, type RestrictionProfile } from "@/lib/recipes/restriction-check";
import { culinaryIssue } from "./culinary-rules";
import { dishGroups, highMercury, isFish, mainProtein, type DishGroup } from "./food-groups";
import { addGroups, countGroups, missingMinimums, weekQuotas, withinMaximums, type WeekCounts, type WeekQuotas } from "./quotas";
import { batchFriendly, leftoverTitle } from "./leftovers";
import { isStarchyDish, prefersStarch } from "./carbs";
import { defaultMenuRules, minimumViolations, redMeatDays, ruleDish, ruleViolations, type MenuRules, type RuleDish } from "./menu-rules";
import { dayNames, isGenericDish, normalizeFood, selectionToMenu, type MenuProfile } from "./validation";

// Weekly menu from the recipe catalogue (src/data/nutritionist-recipes.json), without the AI, and
// only from the recipes Sergio marked (selectedCatalog.ts). Each recipe says its meal (lunch or
// dinner) and the menu types it fits (Saludable, Mediterráneo…); the level of elaboration of the
// catalogue is no longer used (2026-10-22). The week takes the recipes that fit the chosen types,
// leaves out every recipe whose title conflicts with the profile
// (diets, allergies, «otras alergias» and foods the user does not like) and the dishes of recent
// weeks, keeps the weekly rules of lunches and dinners with the carbohydrates on the training days
// of the profile (menu-rules.ts, 2026-10-24; the week that breaks the fewest when not all fit) and
// spreads the main proteins. Vegetarian and vegan profiles, which those rules do not fit, keep the
// weekly frequencies of AESAN 2022 (quotas.ts, N05) with the starchy dishes on the training days
// (carbs.ts). Each recipe is checked with its title and its recipe
// (catalog-checks.json); the recipes are unreviewed drafts, so passing the check never certifies
// the absence of allergens or traces (the same rule as the AI menus).

export type CatalogMenuStyle =
  | "healthy_balanced"
  | "high_protein"
  | "fat_loss"
  | "muscle_gain"
  | "mediterranean"
  | "quick_simple";

export type CatalogRecipe = {
  id: string;
  name: string;
  slot: "lunch" | "dinner";
  menuStyles: CatalogMenuStyle[];
};

export const catalogMenuStyles: CatalogMenuStyle[] = [
  "healthy_balanced",
  "high_protein",
  "fat_loss",
  "muscle_gain",
  "mediterranean",
  "quick_simple",
];

export const catalogRecipes: CatalogRecipe[] = selectedCatalogRecipes.map((recipe) => ({
  id: recipe.id,
  name: recipe.name,
  slot: recipe.slot === "dinner" ? "dinner" : "lunch",
  menuStyles: ((recipe as { menuStyles?: string[] }).menuStyles ?? []).filter((style): style is CatalogMenuStyle =>
    (catalogMenuStyles as string[]).includes(style),
  ),
}));

// Types Crear menú offers (N06): the catalogue keeps its body-composition tags, but a request with
// them reads as the default.
export const offeredMenuStyles: CatalogMenuStyle[] = ["healthy_balanced", "mediterranean", "quick_simple"];

export function readCatalogMenuStyles(value: unknown): CatalogMenuStyle[] {
  const list = Array.isArray(value) ? value : [value];
  const styles = list.filter((style): style is CatalogMenuStyle => (offeredMenuStyles as unknown[]).includes(style));
  return styles.length ? [...new Set(styles)] : ["healthy_balanced"];
}

// What the profile allows: no diet or allergy conflict (certain, or possible for an allergy) and
// no food the user does not like, in the title or in the recipe (ingredients and EU-14 allergens).
export function catalogRecipeFits(name: string, profile: RestrictionProfile) {
  const check = checkDish({ title: name, card: catalogCardForCheck(name) }, profile, { automatic: true });
  return !blocksAutomaticProposal(check) && !mentionsDislikedFood(check);
}

export type CatalogMenuRequest = {
  profile: MenuProfile;
  // No types (the plan's week): every recipe scores the same.
  styles: CatalogMenuStyle[];
  recentDishes?: string[];
  seed: number;
  // Month of the week (1–12, Spain), for recipes in season (N16). Without it, no preference.
  month?: number;
  // Products marked in Despensa: recipes that use them score a little more (N18, «usa lo que tienes»).
  pantry?: string[];
  // «Cocinar una vez para dos comidas» (N17): up to two lunches cooked double, eaten again the
  // next day at dinner.
  batch?: boolean;
  // A nutritionist's plan that says «En cenas: carne roja» under «Evitar» (plan-week.ts): no red
  // meat at dinner, as the plan counts it (lomo de cerdo and cordero are its «carne blanca»).
  noRedMeatAtDinner?: boolean;
  // The weekly rules (menu-rules.ts): a nutritionist's plan brings its own; default, Sergio's.
  rules?: MenuRules;
  // Dinners the plan leaves free (0 = Monday … 6 = Sunday): they count for no rule.
  freeDinners?: number[];
};

type Candidate = CatalogRecipe & {
  key: string;
  kind: string;
  groups: DishGroup[];
  protein: ReturnType<typeof mainProtein>;
  // Probably ultra-processed ingredients (N07 tags): at most one such dish a week (N14).
  upf: boolean;
  // From the tags (N07): minutes, months in season, cost 1–3 and main species.
  minutes: number | null;
  season: number[];
  cost: 1 | 2 | 3;
  species: string | null;
  // Pasta, rice, potato, bread… (carbs.ts), for the training days of the profile.
  starchy: boolean;
  // What the weekly rules read of it (menu-rules.ts).
  rule: RuleDish;
  score: number;
};

// Sandwiches, wraps and toasts: the ultra-processed bread of the catalogue («Cocinar más en casa»).
const breadDish = /^(sandwich|sandwiches|wrap|wraps|bocadillo|bocadillos|tosta|tostas|tostada|tostadas|burrito|burritos|quesadillas?|pizza|pizzas|hamburguesa de)\b/;

// A pantry product in an ingredient: whole words, ignoring basics everyone has.
const pantryBasics = /^(sal|aceite.*|agua|pimienta.*|vinagre.*|azucar|harina)$/;

function candidatesFor(meal: "lunch" | "dinner", request: CatalogMenuRequest, recent: Set<string>): Candidate[] {
  const goals = new Set(request.profile.goals);
  const pantry = (request.pantry ?? []).map(normalizeFood).filter((item) => item.length >= 3 && !pantryBasics.test(item));
  return catalogRecipes.flatMap((recipe) => {
    if (recipe.slot !== meal) return [];
    const key = normalizeFood(recipe.name);
    if (!key || recent.has(key) || isGenericDish(recipe.name) || culinaryIssue(recipe.name) !== null) return [];
    if (!catalogRecipeFits(recipe.name, request.profile)) return [];
    const card = catalogCardForCheck(recipe.name);
    // «Comer con niños»: no species AESAN advises against under 10 (mercury, N13).
    if (goals.has("with_kids") && [recipe.name, ...(card?.ingredients ?? []).map((item) => item.name)].some((text) => highMercury.test(normalizeFood(text)))) return [];
    const styleMatches = request.styles.filter((style) => recipe.menuStyles.includes(style)).length;
    // Tiers: every chosen type first; a recipe of another type comes last.
    // The goals add a little: quick recipes for «Ahorrar tiempo», less bread for «Cocinar más en casa».
    const score =
      (styleMatches ? 10 + styleMatches * 2 : 0) +
      (goals.has("save_time") && card?.totalMinutes != null && card.totalMinutes <= 30 ? 2 : 0) -
      (goals.has("cook_home") && breadDish.test(key) ? 3 : 0) +
      // «Más verdura y legumbre» within the weekly rules: legume dishes score a little more.
      (goals.has("more_plants") && dishGroups(recipe.name, card?.ingredients ?? null).includes("legume") ? 2 : 0) +
      (pantry.length && (card?.ingredients ?? []).some((ingredient) => !ingredient.optional && pantry.some((item) => ` ${normalizeFood(ingredient.name)} `.includes(` ${item} `))) ? 1 : 0);
    const groups = dishGroups(recipe.name, card?.ingredients ?? null);
    if (meal === "dinner" && request.noRedMeatAtDinner) {
      const planProtein = dishProtein(recipe.name);
      if (planProtein === "red_meat" || (groups.includes("red_meat") && planProtein !== "white_meat")) return [];
    }
    // «kind»: the first word of the title («ensalada», «tortilla», «lentejas»), so a week is not
    // seven salads.
    const tags = catalogTags(recipe.name);
    return [{
      ...recipe,
      key,
      kind: key.split(" ")[0],
      groups,
      protein: mainProtein(groups),
      upf: tags?.upf ?? false,
      minutes: tags?.minutes ?? card?.totalMinutes ?? null,
      season: tags?.season ?? [],
      cost: tags?.cost ?? 2,
      species: tags?.species ?? null,
      starchy: isStarchyDish(recipe.name, card?.ingredients ?? null),
      rule: ruleDish(recipe.name, card?.ingredients ?? null),
      score,
    }];
  });
}

const minimumScore = (candidates: Candidate[]) => {
  // The best tier that still leaves room to choose (at least 10 recipes), else everything.
  const scores = [...new Set(candidates.map((candidate) => candidate.score))].sort((a, b) => b - a);
  for (const score of scores) if (candidates.filter((candidate) => candidate.score >= score).length >= 10) return score;
  return 0;
};

type Pools = { lunch: Candidate[]; dinner: Candidate[] };
type Week = { lunch: Candidate[]; dinner: Candidate[]; counts: WeekCounts };

// The weekly rules of the request, or null for the profiles they do not fit (vegetarian, vegan).
function rulesOf(request: CatalogMenuRequest): MenuRules | null {
  const diets = new Set(request.profile.dietaryRestrictions);
  if (diets.has("vegetarian") || diets.has("vegan")) return null;
  return request.rules ?? defaultMenuRules;
}

// With the rules, the AESAN minimums and meat and fish maximums give way to them; processed meat,
// eggs and red meat (counted as the rules count it, ruleCaps) keep their maximums.
const ruleQuotas = (quotas: WeekQuotas): WeekQuotas => ({ ...quotas, legumeMin: 0, fishMin: 0, blueFishMin: 0, fishMax: 14, meatMax: 14, redMeatMax: 14 });

const ruleWeekOf = (week: { lunch: { rule: RuleDish }[]; dinner: { rule: RuleDish }[] }, freeDinners: number[]) => ({
  lunch: week.lunch.map((pick) => pick.rule),
  dinner: week.dinner.map((pick, day) => (freeDinners.includes(day) ? null : pick.rule)),
});

// One week: fourteen picks, lunch then dinner, day by day. The maximums of the quotas are hard
// (a recipe that would pass one is never picked). With the weekly rules, each pick is one of the
// recipes that keep the most rules still open (ruleGain); without them, the AESAN minimums push: a
// recipe of a missing group is preferred more as the week runs out, and required when the slots
// left are just enough.
function pickWeek(pools: Pools, request: CatalogMenuRequest, quotas: WeekQuotas, available: { legume: number; fish: number; blueFish: number }, random: () => number): Week | null {
  const rules = rulesOf(request);
  const trainingWeekdays = request.profile.trainingWeekdays ?? [];
  const freeDinners = request.freeDinners ?? [];
  const redMeatMax = rules ? Math.max(1, redMeatDays(rules)) : Infinity;
  const ruleCount = { lunch: new Map<string, number>(), dinner: new Map<string, number>() };
  let redMeat = 0;
  // What a pick adds to the rules: +1 for each protein or carbohydrate rule still missing days, -1
  // for a carbohydrate on a day without training or a lunch without vegetables. A carbohydrate on a
  // rest day counts only when the training days left cannot take the days it still needs.
  const ruleGain = (candidate: Candidate, meal: "lunch" | "dinner", day: number) => {
    if (!rules || (meal === "dinner" && freeDinners.includes(day))) return 0;
    const { protein, carb, meatOrFish, hydrate, vegetable } = candidate.rule;
    const mealRules = rules[meal];
    const counts = ruleCount[meal];
    const training = !trainingWeekdays.length || trainingWeekdays.includes(day + 1);
    let gain = 0;
    if (protein && (mealRules.proteins[protein] ?? 0) > (counts.get(protein) ?? 0)) gain++;
    if (carb && meatOrFish && (mealRules.carbs[carb] ?? 0) > (counts.get(carb) ?? 0)) {
      const carbsLeft = Object.entries(mealRules.carbs).reduce((total, [key, days]) => total + Math.max(0, (days ?? 0) - (counts.get(key) ?? 0)), 0);
      const trainingLeft = trainingWeekdays.filter((weekday) => weekday > day + 1).length;
      if (training || carbsLeft > trainingLeft) gain++;
    }
    if (!training && hydrate) gain--;
    if (meal === "lunch" && mealRules.vegetableSide && !vegetable) gain--;
    return gain;
  };
  const goals = new Set(request.profile.goals);
  const kindMax = goals.has("varied") ? 1 : 2;
  const speciesCount = new Map<string, number>();
  const speciesDay = new Map<string, number>();
  const used = new Set<string>();
  const proteinCount = new Map<string, number>();
  const kindCount = new Map<string, number>();
  const week: Week = { lunch: [], dinner: [], counts: countGroups([]) };
  let upfCount = 0;
  const floors = { lunch: minimumScore(pools.lunch), dinner: minimumScore(pools.dinner) };

  for (let day = 0; day < 7; day++) {
    let lunchProtein: string | null = null;
    // Training day: lunch and dinner with a starch; another day: without one (null: no preference).
    const starch = prefersStarch(request.profile.trainingWeekdays ?? [], day);
    for (const meal of ["lunch", "dinner"] as const) {
      const slotsLeft = 14 - (day * 2 + (meal === "dinner" ? 1 : 0));
      const withinMax = pools[meal].filter(
        (candidate) =>
          !used.has(candidate.key) &&
          withinMaximums(addGroups(week.counts, candidate.groups), quotas) &&
          (candidate.rule.protein !== "red_meat" || redMeat < redMeatMax),
      );
      if (!withinMax.length) return null;
      // N14: one dish with ultra-processed ingredients a week at most, unless nothing else is left.
      const lowUpf = withinMax.filter((candidate) => !candidate.upf || upfCount < 1);
      const lowUpfOrAll = lowUpf.length ? lowUpf : withinMax;
      // N19, «Ahorrar tiempo»: 30 minutes at most from Monday to Friday, unless nothing else is left.
      const quick = day < 5 && goals.has("save_time") ? lowUpfOrAll.filter((candidate) => candidate.minutes !== null && candidate.minutes <= 30) : lowUpfOrAll;
      const capped = quick.length ? quick : lowUpfOrAll;
      // The weekly rules first: only the recipes that keep the most.
      const bestGain = Math.max(...capped.map((candidate) => ruleGain(candidate, meal, day)));
      const keeping = rules ? capped.filter((candidate) => ruleGain(candidate, meal, day) === bestGain) : capped;
      const missing = missingMinimums(week.counts, quotas, available);
      const need = missing.legume + Math.max(missing.fish, missing.blueFish);
      const helps = (candidate: Candidate) =>
        (missing.legume > 0 && candidate.groups.includes("legume")) ||
        (missing.fish > 0 && candidate.groups.some(isFish)) ||
        (missing.blueFish > 0 && candidate.groups.includes("blue_fish"));
      const helping = rules ? [] : keeping.filter(helps);
      const open = helping.length && (need >= slotsLeft || random() < need / slotsLeft) ? helping : keeping;
      // Preferences, loosened from the last when nothing is left: the best tier, a protein other
      // than the lunch's (fish counts as one), the same species at most twice a week and never on
      // consecutive days (N20), in season (N16), no kind of dish and no protein more than twice a
      // week per meal, and cheap recipes for «Gastar menos» (N19).
      // The training days go first (the last preference to be dropped), then the rest.
      const filters: ((candidate: Candidate) => boolean)[] = [
        (candidate) => starch === null || (rules ? candidate.rule.hydrate : candidate.starchy) === starch,
        (candidate) => candidate.score >= floors[meal],
        (candidate) => !(meal === "dinner" && candidate.protein && candidate.protein === lunchProtein),
        (candidate) =>
          !candidate.species ||
          ((speciesCount.get(candidate.species) ?? 0) < 2 && Math.abs((speciesDay.get(candidate.species) ?? -9) - day) > 1),
        (candidate) => !request.month || !candidate.season.length || candidate.season.includes(request.month),
        (candidate) => (kindCount.get(`${meal}:${candidate.kind}`) ?? 0) < kindMax,
        (candidate) => !candidate.protein || (proteinCount.get(`${meal}:${candidate.protein}`) ?? 0) < 2,
        (candidate) => !goals.has("save_money") || candidate.cost < 3,
      ];
      let options = open;
      for (let keep = filters.length; keep >= 0; keep--) {
        const filtered = open.filter((candidate) => filters.slice(0, keep).every((filter) => filter(candidate)));
        if (filtered.length) {
          options = filtered;
          break;
        }
      }
      const pick = options[Math.floor(random() * options.length)];
      if (!pick) return null;
      used.add(pick.key);
      week[meal].push(pick);
      week.counts = addGroups(week.counts, pick.groups);
      if (pick.upf) upfCount++;
      if (pick.rule.protein === "red_meat") redMeat++;
      if (!(meal === "dinner" && freeDinners.includes(day))) {
        const counts = ruleCount[meal];
        if (pick.rule.protein) counts.set(pick.rule.protein, (counts.get(pick.rule.protein) ?? 0) + 1);
        if (pick.rule.carb && pick.rule.meatOrFish) counts.set(pick.rule.carb, (counts.get(pick.rule.carb) ?? 0) + 1);
      }
      if (pick.species) {
        speciesCount.set(pick.species, (speciesCount.get(pick.species) ?? 0) + 1);
        speciesDay.set(pick.species, day);
      }
      kindCount.set(`${meal}:${pick.kind}`, (kindCount.get(`${meal}:${pick.kind}`) ?? 0) + 1);
      if (pick.protein) proteinCount.set(`${meal}:${pick.protein}`, (proteinCount.get(`${meal}:${pick.protein}`) ?? 0) + 1);
      if (meal === "lunch") lunchProtein = pick.protein;
    }
  }
  return week;
}

// The preferences of variety a week of the rules may give up: a species more than twice or on
// consecutive days (N20) and the same main protein at lunch and dinner.
function weekRepeats(week: Week) {
  const days = new Map<string, number[]>();
  let repeats = 0;
  week.lunch.forEach((lunch, day) => {
    const dinner = week.dinner[day];
    if (lunch.protein && lunch.protein === dinner.protein) repeats++;
    for (const pick of [lunch, dinner]) if (pick.species) days.set(pick.species, [...(days.get(pick.species) ?? []), day]);
  });
  for (const list of days.values()) {
    repeats += Math.max(0, list.length - 2);
    repeats += list.filter((day, index) => index > 0 && day - list[index - 1] <= 1).length;
  }
  return repeats;
}

const weekAttempts = 15;
const ruleAttempts = 30;

// Seven lunches and seven dinners from the catalogue, or null when the catalogue has fewer than
// seven compatible recipes for a meal, or no week within the maximums (then the AI decides).
export function catalogMenu(request: CatalogMenuRequest): ImportedMenuResponse | null {
  const random = seededRandom(request.seed);
  const recent = new Set((request.recentDishes ?? []).map(normalizeFood).filter(Boolean));
  const pools: Pools = {
    lunch: candidatesFor("lunch", request, recent),
    dinner: candidatesFor("dinner", request, recent),
  };
  if (pools.lunch.length < 7 || pools.dinner.length < 7) return null;
  const rules = rulesOf(request);
  const trainingWeekdays = request.profile.trainingWeekdays ?? [];
  const freeDinners = request.freeDinners ?? [];
  const quotas = rules ? ruleQuotas(weekQuotas(request.profile)) : weekQuotas(request.profile);
  const all = [...pools.lunch, ...pools.dinner];
  const available = {
    legume: all.filter((candidate) => candidate.groups.includes("legume")).length,
    fish: all.filter((candidate) => candidate.groups.some(isFish)).length,
    blueFish: all.filter((candidate) => candidate.groups.includes("blue_fish")).length,
  };

  // A few tries with the same seed: the first week that keeps every rule (or frequency), else the
  // one that breaks the fewest rules (misses the fewest dishes).
  const floor = rules ? minimumViolations(rules, trainingWeekdays) : 0;
  let best: Week | null = null;
  let bestMissing = Infinity;
  let bestRepeats = Infinity;
  for (let attempt = 0; attempt < (rules ? ruleAttempts : weekAttempts) && (bestMissing > floor || (rules && bestRepeats > 0)); attempt++) {
    const week = pickWeek(pools, request, quotas, available, random);
    if (!week) continue;
    const missing = missingMinimums(week.counts, quotas, available);
    const total = rules ? ruleViolations(rules, ruleWeekOf(week, freeDinners), trainingWeekdays) : missing.legume + missing.fish + missing.blueFish;
    // With the rules, a tie goes to the week with fewer repeats (species, the lunch's protein at dinner).
    const repeats = rules ? weekRepeats(week) : 0;
    if (total < bestMissing || (total === bestMissing && repeats < bestRepeats)) {
      best = week;
      bestMissing = total;
      bestRepeats = repeats;
    }
  }
  if (!best) return null;

  const lunches = best.lunch.map((pick) => pick.name);
  const dinners = best.dinner.map((pick) => pick.name);
  if (request.batch) {
    // Monday to Friday, at most two, not on consecutive days. A dinner is replaced only when the
    // week keeps its frequencies without it and the next day's lunch has another main protein.
    const dinnerGroups = best.dinner.map((pick) => pick.groups);
    const lunchGroups = best.lunch.map((pick) => pick.groups);
    const fullBefore = missingMinimums(best.counts, quotas, available);
    const ruleWeek = ruleWeekOf(best, freeDinners);
    const brokenBefore = rules ? ruleViolations(rules, ruleWeek, trainingWeekdays) : 0;
    let batches = 0;
    for (let day = 0; day < 5 && batches < 2; day++) {
      if (!batchFriendly(lunches[day], lunchGroups[day])) continue;
      if (mainProtein(lunchGroups[day]) === mainProtein(lunchGroups[day + 1])) continue;
      // The leftovers keep the training-day rule of the day they are eaten.
      const starch = prefersStarch(request.profile.trainingWeekdays ?? [], day + 1);
      if (starch !== null && best.lunch[day].starchy !== starch) continue;
      const swapped = dinnerGroups.map((groups, index) => (index === day + 1 ? lunchGroups[day] : groups));
      const counts = countGroups([...lunchGroups, ...swapped]);
      const after = missingMinimums(counts, quotas, available);
      if (!withinMaximums(counts, quotas) || after.legume > fullBefore.legume || after.fish > fullBefore.fish || after.blueFish > fullBefore.blueFish) continue;
      // With the weekly rules, a leftover dinner never breaks one more.
      const ruleSwapped = { ...ruleWeek, dinner: ruleWeek.dinner.map((dish, index) => (index === day + 1 && dish ? best!.lunch[day].rule : dish)) };
      if (rules && ruleViolations(rules, ruleSwapped, trainingWeekdays) > brokenBefore) continue;
      ruleWeek.dinner = ruleSwapped.dinner;
      dinners[day + 1] = leftoverTitle(lunches[day], dayNames[day]);
      dinnerGroups[day + 1] = lunchGroups[day];
      batches++;
      day++;
    }
  }

  // The same checks as an AI menu: format, duplicates, restrictions, generic and vague titles.
  try {
    return selectionToMenu({ lunches, dinners }, request.profile);
  } catch {
    return null;
  }
}

// A short list of catalogue references for the AI prompt (when the user writes a weekly request):
// the nutritionist's own recipes compatible with the profile, then a few recipes of the chosen
// types per meal.
export function catalogExamples(request: CatalogMenuRequest, perMeal = 20): string[] {
  const random = seededRandom(request.seed);
  return (["lunch", "dinner"] as const).flatMap((meal) => {
    const pool = candidatesFor(meal, request, new Set());
    const floor = minimumScore(pool);
    const best = pool.filter((candidate) => candidate.score >= floor);
    for (let index = best.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [best[index], best[other]] = [best[other], best[index]];
    }
    const own = pool.filter((candidate) => candidate.id.startsWith("nutri-"));
    const others = best.filter((candidate) => !candidate.id.startsWith("nutri-")).slice(0, perMeal);
    return [...own, ...others].map((candidate) => candidate.name);
  });
}
