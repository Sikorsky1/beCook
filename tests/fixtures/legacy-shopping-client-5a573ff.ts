// Frozen copy of src/lib/supabase/shopping-lists.ts as served by main (5a573ff) before B6.
// Used only by scripts/shopping-db-tests.cjs to prove the B6 migration keeps the deployed
// client working during the rollout. Do not edit except for the import paths.
import { supermarketCategoryLabels } from "../../src/lib/shoppingList";

import { supabase } from "../../src/lib/supabase/client";

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
  items: ShoppingItem[];
};

type ShoppingListRow = {
  id: string;
  week_id: string | null;
  generated_at: string | null;
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

function getShoppingItemRow(shoppingListId: string, item: ShoppingItem) {
  return {
    shopping_list_id: shoppingListId,
    name: item.name.trim(),
    quantity: item.quantity,
    unit: item.unit.trim(),
    category: item.category,
    checked: item.checked,
  };
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

export async function saveShoppingListToSupabase(
  weekId: string,
  items: ShoppingItem[],
) {
  if (!supabase) {
    throw new Error(
      "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  if (!weekId) {
    throw new Error("Cannot save a shopping list without a week id.");
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Cannot save a shopping list without items.");
  }

  const { data: insertedShoppingList, error: shoppingListError } =
    await supabase
      .from("shopping_lists")
      .insert({
        week_id: weekId,
        generated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

  if (shoppingListError) {
    throw new Error(
      `Could not save shopping list: ${shoppingListError.message}`,
    );
  }

  if (!insertedShoppingList?.id) {
    throw new Error(
      "Could not save shopping list: Supabase did not return a shopping list id.",
    );
  }

  const shoppingListId = insertedShoppingList.id as string;
  const shoppingItems = items.map((item) =>
    getShoppingItemRow(shoppingListId, item),
  );

  const { error: shoppingItemsError } = await supabase
    .from("shopping_items")
    .insert(shoppingItems);

  if (shoppingItemsError) {
    throw new Error(
      `Could not save shopping list items: ${shoppingItemsError.message}`,
    );
  }

  return shoppingListId;
}

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
    .select("id,week_id,generated_at")
    .eq("week_id", weekId)
    .order("created_at", { ascending: false })
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
    .order("created_at", { ascending: true });

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
    items: ((shoppingItems ?? []) as ShoppingItemRow[]).map(rowToShoppingItem),
  };
}
