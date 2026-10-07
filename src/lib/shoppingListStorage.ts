import { postAi } from "@/lib/ai-client";
import { writeShoppingCache, type DataIdentity } from "@/lib/data/repositories";
import type { IsoWeek } from "@/lib/isoWeek";
import type { WeekDay } from "@/data/mockWeek";
import {
  groupShoppingListItems,
  type GeneratedShoppingListResponse,
  type ShoppingListItem,
} from "@/lib/shoppingList";

export type ShoppingListCache = {
  weekSignature: string;
  items: GeneratedShoppingListResponse["items"];
  checkedItemIds: string[];
};

// Content only: day name and dishes, never the presented date (full canonical signature in B6).
export function getWeekSignature(week: WeekDay[]) {
  return JSON.stringify(week.map((day) => [day.day, day.lunch, day.dinner]));
}

// Caches written before B3 signed the whole week with its date text; accept them so that no
// existing list is generated again, and rewrite them with the new signature.
export function matchesWeekSignature(signature: string | undefined, week: WeekDay[]) {
  return (
    signature === getWeekSignature(week) ||
    signature ===
      JSON.stringify(
        week.map(({ day, date, lunch, dinner }) => ({ day, date, lunch, dinner })),
      )
  );
}

export function getShoppingItemsForSupabase(
  items: ShoppingListItem[],
  checkedItemIds: string[],
) {
  const checkedItemsSet = new Set(checkedItemIds);

  return items.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    category: item.category,
    checked: checkedItemsSet.has(item.id),
  }));
}

// The list always belongs to an explicit remote week; there is no "latest week" fallback (H7).
export async function syncShoppingListToSupabase(
  items: ShoppingListItem[],
  checkedItemIds: string[],
  weekId: string | null,
) {
  if (items.length === 0 || !weekId) {
    return;
  }

  const shoppingItems = getShoppingItemsForSupabase(items, checkedItemIds);
  const { saveShoppingListToSupabase } = await import(
    "@/lib/supabase/shopping-lists"
  );

  await saveShoppingListToSupabase(weekId, shoppingItems);
}

// A message from the server meant for the user (quota, budget, invalid week).
export class ShoppingListApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShoppingListApiError";
  }
}

export async function generateShoppingListForWeek(
  weekDays: WeekDay[],
  signal?: AbortSignal,
) {
  const response = await postAi(
    "/api/generate-shopping-list",
    { week: weekDays },
    signal,
  );

  const data = (await response.json()) as
    | GeneratedShoppingListResponse
    | { error?: string };

  if (!response.ok) {
    const fallbackMessage = "No se pudo generar la lista de la compra.";
    throw new ShoppingListApiError(
      "error" in data ? data.error ?? fallbackMessage : fallbackMessage,
    );
  }

  return data as GeneratedShoppingListResponse;
}

export async function generateAndCacheShoppingListForWeek(
  identity: DataIdentity,
  isoWeek: IsoWeek,
  weekDays: WeekDay[],
  signal?: AbortSignal,
) {
  const weekSignature = getWeekSignature(weekDays);
  const generatedResponse = await generateShoppingListForWeek(weekDays, signal);
  const groupedItems = groupShoppingListItems(generatedResponse.items).flatMap(
    (group) => group.items,
  );

  writeShoppingCache(identity, isoWeek, {
    weekSignature,
    items: generatedResponse.items,
    checkedItemIds: [],
  });

  return groupedItems;
}
