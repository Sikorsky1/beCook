import { supermarketCategoryLabels } from "@/lib/shoppingList";

import { supabase } from "./client";

export type ShoppingItemCategory = (typeof supermarketCategoryLabels)[number];

export type ShoppingItem = {
  id?: string;
  name: string;
  quantity: number;
  unit: string;
  category: ShoppingItemCategory;
  checked: boolean;
};

export type ShoppingList = {
  id: string;
  weekId: string;
  generatedAt: string;
  // Canonical week content the list was generated for (B6); null on lists created before B6.
  weekSignature: string | null;
  items: ShoppingItem[];
};

type ShoppingListRow = {
  id: string;
  week_id: string | null;
  generated_at: string | null;
  week_signature?: string | null;
};

type ShoppingItemRow = {
  id: string;
  name: string | null;
  quantity: number | null;
  unit: string | null;
  category: string | null;
  checked: boolean | null;
};

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
  return {
    id: row.id,
    name: parseRequiredString(row.name, "shopping_items.name"),
    quantity: parseRequiredNumber(row.quantity, "shopping_items.quantity"),
    unit: parseRequiredString(row.unit, "shopping_items.unit"),
    category: parseShoppingItemCategory(row.category),
    checked: parseRequiredBoolean(row.checked, "shopping_items.checked"),
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

  const { data: latestShoppingList, error: shoppingListError } = await supabase
    .from("shopping_lists")
    .select("id,week_id,generated_at,week_signature")
    .eq("week_id", weekId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle<ShoppingListRow>();

  if (shoppingListError) {
    throw new Error(
      `Could not read latest shopping list: ${shoppingListError.message}`,
    );
  }

  if (!latestShoppingList) {
    return null;
  }

  const { data: shoppingItems, error: shoppingItemsError } = await supabase
    .from("shopping_items")
    .select("id,name,quantity,unit,category,checked")
    .eq("shopping_list_id", latestShoppingList.id)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

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
    items: ((shoppingItems ?? []) as ShoppingItemRow[]).map(rowToShoppingItem),
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
  items: ShoppingItemRow[];
};

function parseShoppingListJson(value: ShoppingListJson): ShoppingList {
  return {
    id: parseRequiredString(value.id, "shopping_lists.id"),
    weekId: parseRequiredString(value.week_id, "shopping_lists.week_id"),
    generatedAt: parseRequiredString(value.generated_at, "shopping_lists.generated_at"),
    weekSignature: value.week_signature ?? null,
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
  items: Omit<ShoppingItem, "id" | "checked">[];
  expectedWeekVersion: number | null;
}): Promise<SaveShoppingListResult> {
  const { data, error } = await requireSupabase().rpc("save_shopping_list", {
    p_iso_year: isoYear,
    p_iso_week: isoWeek,
    p_week_signature: weekSignature,
    p_items: items.map(({ name, quantity, unit, category }) => ({ name, quantity, unit, category })),
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
