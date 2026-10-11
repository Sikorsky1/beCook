// Frozen copy of src/lib/supabase/shopping-lists.ts as served by main (f810818, C4) before D5.
// Used only by scripts/shopping-manual-db-tests.cjs to prove the D5 migration keeps the deployed
// client working during the rollout. Do not edit except for the import paths.
import type { ReconcileOps, ReconcileSummary } from "./legacy-shopping-reconcile-f810818";
import {
  parseShoppingOrigins,
  supermarketCategoryLabels,
  type ShoppingOrigin,
} from "./legacy-shopping-list-f810818";

import { supabase } from "../../src/lib/supabase/client";

export type ShoppingItemCategory = (typeof supermarketCategoryLabels)[number];

export type ShoppingItem = {
  id?: string;
  name: string;
  // null: «al gusto» (C4).
  quantity: number | null;
  unit: string;
  category: ShoppingItemCategory;
  checked: boolean;
  // C4 (20261013090000_shopping_item_origins). Absent or null on rows made before C4, and when the
  // database does not have the columns yet.
  itemKey?: string | null;
  origins?: ShoppingOrigin[] | null;
  checkedQuantity?: number | null;
  needsReview?: boolean;
  removedAt?: string | null;
};

export type ShoppingList = {
  id: string;
  weekId: string;
  generatedAt: string;
  // Canonical week content the list was generated for (B6); null on lists created before B6.
  weekSignature: string | null;
  // C4: 'mixed-v1' when the items have keys and origins; null on lists made from titles only.
  ingredientBasis?: string | null;
  items: ShoppingItem[];
};

type ShoppingListRow = {
  id: string;
  week_id: string | null;
  generated_at: string | null;
  week_signature?: string | null;
  ingredient_basis?: string | null;
  reconciled_at?: string | null;
};

type ShoppingItemRow = {
  id: string;
  name: string | null;
  quantity: number | null;
  unit: string | null;
  category: string | null;
  checked: boolean | null;
  item_key?: string | null;
  origins?: unknown;
  checked_quantity?: number | null;
  needs_review?: boolean | null;
  removed_at?: string | null;
};

const listColumns = "id,week_id,generated_at,week_signature,ingredient_basis,reconciled_at";
const legacyListColumns = "id,week_id,generated_at,week_signature";
const itemColumns = "id,name,quantity,unit,category,checked,item_key,origins,checked_quantity,needs_review,removed_at";
const legacyItemColumns = "id,name,quantity,unit,category,checked";
// Postgres «undefined column»: the C4 migration is not applied in this database yet.
const undefinedColumn = (error: { code?: string } | null) => error?.code === "42703";

const shoppingItemCategoryValues = new Set<ShoppingItemCategory>(
  supermarketCategoryLabels,
);

function parseRequiredString(value: string | null, columnName: string) {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  throw new Error(`Unexpected empty value in ${columnName}.`);
}

function parseRequiredNumber(value: number | null, columnName: string) {
  if (typeof value === "number" && Number.isFinite(value)) {
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

function parseShoppingItemCategory(
  value: string | null,
): ShoppingItemCategory {
  const parsedValue = parseRequiredString(value, "shopping_items.category");

  if (shoppingItemCategoryValues.has(parsedValue as ShoppingItemCategory)) {
    return parsedValue as ShoppingItemCategory;
  }

  throw new Error(
    `Unexpected value in shopping_items.category: ${parsedValue}.`,
  );
}

function rowToShoppingItem(row: ShoppingItemRow): ShoppingItem {
  const unit = parseRequiredString(row.unit, "shopping_items.unit");
  // C4: a NULL quantity is «al gusto» (only accepted by the database with that unit).
  const quantity = row.quantity === null && unit.trim().toLowerCase() === "al gusto"
    ? null
    : parseRequiredNumber(row.quantity === null ? null : Number(row.quantity), "shopping_items.quantity");
  return {
    id: row.id,
    name: parseRequiredString(row.name, "shopping_items.name"),
    quantity,
    unit,
    category: parseShoppingItemCategory(row.category),
    checked: parseRequiredBoolean(row.checked, "shopping_items.checked"),
    itemKey: typeof row.item_key === "string" && row.item_key ? row.item_key : null,
    origins: parseShoppingOrigins(row.origins),
    checkedQuantity: row.checked_quantity === null || row.checked_quantity === undefined ? null : Number(row.checked_quantity),
    needsReview: row.needs_review === true,
    removedAt: typeof row.removed_at === "string" ? row.removed_at : null,
  };
}

// The current list of a week is its most recent one (same order as the database functions).
export async function getLatestShoppingListForWeekFromSupabase(
  weekId: string,
): Promise<ShoppingList | null> {
  if (!supabase) {
    throw new Error(
      "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  if (!weekId) {
    throw new Error("Cannot read a shopping list without a week id.");
  }

  const client = supabase;
  const readList = (columns: string) =>
    client
      .from("shopping_lists")
      .select(columns)
      .eq("week_id", weekId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle<ShoppingListRow>();
  let { data: latestShoppingList, error: shoppingListError } = await readList(listColumns);
  if (undefinedColumn(shoppingListError)) ({ data: latestShoppingList, error: shoppingListError } = await readList(legacyListColumns));

  if (shoppingListError) {
    throw new Error(
      `Could not read latest shopping list: ${shoppingListError.message}`,
    );
  }

  if (!latestShoppingList) {
    return null;
  }

  const listId = latestShoppingList.id;
  const readItems = (columns: string) =>
    client
      .from("shopping_items")
      .select(columns)
      .eq("shopping_list_id", listId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
  let { data: shoppingItems, error: shoppingItemsError } = await readItems(itemColumns);
  if (undefinedColumn(shoppingItemsError)) ({ data: shoppingItems, error: shoppingItemsError } = await readItems(legacyItemColumns));

  if (shoppingItemsError) {
    throw new Error(
      `Could not read shopping list items: ${shoppingItemsError.message}`,
    );
  }

  return {
    id: latestShoppingList.id,
    weekId: parseRequiredString(
      latestShoppingList.week_id,
      "shopping_lists.week_id",
    ),
    generatedAt: parseRequiredString(
      latestShoppingList.generated_at,
      "shopping_lists.generated_at",
    ),
    weekSignature: latestShoppingList.week_signature ?? null,
    ingredientBasis: latestShoppingList.ingredient_basis ?? null,
    items: ((shoppingItems ?? []) as unknown as ShoppingItemRow[]).map(rowToShoppingItem),
  };
}

function requireSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  return supabase;
}

type ShoppingListJson = {
  id: string;
  week_id: string;
  generated_at: string;
  week_signature: string | null;
  ingredient_basis?: string | null;
  items: ShoppingItemRow[];
};

function parseShoppingListJson(value: ShoppingListJson): ShoppingList {
  return {
    id: parseRequiredString(value.id, "shopping_lists.id"),
    weekId: parseRequiredString(value.week_id, "shopping_lists.week_id"),
    generatedAt: parseRequiredString(value.generated_at, "shopping_lists.generated_at"),
    weekSignature: value.week_signature ?? null,
    ingredientBasis: value.ingredient_basis ?? null,
    items: value.items.map(rowToShoppingItem),
  };
}

export type SaveShoppingListResult =
  | { status: "created" | "existing"; list: ShoppingList; weekVersion: number }
  | { status: "week_changed"; weekVersion: number }
  | { status: "no_week" };

// Stores the list generated for the caller's calendar week (save_shopping_list), unless its
// current list already has this signature. With `expectedWeekVersion`, only if the week is still
// at that version (it may have changed while the list was being generated).
export async function saveShoppingListInSupabase({
  isoYear,
  isoWeek,
  weekSignature,
  items,
  expectedWeekVersion,
}: {
  isoYear: number;
  isoWeek: number;
  weekSignature: string;
  items: Pick<ShoppingItem, "name" | "quantity" | "unit" | "category" | "itemKey" | "origins">[];
  expectedWeekVersion: number | null;
}): Promise<SaveShoppingListResult> {
  const { data, error } = await requireSupabase().rpc("save_shopping_list", {
    p_iso_year: isoYear,
    p_iso_week: isoWeek,
    p_week_signature: weekSignature,
    // item_key / origins (C4) only when known: without them the list is saved as before C4.
    p_items: items.map(({ name, quantity, unit, category, itemKey, origins }) => ({
      name,
      quantity,
      unit,
      category,
      ...(itemKey ? { item_key: itemKey, origins: origins ?? [] } : {}),
    })),
    p_expected_week_version: expectedWeekVersion,
  });

  if (error) {
    throw new Error(`Could not save shopping list: ${error.message}`);
  }

  const result = data as { status?: string; list?: ShoppingListJson | null; week_version?: number | null } | null;

  switch (result?.status) {
    case "created":
    case "existing":
      if (!result.list || typeof result.week_version !== "number") break;
      return { status: result.status, list: parseShoppingListJson(result.list), weekVersion: result.week_version };
    case "week_changed":
      if (typeof result.week_version !== "number") break;
      return { status: "week_changed", weekVersion: result.week_version };
    case "no_week":
      return { status: "no_week" };
  }

  throw new Error("Unexpected save_shopping_list result.");
}

export type SetShoppingItemsCheckedResult = { status: "applied" | "stale" | "missing" };

// Marks or unmarks items of one list (set_shopping_items_checked), only while it is the current
// list of its week.
export async function setShoppingItemsCheckedInSupabase(
  itemIds: string[],
  checked: boolean,
): Promise<SetShoppingItemsCheckedResult> {
  const { data, error } = await requireSupabase().rpc("set_shopping_items_checked", {
    p_item_ids: itemIds,
    p_checked: checked,
  });

  if (error) {
    throw new Error(`Could not update shopping items: ${error.message}`);
  }

  const status = (data as { status?: string } | null)?.status;

  if (status === "applied" || status === "stale" || status === "missing") {
    return { status };
  }

  throw new Error("Unexpected set_shopping_items_checked result.");
}

export type ReconcileShoppingListResult =
  | { status: "applied"; list: ShoppingList; weekVersion: number; summary: ReconcileSummary }
  | { status: "existing"; list: ShoppingList; weekVersion: number }
  | { status: "stale"; weekVersion: number | null }
  | { status: "week_changed"; weekVersion: number | null }
  | { status: "no_week" }
  // The database does not have reconcile_shopping_list yet (C4 migration not applied).
  | { status: "unavailable" };

function parseSummary(value: unknown): ReconcileSummary {
  const summary = (value ?? {}) as Record<string, unknown>;
  const count = (key: string) => (Number.isInteger(summary[key]) ? (summary[key] as number) : 0);
  return { added: count("added"), removed: count("removed"), keptBought: count("keptBought"), changed: count("changed"), review: count("review") };
}

// Updates the current list of the caller's week in place (reconcile_shopping_list, C4): only while
// it is still `listId` with `fromSignature` and the week is at `expectedWeekVersion`.
export async function reconcileShoppingListInSupabase({
  isoYear,
  isoWeek,
  listId,
  fromSignature,
  toSignature,
  ops,
  expectedWeekVersion,
}: {
  isoYear: number;
  isoWeek: number;
  listId: string;
  fromSignature: string | null;
  toSignature: string;
  ops: ReconcileOps;
  expectedWeekVersion: number | null;
}): Promise<ReconcileShoppingListResult> {
  const { data, error } = await requireSupabase().rpc("reconcile_shopping_list", {
    p_iso_year: isoYear,
    p_iso_week: isoWeek,
    p_list_id: listId,
    p_from_signature: fromSignature,
    p_to_signature: toSignature,
    p_ops: ops,
    p_expected_week_version: expectedWeekVersion,
  });

  if (error) {
    // Only the function itself missing (migration not applied) means «unavailable»: PostgREST
    // PGRST202, or an undefined-function error that names it. Anything else is an error (never a
    // reason to make a new list).
    if (error.code === "PGRST202" || (error.code === "42883" && /reconcile_shopping_list\s*\(/.test(error.message))) {
      return { status: "unavailable" };
    }
    throw new Error(`Could not update shopping list: ${error.message}`);
  }

  const result = data as { status?: string; list?: ShoppingListJson | null; week_version?: number | null; summary?: unknown } | null;
  const weekVersion = typeof result?.week_version === "number" ? result.week_version : null;

  switch (result?.status) {
    case "applied":
      if (!result.list || weekVersion === null) break;
      return { status: "applied", list: parseShoppingListJson(result.list), weekVersion, summary: parseSummary(result.summary) };
    case "existing":
      if (!result.list || weekVersion === null) break;
      return { status: "existing", list: parseShoppingListJson(result.list), weekVersion };
    case "stale":
      return { status: "stale", weekVersion };
    case "week_changed":
      return { status: "week_changed", weekVersion };
    case "no_week":
      return { status: "no_week" };
  }

  throw new Error("Unexpected reconcile_shopping_list result.");
}
