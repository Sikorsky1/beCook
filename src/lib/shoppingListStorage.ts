import { postAi } from "@/lib/ai-client";
import type { WeekDay } from "@/data/mockWeek";
import {
  groupShoppingListItems,
  isGeneratedShoppingListResponse,
  type GeneratedShoppingListResponse,
  type ShoppingListItem,
} from "@/lib/shoppingList";

const SHOPPING_LIST_CACHE_KEY = "becook-shopping-list-cache";

export type ShoppingListCache = {
  weekSignature: string;
  items: GeneratedShoppingListResponse["items"];
  checkedItemIds: string[];
};

export function getWeekSignature(week: WeekDay[]) {
  return JSON.stringify(week);
}

export function readShoppingListCache(): ShoppingListCache | null {
  if (typeof window === "undefined") {
    return null;
  }

  const savedCache = window.localStorage.getItem(SHOPPING_LIST_CACHE_KEY);

  if (!savedCache) {
    return null;
  }

  try {
    const parsedCache = JSON.parse(savedCache) as Partial<ShoppingListCache>;

    if (
      typeof parsedCache.weekSignature !== "string" ||
      !Array.isArray(parsedCache.checkedItemIds) ||
      !parsedCache.checkedItemIds.every((itemId) => typeof itemId === "string") ||
      !isGeneratedShoppingListResponse({ items: parsedCache.items })
    ) {
      return null;
    }

    const parsedItems =
      parsedCache.items as GeneratedShoppingListResponse["items"];

    return {
      weekSignature: parsedCache.weekSignature,
      items: parsedItems,
      checkedItemIds: parsedCache.checkedItemIds,
    };
  } catch {
    return null;
  }
}

export function saveShoppingListCache(cache: ShoppingListCache) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SHOPPING_LIST_CACHE_KEY, JSON.stringify(cache));
}

export function clearShoppingListCache() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(SHOPPING_LIST_CACHE_KEY);
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

async function getLatestWeekIdFromSupabase() {
  const { supabase } = await import("@/lib/supabase/client");

  if (!supabase) {
    throw new Error(
      "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  const { data: latestWeek, error: latestWeekError } = await supabase
    .from("weeks")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (latestWeekError) {
    throw new Error(`Could not read latest week id: ${latestWeekError.message}`);
  }

  return latestWeek?.id ?? null;
}

export async function syncShoppingListToSupabase(
  items: ShoppingListItem[],
  checkedItemIds: string[],
  weekId?: string | null,
) {
  if (items.length === 0) {
    return;
  }

  const shoppingItems = getShoppingItemsForSupabase(items, checkedItemIds);
  const targetWeekId = weekId ?? (await getLatestWeekIdFromSupabase());

  if (!targetWeekId) {
    console.warn(
      "No se pudo sincronizar la lista de la compra con Supabase: no hay semana remota.",
    );
    return;
  }

  const { saveShoppingListToSupabase } = await import(
    "@/lib/supabase/shopping-lists"
  );

  await saveShoppingListToSupabase(targetWeekId, shoppingItems);
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
  weekDays: WeekDay[],
  signal?: AbortSignal,
) {
  const weekSignature = getWeekSignature(weekDays);
  const generatedResponse = await generateShoppingListForWeek(weekDays, signal);
  const groupedItems = groupShoppingListItems(generatedResponse.items).flatMap(
    (group) => group.items,
  );

  saveShoppingListCache({
    weekSignature,
    items: generatedResponse.items,
    checkedItemIds: [],
  });

  return groupedItems;
}
