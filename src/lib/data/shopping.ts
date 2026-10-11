// Shopping list of one calendar week (B6, roadmap steps 12 and 14, audit H7).
// - The list belongs to its calendar week; the account's current list is read first.
// - A list is reused while the week's canonical signature is the same (no AI call on reload,
//   navigation or applying the same menu again); it is generated only when the account confirms
//   there is none for this content, and one generation per week content runs at a time.
// - Marking an item writes only that item (set, never toggle), one write at a time per week.
// - A list generated or marked while the account could not be reached stays on the device and is
//   saved on the next load, without calling the AI again.
import type { WeekDay } from "@/data/mockWeek";
import {
  readCachedWeekVersion,
  readShoppingCache,
  shoppingRemote,
  writeShoppingCache,
  type DataIdentity,
  type RemoteShoppingState,
  type ShoppingCache,
} from "@/lib/data/repositories";
import { getIsoWeekStorageId, type IsoWeek } from "@/lib/isoWeek";
import {
  getShoppingItemId,
  groupShoppingListItems,
  type GeneratedShoppingListItem,
  type ShoppingListItem,
} from "@/lib/shoppingList";
import {
  generateShoppingListForWeek,
  getShoppingSignature,
  matchesShoppingSignature,
  type ShoppingFoodContext,
} from "@/lib/shoppingListStorage";
import type { ShoppingList } from "@/lib/supabase/shopping-lists";

export type ShoppingView = {
  items: ShoppingListItem[];
  checkedItemIds: string[];
  // remote: the account list · cache: this device's copy (account unreachable) · local: guest.
  source: "remote" | "cache" | "local";
  offline: boolean;
  // Something on this device (the list or some marks) is not saved in the account yet.
  pending: boolean;
  // Marks made on this device were dropped: the account replaced that list meanwhile.
  discardedLocalChanges: boolean;
};

export type ShoppingLoad =
  | { status: "ready"; view: ShoppingView }
  // No list for this week's content. offline: the account could not be checked, so generating
  // now could duplicate a list that already exists.
  | { status: "missing"; offline: boolean }
  // The account has no such week: there is nothing to shop for.
  | { status: "no_week" };

// Frozen food is shown under «otros» (six visible categories).
function visibleItems(items: GeneratedShoppingListItem[]): ShoppingListItem[] {
  return groupShoppingListItems(
    items.map(({ name, quantity, unit, category }) => ({
      name,
      quantity,
      unit,
      category: category === "congelados" ? "otros" : category,
    })),
  ).flatMap((group) => group.items);
}

function listToCache(list: ShoppingList, signature: string): ShoppingCache {
  const items = visibleItems(list.items);
  const itemIds: Record<string, string[]> = {};
  const checked = new Set<string>();

  for (const row of list.items) {
    if (!row.id) continue;
    const id = getShoppingItemId({ ...row, category: row.category === "congelados" ? "otros" : row.category });
    (itemIds[id] ??= []).push(row.id);
    if (row.checked) checked.add(id);
  }

  return {
    weekSignature: signature,
    items,
    checkedItemIds: items.filter((item) => checked.has(item.id)).map((item) => item.id),
    listId: list.id,
    itemIds,
    pendingChecks: {},
  };
}

function cacheToView(
  cache: ShoppingCache,
  source: ShoppingView["source"],
  offline: boolean,
  discardedLocalChanges = false,
): ShoppingView {
  const items = visibleItems(cache.items);
  const ids = new Set(items.map((item) => item.id));
  const signedIn = source !== "local";

  return {
    items,
    checkedItemIds: cache.checkedItemIds.filter((id) => ids.has(id)),
    source,
    offline,
    pending: signedIn && (!cache.listId || Object.keys(cache.pendingChecks ?? {}).length > 0),
    discardedLocalChanges,
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

// Saves a list that the account does not have yet, checked against the week version it was made
// for. If the week changed meanwhile but its content did not (same signature), it is saved on the
// new version; if the content changed, the list is not saved (it is for other dishes).
async function storeList(
  identity: DataIdentity,
  isoWeek: IsoWeek,
  signature: string,
  items: GeneratedShoppingListItem[],
  weekVersion: number | null,
  checkedItemIds: string[] = [],
): Promise<ShoppingLoad> {
  const remote = shoppingRemote(identity, isoWeek);
  const deviceCopy: ShoppingCache = { weekSignature: signature, items, checkedItemIds, listId: null };
  writeShoppingCache(identity, isoWeek, deviceCopy);
  if (!remote) return { status: "ready", view: cacheToView(deviceCopy, "local", false) };

  let expectedWeekVersion = weekVersion;
  for (let attempt = 0; attempt < 2; attempt++) {
    let result;
    try {
      result = await remote.save({ signature, items, expectedWeekVersion });
    } catch {
      return { status: "ready", view: cacheToView(deviceCopy, "cache", false) };
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
    return { status: "ready", view: cacheToView(cache, "remote", false) };
  }

  return { status: "missing", offline: false };
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
      ? { status: "ready", view: cacheToView(cache!, "local", false) }
      : { status: "missing", offline: false };
  }

  let state: RemoteShoppingState;
  try {
    state = await remote.fetch();
  } catch {
    return deviceListMatches(weekDays)
      ? { status: "ready", view: cacheToView(cache!, "cache", true) }
      : { status: "missing", offline: true };
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
    return { status: "ready", view: cacheToView(next, "remote", false, discarded) };
  }

  // This device has the list for this content but the account does not (generated while offline,
  // or replaced elsewhere and then changed back): save it, without calling the AI.
  if (deviceListMatches(state.week.days, context)) {
    return storeList(identity, isoWeek, signature, cache!.items, state.week.version, cache!.checkedItemIds);
  }

  return { status: "missing", offline: false };
}

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
    // The server reads the week's servings and restrictions itself (never sent from here).
    const generated = await generateShoppingListForWeek(weekDays, undefined, identity.userId ? isoWeek : undefined);
    return storeList(identity, isoWeek, signature, visibleItems(generated.items), readCachedWeekVersion(identity, isoWeek));
  })().finally(() => generations.delete(key));

  generations.set(key, generation);
  return generation;
}

// The week's frozen context as the account has it now (null: guest, none, or unreachable).
async function accountWeekContext(identity: DataIdentity, isoWeek: IsoWeek): Promise<ShoppingFoodContext | null> {
  const state = await shoppingRemote(identity, isoWeek)?.fetch().catch(() => null);
  return state?.week ? weekContext(state.week) : null;
}

// The week's list, generated only if the account confirms there is none for its content
// («Usar este menú» with the same dishes keeps the list and its marks).
export async function ensureShoppingList(identity: DataIdentity, isoWeek: IsoWeek, weekDays: WeekDay[]) {
  const loaded = await loadShoppingList(identity, isoWeek, weekDays);
  return loaded.status === "missing" && !loaded.offline ? generateShoppingList(identity, isoWeek, weekDays) : loaded;
}

export type CheckResult =
  | { status: "local" | "synced" | "pending" }
  // The list was replaced in the account (another device regenerated it): nothing was written.
  | { status: "stale" };

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
