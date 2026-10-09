import { postAi } from "@/lib/ai-client";
import { getDayPosition, getIsoWeekStorageId, type IsoWeek } from "@/lib/isoWeek";
import type { MealSlot, WeekDay } from "@/data/mockWeek";
import type { GeneratedShoppingListResponse } from "@/lib/shoppingList";

// What the list depends on besides the dishes (B6, step 14). The shopping route assumes 2 people,
// receives no restrictions and infers ingredients from dish titles: when any of these changes
// (C1 servings and restrictions per week, C2 recipe cards), the signature changes with it.
export const shoppingListContext = {
  servings: 2,
  restrictions: null,
  ingredientSource: "dish-titles-v1",
} as const;

const signaturePrefix = "shop1:";

function canonicalDish(slot: MealSlot) {
  const dish = slot.normalize("NFC").trim().replace(/\s+/g, " ");
  return dish === "" || dish === "LIBRE" ? null : dish.toLocaleLowerCase("es");
}

// Canonical content of a week for its shopping list: calendar week, dishes by day position,
// servings, restrictions and ingredient source. Never presented text (dates, capitals, spacing)
// nor the week version (B4 bumps it on every write, also when the same menu is applied again).
// A day with both meals free adds nothing to buy, so it is the same as a missing day.
export function getShoppingSignature(isoWeek: IsoWeek, week: WeekDay[]) {
  const days = week
    .map((day) => [getDayPosition(day.day), canonicalDish(day.lunch), canonicalDish(day.dinner)] as const)
    .filter(([position, lunch, dinner]) => position !== -1 && (lunch !== null || dinner !== null))
    .sort((left, right) => left[0] - right[0]);

  return signaturePrefix + JSON.stringify({ week: getIsoWeekStorageId(isoWeek), days, ...shoppingListContext });
}

// Device caches written before B6 signed only the dishes (B3) or the whole week with its date text
// (before B3). They are accepted for that cache's own week, so that no existing list is generated
// again, and rewritten with the canonical signature.
export function matchesShoppingSignature(signature: string | undefined, isoWeek: IsoWeek, week: WeekDay[]) {
  if (!signature) return false;
  if (signature.startsWith(signaturePrefix)) return signature === getShoppingSignature(isoWeek, week);

  return (
    signature === JSON.stringify(week.map((day) => [day.day, day.lunch, day.dinner])) ||
    signature ===
      JSON.stringify(week.map(({ day, date, lunch, dinner }) => ({ day, date, lunch, dinner })))
  );
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
