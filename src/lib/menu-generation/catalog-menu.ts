import catalog from "@/data/nutritionist-recipes.json";
import type { ImportedMenuResponse } from "@/lib/importMenu";
import { dishProtein, seededRandom } from "@/lib/nutritionPlan";
import { checkDish, blocksAutomaticProposal, mentionsDislikedFood, type RestrictionProfile } from "@/lib/recipes/restriction-check";
import { culinaryIssue } from "./culinary-rules";
import { isGenericDish, normalizeFood, selectionToMenu, type MenuProfile } from "./validation";

// Weekly menu from the recipe catalogue (src/data/nutritionist-recipes.json), without the AI.
// Each recipe says its meal (lunch or dinner), the menu types it fits (Saludable, Mediterráneo…)
// and how elaborate it is (Sencillo, Equilibrado, Elaborado). The week takes the recipes that fit
// the chosen types and level, leaves out every recipe whose title conflicts with the profile
// (diets, allergies, «otras alergias» and foods the user does not like) and the dishes of recent
// weeks, and spreads the main proteins. Titles are not ingredient lists: passing the check never
// certifies the absence of allergens or traces (the same rule as the AI menus).

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

export function readCatalogMenuStyles(value: unknown): CatalogMenuStyle[] {
  const list = Array.isArray(value) ? value : [value];
  const styles = list.filter((style): style is CatalogMenuStyle => (catalogMenuStyles as unknown[]).includes(style));
  return styles.length ? [...new Set(styles)] : ["healthy_balanced"];
}

// What the profile allows: no diet or allergy conflict (certain, or possible for an allergy) and
// no food the user does not like.
export function catalogRecipeFits(name: string, profile: RestrictionProfile) {
  const check = checkDish({ title: name, card: null }, profile, { automatic: true });
  return !blocksAutomaticProposal(check) && !mentionsDislikedFood(check);
}

export type CatalogMenuRequest = {
  profile: MenuProfile;
  styles: CatalogMenuStyle[];
  elaboration: CatalogElaboration;
  recentDishes?: string[];
  seed: number;
};

type Candidate = CatalogRecipe & { key: string; kind: string; protein: string | null; score: number };

// Closer level first: the chosen one, then the neighbour (Equilibrado for both ends).
function elaborationDistance(a: CatalogElaboration, b: CatalogElaboration) {
  return Math.abs(elaborations.indexOf(a) - elaborations.indexOf(b));
}

function candidatesFor(meal: "lunch" | "dinner", request: CatalogMenuRequest, recent: Set<string>): Candidate[] {
  return catalogRecipes.flatMap((recipe) => {
    if (recipe.slot !== meal) return [];
    const key = normalizeFood(recipe.name);
    if (!key || recent.has(key) || isGenericDish(recipe.name) || culinaryIssue(recipe.name) !== null) return [];
    if (!catalogRecipeFits(recipe.name, request.profile)) return [];
    const styleMatches = request.styles.filter((style) => recipe.menuStyles.includes(style)).length;
    // Tiers: every chosen type and the chosen level first; a recipe of another type comes last.
    const score =
      (styleMatches ? 10 + styleMatches * 2 : 0) +
      (recipe.elaboration === request.elaboration ? 4 : elaborationDistance(recipe.elaboration, request.elaboration) === 1 ? 1 : 0);
    // «kind»: the first word of the title («ensalada», «tortilla», «lentejas»), so a week is not
    // seven salads.
    return [{ ...recipe, key, kind: key.split(" ")[0], protein: dishProtein(recipe.name), score }];
  });
}

const minimumScore = (candidates: Candidate[]) => {
  // The best tier that still leaves room to choose (at least 10 recipes), else everything.
  const scores = [...new Set(candidates.map((candidate) => candidate.score))].sort((a, b) => b - a);
  for (const score of scores) if (candidates.filter((candidate) => candidate.score >= score).length >= 10) return score;
  return 0;
};

// Seven lunches and seven dinners from the catalogue, or null when the catalogue has fewer than
// seven compatible recipes for a meal (then the AI decides).
export function catalogMenu(request: CatalogMenuRequest): ImportedMenuResponse | null {
  const random = seededRandom(request.seed);
  const recent = new Set((request.recentDishes ?? []).map(normalizeFood).filter(Boolean));
  const pools = {
    lunch: candidatesFor("lunch", request, recent),
    dinner: candidatesFor("dinner", request, recent),
  };
  if (pools.lunch.length < 7 || pools.dinner.length < 7) return null;

  const used = new Set<string>();
  const proteinCount = new Map<string, number>();
  const kindCount = new Map<string, number>();
  const chosen = { lunch: [] as string[], dinner: [] as string[] };

  for (let day = 0; day < 7; day++) {
    let lunchProtein: string | null = null;
    for (const meal of ["lunch", "dinner"] as const) {
      const pool = pools[meal];
      const floor = minimumScore(pool);
      const open = pool.filter((candidate) => !used.has(candidate.key));
      // Preferences, loosened from the last when nothing is left: the best tier, a protein other
      // than the lunch's, no kind of dish and no protein more than twice a week per meal.
      const filters: ((candidate: Candidate) => boolean)[] = [
        (candidate) => candidate.score >= floor,
        (candidate) => !(meal === "dinner" && candidate.protein && candidate.protein === lunchProtein),
        (candidate) => (kindCount.get(`${meal}:${candidate.kind}`) ?? 0) < 2,
        (candidate) => !candidate.protein || (proteinCount.get(`${meal}:${candidate.protein}`) ?? 0) < 2,
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
      chosen[meal].push(pick.name);
      kindCount.set(`${meal}:${pick.kind}`, (kindCount.get(`${meal}:${pick.kind}`) ?? 0) + 1);
      if (pick.protein) proteinCount.set(`${meal}:${pick.protein}`, (proteinCount.get(`${meal}:${pick.protein}`) ?? 0) + 1);
      if (meal === "lunch") lunchProtein = pick.protein;
    }
  }

  // The same checks as an AI menu: format, duplicates, restrictions, generic and vague titles.
  try {
    return selectionToMenu({ lunches: chosen.lunch, dinners: chosen.dinner }, request.profile);
  } catch {
    return null;
  }
}

// A short list of catalogue references for the AI prompt (when the user writes a weekly request):
// recipes of the chosen types, compatible with the profile, a few per meal.
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
    return best.slice(0, perMeal).map((candidate) => candidate.name);
  });
}
