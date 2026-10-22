import catalog from "@/data/nutritionist-recipes.json";
import selection from "@/data/recipe-selection.json";

// The recipes beCook proposes: the ones Sergio marked on the page «Recetas prioritarias»
// (recipe-selection.json, by id) out of the full catalogue (nutritionist-recipes.json, kept whole).
// Everything that chooses or proposes a catalogue recipe (Crear menú, the plan's week, «Otra
// idea») reads this list; the recipe cards keep reading the full catalogue, so the dishes of older
// weeks still show their recipe.

export type CatalogEntry = (typeof catalog.recipes)[number];

export const selectedRecipeIds: ReadonlySet<string> = new Set(selection.recipes.map((recipe) => recipe.id));

export const selectedCatalogRecipes: CatalogEntry[] = catalog.recipes.filter((recipe) => selectedRecipeIds.has(recipe.id));

export function isSelectedRecipe(id: string) {
  return selectedRecipeIds.has(id);
}
