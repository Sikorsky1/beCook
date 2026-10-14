import { recipeTitleKey, validateRecipeCardContent, type RecipeCardContent } from "./card";

// Recipes of the catalogue (src/data/recipe-cards/catalog-recipes.json): ingredients for two people
// and steps for every recipe of src/data/nutritionist-recipes.json, written once and kept in the
// repository for review. Not stored in the database and not linked to the week: the dish card shows
// the recipe whose title is the dish's. The file is loaded only when a card opens.

export type CatalogRecipeFile = { recipes: { id: string; title: string; card: unknown }[] };

// base: the catalogue title when the dish only starts with it («Salmón a la plancha y ensalada
// mixta» → «Salmón a la plancha»); null when the titles are the same.
export type CatalogRecipeMatch = { recipe: RecipeCardContent; base: string | null };

type Entry = { title: string; recipe: RecipeCardContent };

let index: Promise<Map<string, Entry>> | null = null;

export function catalogRecipeIndex(file: CatalogRecipeFile) {
  const map = new Map<string, Entry>();
  for (const entry of file.recipes) {
    const checked = validateRecipeCardContent(entry.card);
    const key = recipeTitleKey(entry.title);
    // An invalid entry is left out (the dish then shows only its title), never repaired.
    if (checked.ok && !map.has(key)) map.set(key, { title: entry.title, recipe: checked.card });
  }
  return map;
}

// The exact title first; otherwise the longest catalogue title the dish starts with, followed by
// «y …», «con …» or «, …» (a side or an extra added to the recipe, as the nutritionist's plan does).
export function findCatalogRecipe(map: Map<string, Entry>, title: string): CatalogRecipeMatch | null {
  const key = recipeTitleKey(title);
  const exact = map.get(key);
  if (exact) return { recipe: exact.recipe, base: null };
  let best: Entry | null = null;
  let bestLength = 0;
  for (const [candidate, entry] of map) {
    if (candidate.length > bestLength && key.startsWith(candidate) && /^(,| y | con )/.test(key.slice(candidate.length))) {
      best = entry;
      bestLength = candidate.length;
    }
  }
  return best ? { recipe: best.recipe, base: best.title } : null;
}

export async function loadCatalogRecipe(title: string): Promise<CatalogRecipeMatch | null> {
  index ??= import("@/data/recipe-cards/catalog-recipes.json").then((module) =>
    catalogRecipeIndex((module.default ?? module) as CatalogRecipeFile),
  );
  try {
    return findCatalogRecipe(await index, title);
  } catch {
    index = null;
    return null;
  }
}
