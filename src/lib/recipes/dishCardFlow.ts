// What the dish card of one meal shows and does (C2). Used by DishCard; kept apart for tests.
import type { MealKey, WeekDay } from "@/data/mockWeek";
import { isAiLoginRequiredError, postAi } from "@/lib/ai-client";
import {
  loadCatalogRecipeIndex,
  loadRecipeCard,
  loadWeek,
  readCachedWeekVersion,
  saveWeekRecipe,
  type DataIdentity,
} from "@/lib/data/repositories";
import type { IsoWeek } from "@/lib/isoWeek";
import { getIsoWeekStorageId } from "@/lib/isoWeek";
import {
  findCatalogRecipeIdentity,
  parseRecipeCard,
  recipeTitleKey,
  sameDishTitle,
  type CatalogRecipeIdentity,
  type RecipeCard,
} from "@/lib/recipes/card";
import { mealRecipeLink, withMealRecipe } from "@/lib/weekStorage";

// card: the slot points to a card that could be read · title_only: no card for this meal (menus
// before C2, or a title edited later). catalog: the title is exactly a catalogue recipe; with a
// reviewed version it can be used without AI, otherwise the catalogue card is pending review.
export type DishCardView =
  | { kind: "card"; card: RecipeCard }
  | {
      kind: "title_only";
      catalog: (CatalogRecipeIdentity & { reviewedVersionId: string | null }) | null;
      // The link existed but the card could not be read (deleted, not readable): said, not hidden.
      unreadableLink: boolean;
    }
  | { kind: "error"; message: string };

export const dishCardMessages = {
  unreachable: "No hemos podido abrir la ficha. Revisa la conexión e inténtalo de nuevo.",
  weekChanged: "Tu semana ha cambiado en otro dispositivo. Hemos cargado la versión de tu cuenta.",
  cardNotLinked: "La ficha se ha guardado, pero tu semana cambió mientras tanto y no se ha enlazado. Vuelve a abrir la ficha.",
  pending: "Solo en este dispositivo: tu cuenta no ha confirmado el cambio. Se reintentará al recargar la semana.",
  invalid: "La ficha propuesta no ha superado las comprobaciones. Puedes intentarlo otra vez.",
  quota: "Has llegado al límite de fichas estimadas por hoy (cuentan junto a las listas de la compra). Inténtalo mañana.",
  failed: "No se ha podido preparar la ficha. Inténtalo de nuevo.",
  versionUnknown: "Aún no sabemos la versión de tu semana. Espera a que termine de cargar e inténtalo de nuevo.",
} as const;

export async function loadDishCardView(day: WeekDay, meal: MealKey): Promise<DishCardView> {
  const title = day[meal];
  const link = mealRecipeLink(day, meal);
  let unreadableLink = false;
  if (link) {
    try {
      const card = await loadRecipeCard(link.versionId);
      // A card is only shown for its own dish (a stale device copy never shows another one).
      if (card && sameDishTitle(card.title, title)) return { kind: "card", card };
      unreadableLink = card === null;
    } catch {
      return { kind: "error", message: dishCardMessages.unreachable };
    }
  }
  const identity = findCatalogRecipeIdentity(title);
  const reviewed = identity ? (await loadCatalogRecipeIndex()).get(recipeTitleKey(title)) ?? null : null;
  return {
    kind: "title_only",
    catalog: identity ? { ...identity, reviewedVersionId: reviewed?.versionId ?? null } : null,
    unreadableLink,
  };
}

export type DishCardAction =
  | { status: "linked"; days: WeekDay[] | null; card?: RecipeCard; message?: string }
  | { status: "conflict"; days: WeekDay[] | null; message: string }
  | { status: "pending"; days: WeekDay[]; message: string }
  | { status: "login_required" }
  | { status: "error"; message: string; retryable: boolean };

// «Usar receta del catálogo»: links the reviewed catalogue version, no AI.
export async function linkCatalogCard(
  identity: DataIdentity,
  isoWeek: IsoWeek,
  weekDays: WeekDay[],
  slot: { day: string; meal: MealKey },
  versionId: string,
): Promise<DishCardAction> {
  const result = await saveWeekRecipe(identity, isoWeek, weekDays, slot, { versionId });
  if (result.status === "conflict") return { status: "conflict", days: result.remoteData, message: dishCardMessages.weekChanged };
  if (result.status === "pending") return { status: "pending", days: weekDays, message: dishCardMessages.pending };
  return { status: "linked", days: withMealRecipe(weekDays, slot.day, slot.meal, { versionId }) };
}

// «Crear ficha estimada (IA)»: one dish, signed in only. The server estimates, saves and links;
// the week is then read again so this device has the link and the new version.
export async function requestEstimatedCard(
  identity: DataIdentity,
  isoWeek: IsoWeek,
  slot: { day: string; meal: MealKey },
  dish: string,
  requestKey: string,
  signal?: AbortSignal,
): Promise<DishCardAction> {
  if (!identity.userId) return { status: "login_required" };
  const expectedVersion = readCachedWeekVersion(identity, isoWeek);
  if (expectedVersion === null) return { status: "error", message: dishCardMessages.versionUnknown, retryable: true };

  let response: Response;
  try {
    response = await postAi(
      "/api/dish-card",
      { isoWeek: getIsoWeekStorageId(isoWeek), day: slot.day, meal: slot.meal, dish, expectedVersion, requestKey },
      signal,
    );
  } catch (error) {
    if (isAiLoginRequiredError(error)) return { status: "login_required" };
    return { status: "error", message: dishCardMessages.failed, retryable: true };
  }

  const data = (await response.json().catch(() => null)) as
    | { card?: unknown; link?: unknown; error?: unknown; reason?: unknown }
    | null;
  const reload = async () => (await loadWeek(identity, isoWeek)).data;

  if (response.status === 409) {
    return { status: "conflict", days: await reload(), message: dishCardMessages.weekChanged };
  }
  if (response.status === 422) return { status: "error", message: dishCardMessages.invalid, retryable: true };
  if (response.status === 429) return { status: "error", message: dishCardMessages.quota, retryable: false };
  if (!response.ok) {
    const message = typeof data?.error === "string" && response.status < 500 ? data.error : dishCardMessages.failed;
    return { status: "error", message, retryable: true };
  }

  const card = parseRecipeCard(data?.card);
  if (!card) return { status: "error", message: dishCardMessages.failed, retryable: true };
  const days = await reload();
  if (data?.link === "conflict") return { status: "linked", days, card, message: dishCardMessages.cardNotLinked };
  return { status: "linked", days, card };
}

// The card the dialog shows: one just estimated or linked (before the week is read again) only
// for exactly the same meal and dish, and only if the slot points to that version or to none yet;
// otherwise the card read for the slot. Never the card of another dish («Pollo» ≠ «Pollo al limón»).
export function cardToShow(
  shown: { key: string; card: RecipeCard } | null,
  slotKey: string,
  title: string,
  linkVersionId: string | null,
  viewCard: RecipeCard | null,
): RecipeCard | null {
  if (
    shown &&
    shown.key === slotKey &&
    sameDishTitle(shown.card.title, title) &&
    (linkVersionId === null || linkVersionId === shown.card.versionId)
  ) {
    return shown.card;
  }
  return viewCard;
}

export const dishCardSlotKey = (slot: { day: string; meal: MealKey }, title: string) => JSON.stringify([slot.day, slot.meal, title]);
