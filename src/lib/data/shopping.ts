// Shopping list of one calendar week (B6, roadmap steps 12 and 14, audit H7; C4, steps 19 and 20).
// - The list belongs to its calendar week; the account's current list is read first.
// - A list is reused while the week's canonical signature is the same (no AI call on reload,
//   navigation or applying the same menu again).
// - C4: the items come from the dish cards where there are any (scaled to the week's servings, no
//   AI); only dishes without a card go to the AI, in one call broken down per dish. When the dishes
//   change, the current list is updated in place (reconcile_shopping_list): what is already known
//   is reused, bought items are never lost, and only new dishes without a card cost an AI call.
// - Marking an item writes only that item (set, never toggle), one write at a time per week.
// - A list generated or marked while the account could not be reached stays on the device and is
//   saved on the next load, without calling the AI again.
import type { WeekDay } from "@/data/mockWeek";
import {
  loadRecipeCards,
  readCachedWeekVersion,
  readShoppingCache,
  shoppingRemote,
  writeShoppingCache,
  type CachedShoppingItem,
  type DataIdentity,
  type RemoteShoppingState,
  type ShoppingCache,
} from "@/lib/data/repositories";
import { getDayPosition, getIsoWeekStorageId, type IsoWeek } from "@/lib/isoWeek";
import {
  aiItemsFromList,
  buildDesiredList,
  pendingDishesOf,
  plannedDishes,
  slotKey,
  type DesiredItem,
  type DishIngredient,
  type PlannedDish,
} from "@/lib/shopping/build";
import { diffShoppingList, type ExistingShoppingRow, type ReconcileSummary } from "@/lib/shopping/reconcile";
import {
  getShoppingItemId,
  supermarketCategoryLabels,
  type GeneratedShoppingListItem,
  type ShoppingViewItem,
} from "@/lib/shoppingList";
import {
  generateShoppingBreakdownForWeek,
  getShoppingSignature,
  matchesShoppingSignature,
  shoppingSignatureContext,
  ShoppingListApiError,
  type ShoppingFoodContext,
} from "@/lib/shoppingListStorage";
import type { ShoppingList } from "@/lib/supabase/shopping-lists";

// A planned dish whose ingredients are not in the list yet (C4).
export type PendingDish = Pick<PlannedDish, "day" | "meal" | "title">;

export type ShoppingView = {
  items: ShoppingViewItem[];
  checkedItemIds: string[];
  // remote: the account list · cache: this device's copy (account unreachable) · local: guest.
  source: "remote" | "cache" | "local";
  offline: boolean;
  // Something on this device (the list or some marks) is not saved in the account yet.
  pending: boolean;
  // Marks made on this device were dropped: the account replaced that list meanwhile.
  discardedLocalChanges: boolean;
  // C4. pendingDishes: dishes whose ingredients are missing (an AI call failed or had no quota).
  // fromCards: some items come from dish cards (their optional ingredients are not included).
  // change: what the update that just ran changed. aiError: why pending dishes were not computed.
  pendingDishes: PendingDish[];
  fromCards: boolean;
  change: ReconcileSummary | null;
  aiError: string | null;
  // The list is still the one of an earlier menu: it could not be updated now (aiError says why).
  notUpdated: boolean;
};

export type ShoppingLoad =
  | { status: "ready"; view: ShoppingView }
  // No list for this week's content. offline: the account could not be checked, so generating
  // now could duplicate a list that already exists.
  | { status: "missing"; offline: boolean }
  // C4: the week has a list, made for other dishes (or servings, restrictions, cards): it is
  // updated in place by reconcileShoppingList.
  | { status: "outdated" }
  // The account has no such week: there is nothing to shop for.
  | { status: "no_week" };

const categoryOrder = (category: string) => supermarketCategoryLabels.indexOf(category as (typeof supermarketCategoryLabels)[number]);

// One line per ingredient, unit and visible category (frozen food is shown under «otros»).
function visibleItems(items: CachedShoppingItem[]): ShoppingViewItem[] {
  const lines = new Map<string, ShoppingViewItem>();
  for (const item of items) {
    const name = item.name.trim().replace(/\s+/g, " ");
    const unit = item.unit.trim().replace(/\s+/g, " ");
    if (!name || !unit) continue;
    if (item.quantity !== null && (typeof item.quantity !== "number" || !Number.isFinite(item.quantity) || item.quantity <= 0)) continue;
    const category = item.category === "congelados" ? "otros" : item.category;
    const id = getShoppingItemId({ name, unit, category });
    const line = lines.get(id);
    if (line) {
      line.quantity = line.quantity === null ? item.quantity : item.quantity === null ? line.quantity : line.quantity + item.quantity;
      line.origins = [...line.origins, ...(item.origins ?? [])];
      line.needsReview ||= Boolean(item.needsReview);
      line.removed &&= Boolean(item.removed);
      continue;
    }
    lines.set(id, {
      id,
      name,
      quantity: item.quantity,
      unit,
      category,
      origins: item.origins ?? [],
      needsReview: Boolean(item.needsReview),
      removed: Boolean(item.removed),
    });
  }
  return [...lines.values()].sort(
    (first, second) => categoryOrder(first.category) - categoryOrder(second.category) || first.name.localeCompare(second.name, "es"),
  );
}

// A row no longer needed that was unmarked afterwards is neither needed nor bought: not shown.
const shownRows = (list: ShoppingList) => list.items.filter((row) => !row.removedAt || row.checked);

function listToCache(list: ShoppingList, signature: string): ShoppingCache {
  const rows = shownRows(list);
  const itemIds: Record<string, string[]> = {};
  const checked = new Set<string>();

  for (const row of rows) {
    if (!row.id) continue;
    const id = getShoppingItemId({ ...row, category: row.category === "congelados" ? "otros" : row.category });
    (itemIds[id] ??= []).push(row.id);
    if (row.checked) checked.add(id);
  }

  return {
    weekSignature: signature,
    items: rows.map((row) => ({
      name: row.name,
      quantity: row.quantity,
      unit: row.unit,
      category: row.category,
      itemKey: row.itemKey ?? null,
      origins: row.origins ?? null,
      needsReview: Boolean(row.needsReview && row.checked),
      removed: Boolean(row.removedAt),
    })),
    checkedItemIds: [...checked],
    listId: list.id,
    itemIds,
    pendingChecks: {},
    ingredientBasis: list.ingredientBasis ?? null,
  };
}

type ViewExtras = { change?: ReconcileSummary | null; aiError?: string | null; notUpdated?: boolean };

function cacheToView(
  cache: ShoppingCache,
  source: ShoppingView["source"],
  offline: boolean,
  days: WeekDay[],
  discardedLocalChanges = false,
  extras: ViewExtras = {},
): ShoppingView {
  const items = visibleItems(cache.items);
  const ids = new Set(items.map((item) => item.id));
  const signedIn = source !== "local";
  const withOrigins = cache.ingredientBasis === "mixed-v1";

  return {
    items,
    checkedItemIds: cache.checkedItemIds.filter((id) => ids.has(id)),
    source,
    offline,
    pending: signedIn && (!cache.listId || Object.keys(cache.pendingChecks ?? {}).length > 0),
    discardedLocalChanges,
    pendingDishes: withOrigins
      ? pendingDishesOf(cache.items.filter((item) => !item.removed), plannedDishes(days)).map(({ day, meal, title }) => ({ day, meal, title }))
      : [],
    fromCards: cache.items.some((item) => !item.removed && item.origins?.some((origin) => origin.kind !== "ai_title")),
    change: extras.change ?? null,
    aiError: extras.aiError ?? null,
    notUpdated: extras.notUpdated ?? false,
  };
}

// Lists created before B6 have no signature: they belong to the week's content if they were
// generated after its last change (the rule used until now).
function isCurrentList(list: ShoppingList, week: NonNullable<RemoteShoppingState["week"]>, signature: string) {
  if (list.weekSignature) return list.weekSignature === signature;
  return list.items.length > 0 && (!week.updatedAt || list.generatedAt >= week.updatedAt);
}

// Marks of one week are written one at a time and in order, so the last one always wins.
const checkQueues = new Map<string, Promise<unknown>>();

function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const next = (checkQueues.get(key) ?? Promise.resolve()).then(task, task);
  checkQueues.set(key, next);
  return next;
}

const queueKey = (identity: DataIdentity, isoWeek: IsoWeek) => `${identity.scope}|${getIsoWeekStorageId(isoWeek)}`;

// C1: the week's frozen food context is part of its list's signature. Weeks without one (applied
// before C1, guests, test doubles) keep the legacy signature, so their lists stay valid.
const weekContext = (week: NonNullable<RemoteShoppingState["week"]>) => week.foodContext ?? null;

// Resends this device's pending marks of `cache.listId`; returns the cache as the account has it.
async function pushPendingChecks(
  identity: DataIdentity,
  isoWeek: IsoWeek,
  cache: ShoppingCache,
  pending: Record<string, boolean>,
) {
  const remote = shoppingRemote(identity, isoWeek);
  const checked = new Set(cache.checkedItemIds);
  const remaining: Record<string, boolean> = {};
  let discarded = false;

  for (const [itemId, value] of Object.entries(pending)) {
    const rows = cache.itemIds?.[itemId];
    if (!remote || !rows?.length) {
      discarded = true;
      continue;
    }
    try {
      const result = await enqueue(queueKey(identity, isoWeek), () => remote.setChecked(rows, value));
      if (result.status !== "applied") {
        discarded = true;
        continue;
      }
      if (value) checked.add(itemId);
      else checked.delete(itemId);
    } catch {
      remaining[itemId] = value;
      if (value) checked.add(itemId);
      else checked.delete(itemId);
    }
  }

  return { cache: { ...cache, checkedItemIds: [...checked], pendingChecks: remaining }, discarded };
}

const basisOf = (items: CachedShoppingItem[]) => (items.length > 0 && items.every((item) => item.itemKey) ? "mixed-v1" : null);

// Saves a list that the account does not have yet, checked against the week version it was made
// for. If the week changed meanwhile but its content did not (same signature), it is saved on the
// new version; if the content changed, the list is not saved (it is for other dishes).
async function storeList(
  identity: DataIdentity,
  isoWeek: IsoWeek,
  signature: string,
  items: CachedShoppingItem[],
  weekVersion: number | null,
  days: WeekDay[],
  checkedItemIds: string[] = [],
  extras: ViewExtras = {},
): Promise<ShoppingLoad> {
  const remote = shoppingRemote(identity, isoWeek);
  const toSave = items.filter((item) => !item.removed).map(({ name, quantity, unit, category, itemKey, origins }) => ({
    name,
    quantity,
    unit,
    category,
    ...(itemKey ? { itemKey, origins: origins ?? [] } : {}),
  }));
  const deviceCopy: ShoppingCache = { weekSignature: signature, items: toSave, checkedItemIds, listId: null, ingredientBasis: basisOf(toSave) };
  writeShoppingCache(identity, isoWeek, deviceCopy);
  if (!remote) return { status: "ready", view: cacheToView(deviceCopy, "local", false, days, false, extras) };

  let expectedWeekVersion = weekVersion;
  for (let attempt = 0; attempt < 2; attempt++) {
    let result;
    try {
      result = await remote.save({ signature, items: toSave, expectedWeekVersion });
    } catch {
      return { status: "ready", view: cacheToView(deviceCopy, "cache", false, days, false, extras) };
    }

    if (result.status === "no_week") return { status: "no_week" };

    if (result.status === "week_changed") {
      const current = await remote.fetch().catch(() => null);
      if (!current?.week) return { status: "missing", offline: !current };
      if (getShoppingSignature(isoWeek, current.week.days, weekContext(current.week)) !== signature) return { status: "missing", offline: false };
      expectedWeekVersion = current.week.version;
      continue;
    }

    // created, or existing: this content already had a list (another device, a second tab).
    let cache = listToCache(result.list, signature);
    if (result.status === "created" && checkedItemIds.length) {
      const pending = Object.fromEntries(checkedItemIds.map((id) => [id, true]));
      cache = (await pushPendingChecks(identity, isoWeek, cache, pending)).cache;
    }
    writeShoppingCache(identity, isoWeek, cache);
    return { status: "ready", view: cacheToView(cache, "remote", false, days, false, extras) };
  }

  return { status: "missing", offline: false };
}

// The account could not be reached: this device's copy if it is for these dishes; otherwise
// nothing (generating now could duplicate a list that already exists).
function offlineLoad(identity: DataIdentity, isoWeek: IsoWeek, weekDays: WeekDay[]): ShoppingLoad {
  const cache = readShoppingCache(identity, isoWeek);
  return cache?.items.length && matchesShoppingSignature(cache.weekSignature, isoWeek, weekDays)
    ? { status: "ready", view: cacheToView(cache, "cache", true, weekDays) }
    : { status: "missing", offline: true };
}

export async function loadShoppingList(
  identity: DataIdentity,
  isoWeek: IsoWeek,
  weekDays: WeekDay[],
): Promise<ShoppingLoad> {
  const cache = readShoppingCache(identity, isoWeek);
  const remote = shoppingRemote(identity, isoWeek);
  // context undefined: the account did not answer, only the week and its dishes can be compared.
  const deviceListMatches = (days: WeekDay[], context?: ShoppingFoodContext | null) =>
    Boolean(cache?.items.length && matchesShoppingSignature(cache.weekSignature, isoWeek, days, context));

  if (!remote) {
    return deviceListMatches(weekDays, null)
      ? { status: "ready", view: cacheToView(cache!, "local", false, weekDays) }
      : { status: "missing", offline: false };
  }

  let state: RemoteShoppingState;
  try {
    state = await remote.fetch();
  } catch {
    return offlineLoad(identity, isoWeek, weekDays);
  }

  if (!state.week) return { status: "no_week" };

  // The account week decides which list applies, not this device's copy of it.
  const context = weekContext(state.week);
  const signature = getShoppingSignature(isoWeek, state.week.days, context);

  if (state.list && isCurrentList(state.list, state.week, signature)) {
    let next = listToCache(state.list, signature);
    const devicePending = Object.keys(cache?.pendingChecks ?? {}).length > 0;
    let discarded = devicePending && cache?.listId !== state.list.id;
    if (devicePending && !discarded) {
      const pushed = await pushPendingChecks(identity, isoWeek, next, cache!.pendingChecks!);
      next = pushed.cache;
      discarded = pushed.discarded;
    }
    writeShoppingCache(identity, isoWeek, next);
    return { status: "ready", view: cacheToView(next, "remote", false, state.week.days, discarded) };
  }

  // This device has the list for this content but the account does not (generated while offline,
  // or replaced elsewhere and then changed back): save it, without calling the AI.
  if (deviceListMatches(state.week.days, context)) {
    return storeList(identity, isoWeek, signature, cache!.items, state.week.version, state.week.days, cache!.checkedItemIds);
  }

  // C4: the week's list was made for other dishes: it is updated in place, never replaced.
  if (state.list) return { status: "outdated" };

  return { status: "missing", offline: false };
}

// --- What the dishes need (C4) ----------------------------------------------------------------

// The week sent to the AI: only these dishes, every other meal as «LIBRE».
function weekForDishes(days: WeekDay[], dishes: PlannedDish[]): WeekDay[] {
  const wanted = new Set(dishes.map((dish) => slotKey(dish.day, dish.meal)));
  return days
    .filter((day) => wanted.has(slotKey(getDayPosition(day.day), "lunch")) || wanted.has(slotKey(getDayPosition(day.day), "dinner")))
    .map((day) => {
      const position = getDayPosition(day.day);
      return {
        day: day.day,
        date: day.date,
        lunch: wanted.has(slotKey(position, "lunch")) ? day.lunch : "LIBRE",
        dinner: wanted.has(slotKey(position, "dinner")) ? day.dinner : "LIBRE",
      };
    });
}

function aiErrorMessage(error: unknown) {
  return error instanceof ShoppingListApiError ? error.message : "No se pudieron calcular los ingredientes con IA.";
}

type ComputedList = {
  items: DesiredItem[];
  pending: PlannedDish[];
  aiError: unknown;
  // The server answered without a breakdown per dish (before C4): its whole-week items.
  legacyItems: GeneratedShoppingListItem[] | null;
};

// AI answers of one update, kept across its retries: a list or week that moved meanwhile never
// pays the same dishes twice, and a failed call is not repeated within the same update.
type AiMemo = { items: Map<string, DishIngredient[]>; asked: Set<string>; error: unknown; legacyItems: GeneratedShoppingListItem[] | null };
const newAiMemo = (): AiMemo => ({ items: new Map(), asked: new Set(), error: null, legacyItems: null });

type ComputeOptions = { memo?: AiMemo; contextKey?: string; askAi?: boolean };

// Cards first (no AI), then the list's own AI ingredients (reuse), then one AI call for the rest.
// askAi false: no call (this update already failed in this session); those dishes stay pending.
async function computeList(
  identity: DataIdentity,
  isoWeek: IsoWeek,
  days: WeekDay[],
  servings: number,
  reuse: ShoppingList["items"] | null,
  { memo = newAiMemo(), contextKey = "", askAi = true }: ComputeOptions = {},
): Promise<ComputedList> {
  const dishes = plannedDishes(days);
  const cards = await loadRecipeCards(dishes.flatMap((dish) => (dish.versionId ? [dish.versionId] : [])));
  const aiItems = reuse ? aiItemsFromList(reuse, dishes) : new Map<string, DishIngredient[]>();
  const memoKey = (dish: PlannedDish) => `${contextKey}|${slotKey(dish.day, dish.meal)}|${dish.dish}`;
  const missing = dishes.filter((dish) => !(dish.versionId && cards.has(dish.versionId)) && !aiItems.has(slotKey(dish.day, dish.meal)));
  for (const dish of missing) {
    const known = memo.items.get(memoKey(dish));
    if (known) aiItems.set(slotKey(dish.day, dish.meal), known);
  }
  const toAsk = missing.filter((dish) => !memo.items.has(memoKey(dish)) && !memo.asked.has(memoKey(dish)));

  if (toAsk.length && askAi) {
    for (const dish of toAsk) memo.asked.add(memoKey(dish));
    try {
      // The server reads the week's servings and restrictions itself (never sent from here).
      const answer = await generateShoppingBreakdownForWeek(weekForDishes(days, toAsk), identity.userId ? isoWeek : undefined);
      if (answer.dishes === null) {
        memo.legacyItems = answer.items;
      } else {
        for (const dish of answer.dishes) {
          const target = toAsk.find((candidate) => candidate.day === getDayPosition(dish.day) && candidate.meal === dish.meal);
          if (!target) continue;
          const items = [...(memo.items.get(memoKey(target)) ?? []), ...dish.items];
          memo.items.set(memoKey(target), items);
          aiItems.set(slotKey(target.day, target.meal), items);
        }
      }
    } catch (error) {
      memo.error = error;
    }
  }

  const built = buildDesiredList({ dishes, servings, cards, aiItems });
  return { items: built.items, pending: built.pending, aiError: built.pending.length ? memo.error : null, legacyItems: memo.legacyItems };
}

const nothingKnown = (computed: ComputedList) =>
  computed.aiError ?? new ShoppingListApiError("No se pudo generar la lista de la compra.");

// One generation per identity and week content at a time: a second caller (the page mounted
// again after navigating, «Usar este menú» followed by Compra) waits for the same request
// instead of paying for another one. It is never aborted by leaving the page.
const generations = new Map<string, Promise<ShoppingLoad>>();

export async function generateShoppingList(
  identity: DataIdentity,
  isoWeek: IsoWeek,
  weekDays: WeekDay[],
): Promise<ShoppingLoad> {
  const context = await accountWeekContext(identity, isoWeek);
  const signature = getShoppingSignature(isoWeek, weekDays, context);
  const key = `${identity.scope}|${signature}`;
  const running = generations.get(key);
  if (running) return running;

  const generation = (async () => {
    const computed = await computeList(identity, isoWeek, weekDays, context?.servings ?? 2, null);
    const weekVersion = readCachedWeekVersion(identity, isoWeek);
    if (computed.legacyItems && computed.items.length === 0) {
      return storeList(identity, isoWeek, signature, computed.legacyItems, weekVersion, weekDays);
    }
    // Nothing known (no card, the AI failed): nothing to save; the page shows why.
    if (computed.items.length === 0) throw nothingKnown(computed);
    return storeList(identity, isoWeek, signature, computed.items, weekVersion, weekDays, [], {
      aiError: computed.aiError ? aiErrorMessage(computed.aiError) : null,
    });
  })().finally(() => generations.delete(key));

  generations.set(key, generation);
  return generation;
}

// The week's frozen context as the account has it now (null: guest, none, or unreachable).
async function accountWeekContext(identity: DataIdentity, isoWeek: IsoWeek): Promise<ShoppingFoodContext | null> {
  const state = await shoppingRemote(identity, isoWeek)?.fetch().catch(() => null);
  return state?.week ? weekContext(state.week) : null;
}

const toExistingRows = (list: ShoppingList): ExistingShoppingRow[] =>
  list.items.flatMap((row) =>
    row.id
      ? [{
          id: row.id,
          name: row.name,
          quantity: row.quantity,
          unit: row.unit,
          category: row.category,
          checked: row.checked,
          itemKey: row.itemKey ?? null,
          origins: row.origins ?? null,
          removedAt: row.removedAt ?? null,
        }]
      : [],
  );

// The AI ingredients a list has are valid for the week while servings and restrictions are the same.
function sameFoodContext(first: string | null, second: string) {
  const one = shoppingSignatureContext(first);
  const two = shoppingSignatureContext(second);
  return Boolean(one && two && one.servings === two.servings && one.restrictions === two.restrictions);
}

// One update per identity and week at a time (the page and «Usar este menú» share it).
const reconciliations = new Map<string, Promise<ShoppingLoad>>();
// Updates whose AI call failed (or had no quota) in this session, by identity and week content:
// opening Compra again does not pay for the same failure; the user asks again with the button.
const failedUpdates = new Map<string, string>();

// Forgets those failures (another identity, or a fresh start in tests).
export function forgetShoppingUpdateFailures() {
  failedUpdates.clear();
}

const pendingKey = (dish: Pick<PlannedDish, "day" | "meal" | "dish">) => `${slotKey(dish.day, dish.meal)}|${dish.dish}`;

// Brings the week's current list up to date in place (C4): only what changed is added, removed or
// changed; bought items stay (as «Comprado, ya no hace falta» or «Revisar» when they are no longer
// enough). userAsked («Calcular (IA)», «Actualizar lista»): also when the list is current (dishes
// still pending), and the AI is asked again even if it failed before. Lists of guests are never in
// the account: they are read as before. Never answers «outdated»: when the list cannot be updated
// now it is shown as it is, with notUpdated and the reason.
export async function reconcileShoppingList(
  identity: DataIdentity,
  isoWeek: IsoWeek,
  weekDays: WeekDay[],
  { retryPending: userAsked = false }: { retryPending?: boolean } = {},
): Promise<ShoppingLoad> {
  const remote = shoppingRemote(identity, isoWeek);
  if (!remote) return loadShoppingList(identity, isoWeek, weekDays);
  const key = `${queueKey(identity, isoWeek)}|${userAsked ? "asked" : "update"}`;
  const running = reconciliations.get(key);
  if (running) return running;

  const task = (async (): Promise<ShoppingLoad> => {
    const memo = newAiMemo();
    let pushedMarks = false;
    let lastSeen: { list: ShoppingList; days: WeekDay[] } | null = null;
    // The list as the account has it, signed with its own signature (never with the new one: this
    // device must not take it for the list of the new dishes).
    const asItIs = (list: ShoppingList, days: WeekDay[], aiError: string | null): ShoppingLoad => {
      const next = listToCache(list, list.weekSignature ?? "");
      writeShoppingCache(identity, isoWeek, next);
      return { status: "ready", view: cacheToView(next, "remote", false, days, false, { aiError, notUpdated: true }) };
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      let state: RemoteShoppingState;
      try {
        state = await remote.fetch();
      } catch {
        return offlineLoad(identity, isoWeek, weekDays);
      }
      if (!state.week) return { status: "no_week" };
      const days = state.week.days;
      const context = weekContext(state.week);
      const signature = getShoppingSignature(isoWeek, days, context);
      const list = state.list;
      if (!list) return generateShoppingList(identity, isoWeek, days);
      lastSeen = { list, days };

      // Marks this device made offline on this same list are sent first: they decide what is bought.
      const cache = readShoppingCache(identity, isoWeek);
      if (!pushedMarks && cache?.listId === list.id && Object.keys(cache.pendingChecks ?? {}).length > 0) {
        pushedMarks = true;
        const pushed = await pushPendingChecks(identity, isoWeek, listToCache(list, cache.weekSignature), cache.pendingChecks!);
        writeShoppingCache(identity, isoWeek, { ...pushed.cache, weekSignature: cache.weekSignature });
        attempt--;
        continue;
      }

      const current = isCurrentList(list, state.week, signature);
      const withOrigins = list.ingredientBasis === "mixed-v1";
      const activeRows = list.items.filter((row) => !row.removedAt);
      const shown = (extras: ViewExtras = {}): ShoppingLoad => {
        const next = listToCache(list, signature);
        writeShoppingCache(identity, isoWeek, next);
        return { status: "ready", view: cacheToView(next, "remote", false, days, false, extras) };
      };
      if (current && (!userAsked || !withOrigins || pendingDishesOf(activeRows, plannedDishes(days)).length === 0)) {
        return shown();
      }

      const failureKey = `${identity.scope}|${signature}`;
      if (userAsked) failedUpdates.delete(failureKey);
      const knownFailure = failedUpdates.get(failureKey) ?? null;
      const reuse = withOrigins && sameFoodContext(list.weekSignature, signature) ? activeRows : null;
      const computed = await computeList(identity, isoWeek, days, context?.servings ?? 2, reuse, {
        memo,
        contextKey: `${context?.servings ?? 2}|${context?.version ?? ""}`,
        askAi: knownFailure === null,
      });
      const failed = computed.pending.length > 0 && (computed.aiError !== null || knownFailure !== null);
      const aiError = failed ? knownFailure ?? aiErrorMessage(computed.aiError) : null;
      if (failed) failedUpdates.set(failureKey, aiError!);
      else failedUpdates.delete(failureKey);

      // The server could not break the list down (before C4) or the database cannot update a list
      // in place: a new list, as before C4.
      if (computed.legacyItems || !remote.reconcile) {
        const items = computed.legacyItems && computed.items.length === 0 ? computed.legacyItems : computed.items;
        if (items.length === 0) throw nothingKnown(computed);
        return storeList(identity, isoWeek, signature, items, state.week.version, days, [], { aiError });
      }
      if (failed) {
        // «Calcular (IA)» failed again: the current list stays as it is.
        if (current) return shown({ aiError });
        // Without origins (list before C4), or with origins for other servings or restrictions,
        // nothing of the list can be kept apart from the dishes that failed: it is left as it is.
        if (!reuse) return asItIs(list, days, aiError);
      }

      const ops = diffShoppingList(toExistingRows(list), computed.items);
      if (failed) {
        // Never remove what a pending dish may still need.
        const pending = new Set(computed.pending.map(pendingKey));
        const needed = new Set(list.items.filter((row) => row.origins?.some((origin) => pending.has(pendingKey(origin)))).map((row) => row.id));
        ops.remove = ops.remove.filter((op) => !needed.has(op.id));
      }

      const result = await remote.reconcile({
        listId: list.id,
        fromSignature: list.weekSignature,
        toSignature: signature,
        ops,
        expectedWeekVersion: state.week.version,
      });

      if (result.status === "no_week") return { status: "no_week" };
      if (result.status === "stale" || result.status === "week_changed") continue;
      if (result.status === "unavailable") {
        if (computed.items.length === 0) throw nothingKnown(computed);
        return storeList(identity, isoWeek, signature, computed.items, state.week.version, days, [], { aiError });
      }

      const next = listToCache(result.list, signature);
      writeShoppingCache(identity, isoWeek, next);
      return {
        status: "ready",
        view: cacheToView(next, "remote", false, days, false, {
          change: result.status === "applied" ? result.summary : null,
          aiError,
        }),
      };
    }
    // The list or the week kept changing while it was being updated: shown as it is now.
    return lastSeen
      ? asItIs(lastSeen.list, lastSeen.days, "La lista ha cambiado mientras se actualizaba. Inténtalo de nuevo.")
      : offlineLoad(identity, isoWeek, weekDays);
  })().finally(() => reconciliations.delete(key));

  reconciliations.set(key, task);
  return task;
}

// The week's list, generated only if the account confirms there is none for its content, and
// updated in place if it was made for other dishes («Usar este menú» with the same dishes keeps
// the list and its marks).
export async function ensureShoppingList(identity: DataIdentity, isoWeek: IsoWeek, weekDays: WeekDay[]) {
  const loaded = await loadShoppingList(identity, isoWeek, weekDays);
  if (loaded.status === "outdated") return reconcileShoppingList(identity, isoWeek, weekDays);
  return loaded.status === "missing" && !loaded.offline ? generateShoppingList(identity, isoWeek, weekDays) : loaded;
}

export type CheckResult =
  | { status: "local" | "synced" | "pending" }
  // The list was replaced in the account (another device regenerated it), or the item is no
  // longer in it (updated elsewhere): nothing was written.
  | { status: "stale" };

const visibleIdOf = (item: CachedShoppingItem) =>
  getShoppingItemId({ ...item, category: item.category === "congelados" ? "otros" : item.category });

// Marks or unmarks one visible item. The device copy changes at once; in the account only that
// item's rows change, and only while this list is still the week's current list.
export async function setShoppingItemChecked(
  identity: DataIdentity,
  isoWeek: IsoWeek,
  itemId: string,
  checked: boolean,
): Promise<CheckResult> {
  const cache = readShoppingCache(identity, isoWeek);
  if (!cache) return { status: "local" };

  const ids = new Set(cache.checkedItemIds);
  if (checked) ids.add(itemId);
  else ids.delete(itemId);
  const remote = shoppingRemote(identity, isoWeek);
  writeShoppingCache(identity, isoWeek, {
    ...cache,
    // A new mark settles a review (the database does the same).
    items: cache.items.map((item) => (item.needsReview && visibleIdOf(item) === itemId ? { ...item, needsReview: false } : item)),
    checkedItemIds: [...ids],
    ...(remote ? { pendingChecks: { ...cache.pendingChecks, [itemId]: checked } } : {}),
  });
  if (!remote) return { status: "local" };

  const rows = cache.itemIds?.[itemId];
  if (!cache.listId || !rows?.length) return { status: "pending" };

  const settle = (keep: boolean) => {
    const current = readShoppingCache(identity, isoWeek);
    if (!current || current.listId !== cache.listId) return;
    const pendingChecks = { ...current.pendingChecks };
    // A newer mark of the same item is still on its way: leave it pending.
    if (!keep && pendingChecks[itemId] === checked) delete pendingChecks[itemId];
    writeShoppingCache(identity, isoWeek, { ...current, pendingChecks });
  };

  try {
    const result = await enqueue(queueKey(identity, isoWeek), () => remote.setChecked(rows, checked));
    settle(false);
    return result.status === "applied" ? { status: "synced" } : { status: "stale" };
  } catch {
    settle(true);
    return { status: "pending" };
  }
}
