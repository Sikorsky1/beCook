import catalog from "@/data/nutritionist-recipes.json";
import type { ImportedMenuResponse } from "@/lib/importMenu";
import { seededRandom } from "@/lib/nutritionPlan";
import { catalogCardForCheck } from "@/lib/recipes/catalogChecks";
import { catalogTags } from "@/lib/recipes/catalogTags";
import { checkDish, blocksAutomaticProposal, mentionsDislikedFood, type RestrictionProfile } from "@/lib/recipes/restriction-check";
import { culinaryIssue } from "./culinary-rules";
import { dishGroups, highMercury, isFish, mainProtein, type DishGroup } from "./food-groups";
import { addGroups, countGroups, missingMinimums, weekQuotas, withinMaximums, type WeekCounts, type WeekQuotas } from "./quotas";
import { isGenericDish, normalizeFood, selectionToMenu, type MenuProfile } from "./validation";

// Weekly menu from the recipe catalogue (src/data/nutritionist-recipes.json), without the AI.
// Each recipe says its meal (lunch or dinner), the menu types it fits (Saludable, Mediterráneo…)
// and how elaborate it is (Sencillo, Equilibrado, Elaborado). The week takes the recipes that fit
// the chosen types and level, leaves out every recipe whose title conflicts with the profile
// (diets, allergies, «otras alergias» and foods the user does not like) and the dishes of recent
// weeks, keeps the weekly frequencies of AESAN 2022 (quotas.ts, N05) and spreads the main proteins. Each recipe is checked with its title and its recipe
// (catalog-checks.json); the recipes are unreviewed drafts, so passing the check never certifies
// the absence of allergens or traces (the same rule as the AI menus).

export type CatalogMenuStyle =
  | "healthy_balanced"
  | "high_protein"
  | "fat_loss"
  | "muscle_gain"
  | "mediterranean"
  | "quick_simple";

export type CatalogElaboration = "simple" | "balanced" | "elaborate";

export type CatalogRecipe = {
  id: string;
  name: string;
  slot: "lunch" | "dinner";
  menuStyles: CatalogMenuStyle[];
  elaboration: CatalogElaboration;
};

export const catalogMenuStyles: CatalogMenuStyle[] = [
  "healthy_balanced",
  "high_protein",
  "fat_loss",
  "muscle_gain",
  "mediterranean",
  "quick_simple",
];

const elaborations: CatalogElaboration[] = ["simple", "balanced", "elaborate"];

export const catalogRecipes: CatalogRecipe[] = catalog.recipes.map((recipe) => ({
  id: recipe.id,
  name: recipe.name,
  slot: recipe.slot === "dinner" ? "dinner" : "lunch",
  menuStyles: ((recipe as { menuStyles?: string[] }).menuStyles ?? []).filter((style): style is CatalogMenuStyle =>
    (catalogMenuStyles as string[]).includes(style),
  ),
  elaboration: elaborations.find((level) => level === (recipe as { elaboration?: string }).elaboration) ?? "balanced",
}));

// The page sends 2 (Sencillo), 4 (Equilibrado) or 6 (Elaborado); the old 1–7 scale still works.
export function elaborationForLevel(level: unknown): CatalogElaboration {
  const value = Number(level);
  if (!Number.isFinite(value)) return "balanced";
  return value <= 2 ? "simple" : value <= 5 ? "balanced" : "elaborate";
}

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
  styles: CatalogMenuStyle[];
  elaboration: CatalogElaboration;
  recentDishes?: string[];
  seed: number;
  // Month of the week (1–12, Spain), for recipes in season (N16). Without it, no preference.
  month?: number;
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
  score: number;
};

// Closer level first: the chosen one, then the neighbour (Equilibrado for both ends).
function elaborationDistance(a: CatalogElaboration, b: CatalogElaboration) {
  return Math.abs(elaborations.indexOf(a) - elaborations.indexOf(b));
}

// Sandwiches, wraps and toasts: the ultra-processed bread of the catalogue («Cocinar más en casa»).
const breadDish = /^(sandwich|sandwiches|wrap|wraps|bocadillo|bocadillos|tosta|tostas|tostada|tostadas|burrito|burritos|quesadillas?|pizza|pizzas|hamburguesa de)\b/;

function candidatesFor(meal: "lunch" | "dinner", request: CatalogMenuRequest, recent: Set<string>): Candidate[] {
  const goals = new Set(request.profile.goals);
  return catalogRecipes.flatMap((recipe) => {
    if (recipe.slot !== meal) return [];
    const key = normalizeFood(recipe.name);
    if (!key || recent.has(key) || isGenericDish(recipe.name) || culinaryIssue(recipe.name) !== null) return [];
    if (!catalogRecipeFits(recipe.name, request.profile)) return [];
    const card = catalogCardForCheck(recipe.name);
    // «Comer con niños»: no species AESAN advises against under 10 (mercury, N13).
    if (goals.has("with_kids") && [recipe.name, ...(card?.ingredients ?? []).map((item) => item.name)].some((text) => highMercury.test(normalizeFood(text)))) return [];
    const styleMatches = request.styles.filter((style) => recipe.menuStyles.includes(style)).length;
    // Tiers: every chosen type and the chosen level first; a recipe of another type comes last.
    // The goals add a little: quick recipes for «Ahorrar tiempo», less bread for «Cocinar más en casa».
    const score =
      (styleMatches ? 10 + styleMatches * 2 : 0) +
      (recipe.elaboration === request.elaboration ? 4 : elaborationDistance(recipe.elaboration, request.elaboration) === 1 ? 1 : 0) +
      (goals.has("save_time") && card?.totalMinutes != null && card.totalMinutes <= 30 ? 2 : 0) -
      (goals.has("cook_home") && breadDish.test(key) ? 3 : 0);
    const groups = dishGroups(recipe.name, card?.ingredients ?? null);
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

// One week: fourteen picks, lunch then dinner, day by day. The maximums of the quotas are hard
// (a recipe that would pass one is never picked); the minimums push: a recipe of a missing group is
// preferred more as the week runs out, and required when the slots left are just enough.
function pickWeek(pools: Pools, request: CatalogMenuRequest, quotas: WeekQuotas, available: { legume: number; fish: number; blueFish: number }, random: () => number): Week | null {
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
    for (const meal of ["lunch", "dinner"] as const) {
      const slotsLeft = 14 - (day * 2 + (meal === "dinner" ? 1 : 0));
      const withinMax = pools[meal].filter((candidate) => !used.has(candidate.key) && withinMaximums(addGroups(week.counts, candidate.groups), quotas));
      if (!withinMax.length) return null;
      // N14: one dish with ultra-processed ingredients a week at most, unless nothing else is left.
      const lowUpf = withinMax.filter((candidate) => !candidate.upf || upfCount < 1);
      const lowUpfOrAll = lowUpf.length ? lowUpf : withinMax;
      // N19, «Ahorrar tiempo»: 30 minutes at most from Monday to Friday, unless nothing else is left.
      const quick = day < 5 && goals.has("save_time") ? lowUpfOrAll.filter((candidate) => candidate.minutes !== null && candidate.minutes <= 30) : lowUpfOrAll;
      const capped = quick.length ? quick : lowUpfOrAll;
      const missing = missingMinimums(week.counts, quotas, available);
      const need = missing.legume + Math.max(missing.fish, missing.blueFish);
      const helps = (candidate: Candidate) =>
        (missing.legume > 0 && candidate.groups.includes("legume")) ||
        (missing.fish > 0 && candidate.groups.some(isFish)) ||
        (missing.blueFish > 0 && candidate.groups.includes("blue_fish"));
      const helping = capped.filter(helps);
      const open = helping.length && (need >= slotsLeft || random() < need / slotsLeft) ? helping : capped;
      // Preferences, loosened from the last when nothing is left: the best tier, a protein other
      // than the lunch's (fish counts as one), the same species at most twice a week and never on
      // consecutive days (N20), in season (N16), no kind of dish and no protein more than twice a
      // week per meal, and cheap recipes for «Gastar menos» (N19).
      const filters: ((candidate: Candidate) => boolean)[] = [
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

const weekAttempts = 15;

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
  const quotas = weekQuotas(request.profile);
  const all = [...pools.lunch, ...pools.dinner];
  const available = {
    legume: all.filter((candidate) => candidate.groups.includes("legume")).length,
    fish: all.filter((candidate) => candidate.groups.some(isFish)).length,
    blueFish: all.filter((candidate) => candidate.groups.includes("blue_fish")).length,
  };

  // A few tries with the same seed: the first week that keeps every frequency, else the one that
  // misses the fewest dishes.
  let best: Week | null = null;
  let bestMissing = Infinity;
  for (let attempt = 0; attempt < weekAttempts && bestMissing > 0; attempt++) {
    const week = pickWeek(pools, request, quotas, available, random);
    if (!week) continue;
    const missing = missingMinimums(week.counts, quotas, available);
    const total = missing.legume + missing.fish + missing.blueFish;
    if (total < bestMissing) {
      best = week;
      bestMissing = total;
    }
  }
  if (!best) return null;

  // The same checks as an AI menu: format, duplicates, restrictions, generic and vague titles.
  try {
    return selectionToMenu({ lunches: best.lunch.map((pick) => pick.name), dinners: best.dinner.map((pick) => pick.name) }, request.profile);
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
