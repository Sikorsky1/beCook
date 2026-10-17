import type { RecipeTags } from "@/lib/menu-generation/recipe-tags";
import { recipeTitleKey } from "./card";

// The catalogue tags for the browser (N07): catalog-tags.json is loaded on first use, not bundled
// with the page (catalogTags.ts reads it synchronously on the server).
export type TagsLookup = (title: string) => RecipeTags | null;

let lookup: Promise<TagsLookup> | null = null;

export function loadCatalogTags(): Promise<TagsLookup> {
  lookup ??= import("@/data/recipe-cards/catalog-tags.json")
    .then((module) => {
      const file = (module.default ?? module) as unknown as { recipes: Record<string, RecipeTags> };
      const index = new Map(Object.entries(file.recipes).map(([name, tags]) => [recipeTitleKey(name), tags]));
      return (title: string) => index.get(recipeTitleKey(title)) ?? null;
    })
    .catch((error) => {
      lookup = null;
      throw error;
    });
  return lookup;
}
