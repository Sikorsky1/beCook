import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isRecipeVersionId,
  recipeCardFromRow,
  recipeTitleKey,
  type RecipeCard,
  type RecipeCardContent,
} from "@/lib/recipes/card";
import { supabase } from "./client";
import { parseWeekWriteResult, type MealKind } from "./weeks";

// Dish cards (C2). Reads go through RLS: the catalogue for everyone, own cards for their owner.
// Writes only through the RPCs of 20261012090000_recipe_cards (no direct table grants).

const dayNames = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

const cardColumns =
  "id,version,base_servings,total_minutes,ingredients,steps,possible_allergens,review_status,recipes!inner(id,title,origin)";

function requireClient(client: SupabaseClient | null = supabase) {
  if (!client) {
    throw new Error("Supabase client is not configured.");
  }
  return client;
}

// One card version (null: not found or not readable by this session).
export async function getRecipeCardFromSupabase(versionId: string, client?: SupabaseClient | null): Promise<RecipeCard | null> {
  if (!isRecipeVersionId(versionId)) return null;
  const { data, error } = await requireClient(client)
    .from("recipe_versions")
    .select(cardColumns)
    .eq("id", versionId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read the dish card: ${error.message}`);
  }

  return data ? recipeCardFromRow(data) : null;
}

// Several card versions in one read (C4: the shopping list of a week). Versions that are not found
// or not readable by this session are simply absent from the map.
export async function getRecipeCardsFromSupabase(versionIds: string[], client?: SupabaseClient | null): Promise<Map<string, RecipeCard>> {
  const ids = [...new Set(versionIds.filter(isRecipeVersionId).map((id) => id.toLowerCase()))];
  const cards = new Map<string, RecipeCard>();
  if (ids.length === 0) return cards;
  const { data, error } = await requireClient(client).from("recipe_versions").select(cardColumns).in("id", ids);

  if (error) {
    throw new Error(`Could not read the dish cards: ${error.message}`);
  }

  for (const row of data ?? []) {
    const card = recipeCardFromRow(row);
    if (card) cards.set(card.versionId, card);
  }
  return cards;
}

// Catalogue recipes that have a reviewed version, by title key → latest reviewed version.
// Today the catalogue has identities only (no reviewed version yet): the map is empty.
export async function getCatalogReviewedVersionsFromSupabase(client?: SupabaseClient | null) {
  const { data, error } = await requireClient(client)
    .from("recipes")
    .select("title,recipe_versions(id,version,review_status)")
    .is("owner_user_id", null);

  if (error) {
    throw new Error(`Could not read the recipe catalogue: ${error.message}`);
  }

  const index = new Map<string, { versionId: string }>();
  for (const recipe of (data ?? []) as { title: string; recipe_versions: { id: string; version: number; review_status: string }[] | null }[]) {
    const reviewed = (recipe.recipe_versions ?? [])
      .filter((version) => version.review_status === "reviewed" && isRecipeVersionId(version.id))
      .sort((first, second) => second.version - first.version)[0];
    if (reviewed) index.set(recipeTitleKey(recipe.title), { versionId: reviewed.id.toLowerCase() });
  }
  return index;
}

// The caller's own estimated card for a title (latest version), if they already have one.
// Two plain reads (the recipe by owner and title key, then its latest version): no filters on an
// embedded resource, which PostgREST would apply to the embed and not to the rows.
export async function getOwnRecipeCardByTitleFromSupabase(client: SupabaseClient, userId: string, title: string) {
  const { data: recipe, error: recipeError } = await client
    .from("recipes")
    .select("id")
    .eq("owner_user_id", userId)
    .eq("title_key", recipeTitleKey(title))
    .maybeSingle<{ id: string }>();

  if (recipeError) {
    throw new Error(`Could not read the dish card: ${recipeError.message}`);
  }
  if (!recipe) return null;

  const { data, error } = await client
    .from("recipe_versions")
    .select(cardColumns)
    .eq("recipe_id", recipe.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read the dish card: ${error.message}`);
  }

  return data ? recipeCardFromRow(data) : null;
}

// Saves an AI-estimated card as the caller's own (always inferred). See save_inferred_recipe.
export async function saveInferredRecipeInSupabase(
  client: SupabaseClient,
  { title, card, model, requestKey }: { title: string; card: RecipeCardContent; model: string | null; requestKey: string },
) {
  const { data, error } = await client.rpc("save_inferred_recipe", {
    p_title: title,
    p_card: { ...card, model },
    p_request_key: requestKey,
  });

  if (error) {
    throw new Error(`Could not save the dish card: ${error.message}`);
  }

  const result = data as { status?: unknown; version_id?: unknown } | null;
  const status = result?.status;
  if (
    (status !== "created" && status !== "new_version" && status !== "existing" && status !== "duplicate") ||
    !isRecipeVersionId(result?.version_id)
  ) {
    throw new Error("Unexpected dish card result.");
  }

  return { status, versionId: (result.version_id as string).toLowerCase() };
}

// Links (or unlinks with null) the card of one planned meal, only at `expectedVersion`.
export async function updateWeekSlotRecipeInSupabase(
  {
    isoYear,
    isoWeek,
    dayName,
    meal,
    versionId,
    expectedVersion,
    requestKey,
  }: {
    isoYear: number;
    isoWeek: number;
    dayName: string;
    meal: MealKind;
    versionId: string | null;
    expectedVersion: number;
    requestKey: string;
  },
  client?: SupabaseClient | null,
) {
  const position = dayNames.indexOf(dayName);

  if (position === -1) {
    throw new Error(`Cannot link a card to an unknown day: ${dayName}.`);
  }

  const { data, error } = await requireClient(client).rpc("update_week_slot_recipe", {
    p_iso_year: isoYear,
    p_iso_week: isoWeek,
    p_position: position,
    p_meal: meal,
    p_recipe_version_id: versionId,
    p_expected_version: expectedVersion,
    p_request_key: requestKey,
  });

  if (error) {
    throw new Error(`Could not link the dish card: ${error.message}`);
  }

  return parseWeekWriteResult(data);
}
