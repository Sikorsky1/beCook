// Frozen copy of src/lib/supabase/pantry.ts as served by main (ab2433b) before B7.
// Used only by scripts/pantry-db-tests.cjs to prove the B7 migration keeps the deployed client
// working during the rollout. Do not edit except for the import paths.
import { supabase } from "../../src/lib/supabase/client";

export type PantryCategory =
  | "básicos"
  | "especias"
  | "aceites y vinagres"
  | "salsas"
  | "conservas"
  | "congelados"
  | "otros";
type LegacyPantryCategory = PantryCategory;

export type PantryItem = {
  id?: string;
  profileId?: string;
  userId?: string;
  name: string;
  category: PantryCategory;
  active: boolean;
};

type PantryItemRow = {
  id: string;
  profile_id: string | null;
  user_id?: string | null;
  name: string | null;
  category: string | null;
  active: boolean | null;
};

const pantryCategoryValues = new Set<LegacyPantryCategory>([
  "básicos",
  "especias",
  "aceites y vinagres",
  "salsas",
  "conservas",
  "congelados",
  "otros",
]);

function parseRequiredString(value: string | null, columnName: string) {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  throw new Error(`Unexpected empty value in ${columnName}.`);
}

function parseRequiredBoolean(value: boolean | null, columnName: string) {
  if (typeof value === "boolean") {
    return value;
  }

  throw new Error(`Unexpected empty value in ${columnName}.`);
}

function parsePantryCategory(value: string | null): PantryCategory {
  const parsedValue = parseRequiredString(value, "pantry_items.category");

  if (pantryCategoryValues.has(parsedValue as LegacyPantryCategory)) {
    return parsedValue as PantryCategory;
  }

  throw new Error(`Unexpected value in pantry_items.category: ${parsedValue}.`);
}

function getPantryItemRow(
  item: PantryItem,
  options: { profileId?: string; userId?: string | null } = {},
) {
  return {
    profile_id: options.profileId ?? item.profileId ?? null,
    user_id: options.userId ?? item.userId ?? null,
    name: item.name.trim(),
    category: item.category,
    active: item.active,
  };
}

function rowToPantryItem(row: PantryItemRow): PantryItem {
  return {
    id: row.id,
    profileId: row.profile_id ?? undefined,
    userId: row.user_id ?? undefined,
    name: parseRequiredString(row.name, "pantry_items.name"),
    category: parsePantryCategory(row.category),
    active: parseRequiredBoolean(row.active, "pantry_items.active"),
  };
}

export async function savePantryItemsToSupabase(
  items: PantryItem[],
  profileId?: string,
  userId?: string | null,
) {
  if (!supabase) {
    throw new Error(
      "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Cannot save pantry items without items.");
  }

  const pantryItems = items.map((item) =>
    getPantryItemRow(item, { profileId, userId }),
  );
  console.log("Saving pantry item with user:", userId ?? null);

  const { data: insertedItems, error: pantryItemsError } = await supabase
    .from("pantry_items")
    .insert(pantryItems)
    .select("id");

  if (pantryItemsError) {
    throw new Error(`Could not save pantry items: ${pantryItemsError.message}`);
  }

  const insertedIds = ((insertedItems ?? []) as { id?: string }[])
    .map((item) => item.id)
    .filter((id): id is string => Boolean(id));

  if (insertedIds.length !== items.length) {
    throw new Error(
      `Could not save pantry items: expected ${items.length} ids, received ${insertedIds.length}.`,
    );
  }

  return insertedIds;
}

export async function getLatestPantryItemsFromSupabase(
  profileId?: string,
): Promise<PantryItem[]> {
  if (!supabase) {
    throw new Error(
      "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  let query = supabase
    .from("pantry_items")
    .select("id,profile_id,user_id,name,category,active")
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (profileId) {
    query = query.eq("profile_id", profileId);
  }

  const { data: pantryItems, error: pantryItemsError } = await query;

  if (pantryItemsError) {
    throw new Error(`Could not read pantry items: ${pantryItemsError.message}`);
  }

  return ((pantryItems ?? []) as PantryItemRow[]).map(rowToPantryItem);
}

export async function replacePantryItemsInSupabase(
  items: PantryItem[],
  profileId?: string,
  userId?: string | null,
) {
  if (!supabase) {
    throw new Error(
      "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  let deleteQuery = supabase.from("pantry_items").delete();

  if (userId) {
    deleteQuery = deleteQuery.eq("user_id", userId);
  } else {
    deleteQuery = profileId
      ? deleteQuery.eq("profile_id", profileId)
      : deleteQuery.is("profile_id", null);
  }

  const { error: deleteError } = await deleteQuery;

  if (deleteError) {
    throw new Error(`Could not replace pantry items: ${deleteError.message}`);
  }

  if (items.length === 0) {
    return [];
  }

  return savePantryItemsToSupabase(items, profileId, userId);
}

// The signed-in user's pantry and its version (latest updated_at; null when empty).
export async function getPantryForUserFromSupabase(
  userId: string,
): Promise<{ items: PantryItem[]; version: string | null }> {
  if (!supabase) {
    throw new Error(
      "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  const { data: rows, error } = await supabase
    .from("pantry_items")
    .select("id,profile_id,user_id,name,category,active,updated_at")
    .eq("user_id", userId)
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Could not read pantry items: ${error.message}`);
  }

  const typedRows = (rows ?? []) as (PantryItemRow & { updated_at: string | null })[];
  const version = typedRows.reduce<string | null>(
    (latest, row) => (row.updated_at && (!latest || row.updated_at > latest) ? row.updated_at : latest),
    null,
  );

  return { items: typedRows.map(rowToPantryItem), version };
}
