import { postAi } from "@/lib/ai-client";
import { getDayPosition, getIsoWeekStorageId, type IsoWeek } from "@/lib/isoWeek";
import type { MealSlot, WeekDay } from "@/data/mockWeek";
import type { GeneratedShoppingListResponse } from "@/lib/shoppingList";

// What the list depends on besides the dishes (B6, step 14): servings, restrictions and where the
// ingredients come from. Weeks applied before C1 have no frozen context: their lists were made for
// 2 people without restrictions, and this legacy context keeps those lists valid.
export const shoppingListContext = {
  servings: 2,
  restrictions: null,
  ingredientSource: "dish-titles-v1",
} as const;

// C1: the week's frozen context (servings and restrictions version, see week_food_contexts).
export type ShoppingFoodContext = { servings: number; version: string };

function signatureContext(context: ShoppingFoodContext | null) {
  return context
    ? { servings: context.servings, restrictions: context.version, ingredientSource: shoppingListContext.ingredientSource }
    : shoppingListContext;
}

const signaturePrefix = "shop1:";

function canonicalDish(slot: MealSlot) {
  const dish = slot.normalize("NFC").trim().replace(/\s+/g, " ");
  return dish === "" || dish === "LIBRE" ? null : dish.toLocaleLowerCase("es");
}

function canonicalDays(week: WeekDay[]) {
  return week
    .map((day) => [getDayPosition(day.day), canonicalDish(day.lunch), canonicalDish(day.dinner)] as const)
    .filter(([position, lunch, dinner]) => position !== -1 && (lunch !== null || dinner !== null))
    .sort((left, right) => left[0] - right[0]);
}

// Canonical content of a week for its shopping list: calendar week, dishes by day position,
// servings, restrictions and ingredient source. Never presented text (dates, capitals, spacing)
// nor the week version (B4 bumps it on every write, also when the same menu is applied again).
// A day with both meals free adds nothing to buy, so it is the same as a missing day.
// context: the week's frozen food context (C1); null for weeks without one (legacy signature).
export function getShoppingSignature(isoWeek: IsoWeek, week: WeekDay[], context: ShoppingFoodContext | null = null) {
  return signaturePrefix + JSON.stringify({ week: getIsoWeekStorageId(isoWeek), days: canonicalDays(week), ...signatureContext(context) });
}

// Device caches written before B6 signed only the dishes (B3) or the whole week with its date text
// (before B3). They are accepted for that cache's own week, so that no existing list is generated
// again, and rewritten with the canonical signature.
// context undefined: not known (the account could not be read), so only the week and its dishes
// are compared; the account decides again as soon as it answers.
export function matchesShoppingSignature(
  signature: string | undefined,
  isoWeek: IsoWeek,
  week: WeekDay[],
  context?: ShoppingFoodContext | null,
) {
  if (!signature) return false;
  if (signature.startsWith(signaturePrefix)) {
    if (context !== undefined) return signature === getShoppingSignature(isoWeek, week, context);
    try {
      const signed = JSON.parse(signature.slice(signaturePrefix.length)) as { week?: unknown; days?: unknown };
      return signed.week === getIsoWeekStorageId(isoWeek) && JSON.stringify(signed.days) === JSON.stringify(canonicalDays(week));
    } catch {
      return false;
    }
  }

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

// isoWeek (C1): the server reads that week's frozen servings and restrictions.
export async function generateShoppingListForWeek(
  weekDays: WeekDay[],
  signal?: AbortSignal,
  isoWeek?: IsoWeek,
) {
  const response = await postAi(
    "/api/generate-shopping-list",
    isoWeek ? { week: weekDays, isoWeek: getIsoWeekStorageId(isoWeek) } : { week: weekDays },
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
