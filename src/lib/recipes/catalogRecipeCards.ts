import { recipeTitleKey, validateRecipeCardContent, type RecipeCardContent } from "./card";

// Recipes of the catalogue (src/data/recipe-cards/catalog-recipes.json): ingredients for two people
// and steps for every recipe of src/data/nutritionist-recipes.json, written once and kept in the
// repository for review. Not stored in the database and not linked to the week: the dish card shows
// the recipe whose title is exactly the dish's. The file is loaded only when a card opens.

export type CatalogRecipeFile = { recipes: { id: string; title: string; card: unknown }[] };

let index: Promise<Map<string, RecipeCardContent>> | null = null;

export function catalogRecipeIndex(file: CatalogRecipeFile) {
  const map = new Map<string, RecipeCardContent>();
  for (const recipe of file.recipes) {
    const checked = validateRecipeCardContent(recipe.card);
    const key = recipeTitleKey(recipe.title);
    // An invalid entry is left out (the dish then shows only its title), never repaired.
    if (checked.ok && !map.has(key)) map.set(key, checked.card);
  }
  return map;
}

export async function loadCatalogRecipe(title: string): Promise<RecipeCardContent | null> {
  index ??= import("@/data/recipe-cards/catalog-recipes.json").then((module) =>
    catalogRecipeIndex((module.default ?? module) as CatalogRecipeFile),
  );
  try {
    return (await index).get(recipeTitleKey(title)) ?? null;
  } catch {
    index = null;
    return null;
  }
}
