import { postAi } from "@/lib/ai-client";
import { getDayPosition, getIsoWeekStorageId, type IsoWeek } from "@/lib/isoWeek";
import type { MealSlot, WeekDay } from "@/data/mockWeek";
import {
  isGeneratedShoppingBreakdown,
  isGeneratedShoppingListResponse,
  type GeneratedShoppingDish,
  type GeneratedShoppingListResponse,
} from "@/lib/shoppingList";

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

// C4: card versions of the planned meals (a free meal never has one). Versions are immutable, so
// the same links mean the same ingredients.
function canonicalCards(week: WeekDay[]) {
  const link = (slot: MealSlot, versionId: string | undefined) => (canonicalDish(slot) !== null && versionId ? versionId.toLowerCase() : null);
  return week
    .map((day) => [getDayPosition(day.day), link(day.lunch, day.lunchRecipe?.versionId), link(day.dinner, day.dinnerRecipe?.versionId)] as const)
    .filter(([position, lunch, dinner]) => position !== -1 && (lunch !== null || dinner !== null))
    .sort((left, right) => left[0] - right[0]);
}

// Ingredient source of lists that take some dishes from their cards (C4).
export const mixedIngredientSource = "mixed-v1";

// Canonical content of a week for its shopping list: calendar week, dishes by day position,
// servings, restrictions and ingredient source. Never presented text (dates, capitals, spacing)
// nor the week version (B4 bumps it on every write, also when the same menu is applied again).
// A day with both meals free adds nothing to buy, so it is the same as a missing day.
// context: the week's frozen food context (C1); null for weeks without one (legacy signature).
// C4: a week where some meal has a card adds those card versions and the ingredient source
// «mixed-v1»; a week without cards keeps exactly the signature of B6/C1 (its lists stay valid).
export function getShoppingSignature(isoWeek: IsoWeek, week: WeekDay[], context: ShoppingFoodContext | null = null) {
  const cards = canonicalCards(week);
  return signaturePrefix + JSON.stringify({
    week: getIsoWeekStorageId(isoWeek),
    days: canonicalDays(week),
    ...signatureContext(context),
    ...(cards.length ? { ingredientSource: mixedIngredientSource, cards } : {}),
  });
}

// Servings and restrictions a signature was made for (null: not a canonical signature). Used to
// know whether the AI ingredients a list already has are still valid for the week.
export function shoppingSignatureContext(signature: string | null | undefined) {
  if (!signature?.startsWith(signaturePrefix)) return null;
  try {
    const signed = JSON.parse(signature.slice(signaturePrefix.length)) as { servings?: unknown; restrictions?: unknown };
    return { servings: signed.servings ?? null, restrictions: signed.restrictions ?? null };
  } catch {
    return null;
  }
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

// C4: ingredients per dish for the given meals only (the rest of the week goes as «LIBRE»). One
// call, one unit of the shopping quota. dishes is null when the server did not break the list down
// (it then answered only the whole-week items, as before C4).
export async function generateShoppingBreakdownForWeek(
  weekDays: WeekDay[],
  isoWeek?: IsoWeek,
  signal?: AbortSignal,
): Promise<{ dishes: GeneratedShoppingDish[] | null; items: GeneratedShoppingListResponse["items"] }> {
  const response = await postAi(
    "/api/generate-shopping-list",
    { week: weekDays, ...(isoWeek ? { isoWeek: getIsoWeekStorageId(isoWeek) } : {}), breakdown: true },
    signal,
  );
  const data = (await response.json()) as { dishes?: unknown; items?: unknown; error?: string };

  if (!response.ok) {
    throw new ShoppingListApiError(data.error ?? "No se pudo generar la lista de la compra.");
  }

  const items = isGeneratedShoppingListResponse(data) ? data.items : [];
  return { dishes: isGeneratedShoppingBreakdown(data) ? data.dishes : null, items };
}
