import catalog from "@/data/nutritionist-recipes.json";
import { supermarketCategoryLabels, type SupermarketCategory } from "@/lib/shoppingList";

// Dish cards (C2, roadmap step 17). A week slot may point to one immutable version of a card
// (recipe_versions in the database). Content rules here mirror the database checks of
// supabase/migrations/20261012090000_recipe_cards.sql; the database has the last word.

// EU-14 allergens a card may list as possible. Never a guarantee that a dish is free of them.
export const recipeAllergens = [
  "gluten",
  "crustaceans",
  "eggs",
  "fish",
  "peanuts",
  "soy",
  "milk",
  "nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
] as const;

export type RecipeAllergen = (typeof recipeAllergens)[number];

export const recipeAllergenLabels: Record<RecipeAllergen, string> = {
  gluten: "Gluten",
  crustaceans: "Crustáceos",
  eggs: "Huevo",
  fish: "Pescado",
  peanuts: "Cacahuete",
  soy: "Soja",
  milk: "Leche",
  nuts: "Frutos de cáscara",
  celery: "Apio",
  mustard: "Mostaza",
  sesame: "Sésamo",
  sulphites: "Sulfitos",
  lupin: "Altramuces",
  molluscs: "Moluscos",
};

export const recipeCardLimits = {
  minServings: 1,
  maxServings: 12,
  maxMinutes: 720,
  maxIngredients: 40,
  maxIngredientName: 80,
  maxUnit: 20,
  maxQuantity: 100_000,
  maxSteps: 20,
  maxStepLength: 400,
  minTitle: 3,
  maxTitle: 200,
} as const;

export type RecipeIngredient = {
  name: string;
  quantity: number | null;
  unit: string | null;
  category: SupermarketCategory;
  optional: boolean;
};

// What a card says about a dish (the part that is versioned and hashed).
export type RecipeCardContent = {
  baseServings: number;
  totalMinutes: number | null;
  ingredients: RecipeIngredient[];
  steps: string[];
  possibleAllergens: RecipeAllergen[];
};

export type RecipeReviewStatus = "reviewed" | "inferred";

// A card version as shown in the app.
export type RecipeCard = RecipeCardContent & {
  versionId: string;
  recipeId: string;
  version: number;
  title: string;
  origin: "catalog" | "ai" | "user";
  reviewStatus: RecipeReviewStatus;
};

// The link a week slot keeps (WeekDay.lunchRecipe / dinnerRecipe).
export type RecipeLink = { versionId: string };

export type RecipeCardIssue =
  | "not_object"
  | "unknown_key"
  | "servings"
  | "minutes"
  | "ingredients"
  | "ingredient"
  | "steps"
  | "step"
  | "allergens";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRecipeVersionId(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

export function parseRecipeLink(value: unknown): RecipeLink | null {
  const versionId = (value as { versionId?: unknown } | null)?.versionId;
  return isRecipeVersionId(versionId) ? { versionId: versionId.toLowerCase() } : null;
}

// Case and spacing do not make another dish; accents do. Same rule as public.recipe_title_key.
export function recipeTitleKey(title: string) {
  return title.replace(/\s+/g, " ").trim().toLowerCase();
}

export function sameDishTitle(first: string, second: string) {
  return recipeTitleKey(first) === recipeTitleKey(second);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const ingredientKeys = ["category", "name", "optional", "quantity", "unit"];
const contentKeys = new Set(["baseServings", "totalMinutes", "ingredients", "steps", "possibleAllergens", "model"]);

function readIngredient(value: unknown): RecipeIngredient | null {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== ingredientKeys.join(",")) return null;
  const { name, quantity, unit, category, optional } = value;
  if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > recipeCardLimits.maxIngredientName) return null;
  if (quantity !== null && (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0 || quantity > recipeCardLimits.maxQuantity)) return null;
  if (unit !== null && (typeof unit !== "string" || unit.trim().length < 1 || unit.trim().length > recipeCardLimits.maxUnit)) return null;
  if (typeof category !== "string" || !supermarketCategoryLabels.includes(category as SupermarketCategory)) return null;
  if (typeof optional !== "boolean") return null;
  return { name: name.trim(), quantity, unit: unit === null ? null : unit.trim(), category: category as SupermarketCategory, optional };
}

// Validates and canonicalises card content (from the AI, the catalogue draft or the database).
// Never repairs a card: anything outside the schema is rejected with its reason.
export function validateRecipeCardContent(
  value: unknown,
): { ok: true; card: RecipeCardContent } | { ok: false; reason: RecipeCardIssue } {
  if (!isRecord(value)) return { ok: false, reason: "not_object" };
  if (Object.keys(value).some((key) => !contentKeys.has(key))) return { ok: false, reason: "unknown_key" };
  const { baseServings, totalMinutes, ingredients, steps, possibleAllergens } = value;
  if (!Number.isInteger(baseServings) || (baseServings as number) < recipeCardLimits.minServings || (baseServings as number) > recipeCardLimits.maxServings) {
    return { ok: false, reason: "servings" };
  }
  if (totalMinutes !== null && (!Number.isInteger(totalMinutes) || (totalMinutes as number) < 1 || (totalMinutes as number) > recipeCardLimits.maxMinutes)) {
    return { ok: false, reason: "minutes" };
  }
  if (!Array.isArray(ingredients) || ingredients.length < 1 || ingredients.length > recipeCardLimits.maxIngredients) {
    return { ok: false, reason: "ingredients" };
  }
  const parsedIngredients = ingredients.map(readIngredient);
  if (parsedIngredients.some((ingredient) => ingredient === null)) return { ok: false, reason: "ingredient" };
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > recipeCardLimits.maxSteps) return { ok: false, reason: "steps" };
  if (steps.some((step) => typeof step !== "string" || step.trim().length < 1 || step.trim().length > recipeCardLimits.maxStepLength)) {
    return { ok: false, reason: "step" };
  }
  if (!Array.isArray(possibleAllergens) || possibleAllergens.some((item) => !(recipeAllergens as readonly unknown[]).includes(item))) {
    return { ok: false, reason: "allergens" };
  }
  return {
    ok: true,
    card: {
      baseServings: baseServings as number,
      totalMinutes: totalMinutes as number | null,
      ingredients: parsedIngredients as RecipeIngredient[],
      steps: (steps as string[]).map((step) => step.trim()),
      possibleAllergens: recipeAllergens.filter((allergen) => (possibleAllergens as unknown[]).includes(allergen)),
    },
  };
}

// Catalogue identities (the nutritionist's 27 recipes, ids «nutri-…», in src/data/nutritionist-recipes.json):
// the same rows the migration inserts into public.recipes with origin «catalog». Exact title match
// only. The other catalogue recipes (titles taken from recipe websites) have no identity yet.
export const catalogIdentityRecipes = catalog.recipes.filter((recipe) => recipe.id.startsWith("nutri-"));
export type CatalogRecipeIdentity = { catalogKey: string; title: string; meal: "lunch" | "dinner" };

export function findCatalogRecipeIdentity(title: string): CatalogRecipeIdentity | null {
  const key = recipeTitleKey(title);
  if (!key) return null;
  const recipe = catalogIdentityRecipes.find((candidate) => recipeTitleKey(candidate.name) === key);
  return recipe ? { catalogKey: recipe.id, title: recipe.name, meal: recipe.slot === "dinner" ? "dinner" : "lunch" } : null;
}

// Strict JSON schema of an estimated card for the AI (one dish). Units and quantities may be null
// when the amount is «al gusto»; the database applies the same limits.
export const recipeCardJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["baseServings", "totalMinutes", "ingredients", "steps", "possibleAllergens"],
  properties: {
    baseServings: { type: "integer", minimum: 1, maximum: 12 },
    totalMinutes: { type: ["integer", "null"], minimum: 1, maximum: 720 },
    ingredients: {
      type: "array",
      minItems: 1,
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "quantity", "unit", "category", "optional"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 80 },
          quantity: { type: ["number", "null"] },
          unit: { type: ["string", "null"], maxLength: 20 },
          category: { type: "string", enum: supermarketCategoryLabels },
          optional: { type: "boolean" },
        },
      },
    },
    steps: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 400 } },
    possibleAllergens: { type: "array", items: { type: "string", enum: [...recipeAllergens] } },
  },
} as const;

// Database row (recipe_versions joined with recipes) → card. Null when anything is off.
export function recipeCardFromRow(row: unknown): RecipeCard | null {
  if (!isRecord(row)) return null;
  const recipe = isRecord(row.recipes) ? row.recipes : null;
  if (!recipe || !isRecipeVersionId(row.id) || !isRecipeVersionId(recipe.id) || typeof recipe.title !== "string") return null;
  if (row.review_status !== "reviewed" && row.review_status !== "inferred") return null;
  if (recipe.origin !== "catalog" && recipe.origin !== "ai" && recipe.origin !== "user") return null;
  if (!Number.isInteger(row.version)) return null;
  const content = validateRecipeCardContent({
    baseServings: row.base_servings,
    totalMinutes: row.total_minutes ?? null,
    ingredients: row.ingredients,
    steps: row.steps,
    possibleAllergens: row.possible_allergens,
  });
  if (!content.ok) return null;
  return {
    ...content.card,
    versionId: row.id.toLowerCase(),
    recipeId: recipe.id.toLowerCase(),
    version: row.version as number,
    title: recipe.title,
    origin: recipe.origin,
    reviewStatus: row.review_status,
  };
}

export function formatIngredientAmount(ingredient: RecipeIngredient) {
  if (ingredient.quantity === null) return ingredient.unit ?? "";
  const quantity = Number.isInteger(ingredient.quantity) ? String(ingredient.quantity) : ingredient.quantity.toLocaleString("es-ES");
  return ingredient.unit ? `${quantity} ${ingredient.unit}` : quantity;
}

// A card as returned by /api/dish-card (camelCase). Null when anything is off.
export function parseRecipeCard(value: unknown): RecipeCard | null {
  if (!isRecord(value)) return null;
  const { versionId, recipeId, version, title, origin, reviewStatus } = value;
  if (!isRecipeVersionId(versionId) || !isRecipeVersionId(recipeId) || !Number.isInteger(version) || typeof title !== "string") return null;
  if (origin !== "catalog" && origin !== "ai" && origin !== "user") return null;
  if (reviewStatus !== "reviewed" && reviewStatus !== "inferred") return null;
  const content = validateRecipeCardContent({
    baseServings: value.baseServings,
    totalMinutes: value.totalMinutes ?? null,
    ingredients: value.ingredients,
    steps: value.steps,
    possibleAllergens: value.possibleAllergens,
  });
  if (!content.ok) return null;
  return {
    ...content.card,
    versionId: versionId.toLowerCase(),
    recipeId: recipeId.toLowerCase(),
    version: version as number,
    title,
    origin,
    reviewStatus,
  };
}
