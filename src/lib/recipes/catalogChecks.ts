import checks from "@/data/recipe-cards/catalog-checks.json";
import type { RecipeAllergen } from "./card";
import { recipeTitleKey } from "./card";
import { findCatalogRecipe } from "./catalogRecipeCards";
import type { DishCardForCheck } from "./restriction-check";

// The catalogue recipe of a dish as the restriction check reads it (N01): ingredient names and the
// EU-14 allergens of src/data/recipe-cards/catalog-recipes.json, from the compact copy
// catalog-checks.json (scripts/build-catalog-checks.cjs). Crear menú, «Otra idea» and the
// nutritionist's plan check it as well as the title, so they never propose a dish whose own recipe
// lists an allergen of the profile. The recipes are drafts (inferred): they add conflicts, never
// certify that a dish is free of an allergen.

type CompactRecipe = { i: (string | [string, number])[]; a: string[]; t: number | null };

let index: Map<string, { title: string; recipe: DishCardForCheck & { totalMinutes: number | null } }> | null = null;

function catalogCheckIndex() {
  if (index) return index;
  index = new Map();
  for (const [title, recipe] of Object.entries((checks as { recipes: Record<string, CompactRecipe> }).recipes)) {
    const key = recipeTitleKey(title);
    if (index.has(key)) continue;
    index.set(key, {
      title,
      recipe: {
        reviewStatus: "inferred",
        totalMinutes: recipe.t ?? null,
        possibleAllergens: recipe.a as RecipeAllergen[],
        ingredients: recipe.i.map((item) => (typeof item === "string" ? { name: item, optional: false } : { name: item[0], optional: true })),
      },
    });
  }
  return index;
}

// The exact title, or a catalogue title the dish starts with followed by «y …», «con …» or «, …»
// (the same rule as the dish card). Null for a dish outside the catalogue.
export function catalogCardForCheck(title: string): (DishCardForCheck & { totalMinutes: number | null }) | null {
  return findCatalogRecipe(catalogCheckIndex(), title)?.recipe ?? null;
}
