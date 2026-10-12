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
// - D5: the user can add items by hand (key «manual|…», id chosen here) and change quantities
//   (edit_shopping_items). Edits are kept on this device until the account accepts them and go in
//   the same queue as the marks (a mark of an item added offline waits for the item). A reconciliation
//   never touches manual items; a quantity adjusted on an item of the dishes is kept while those
//   dishes stay the same, and is dropped (and reported) when they change.
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
  type ShoppingEdit,
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
import { diffShoppingList, discardedAdjustments, type ExistingShoppingRow, type ReconcileSummary } from "@/lib/shopping/reconcile";
import { isManualKey, manualItemKey } from "@/lib/shopping/units";
import {
  dishOriginsOf,
  getShoppingItemId,
  isCardOrigin,
  supermarketCategoryLabels,
  type GeneratedShoppingListItem,
  type ShoppingViewItem,
  type SupermarketCategory,
} from "@/lib/shoppingList";
import {
  generateShoppingBreakdownForWeek,
  getShoppingSignature,
  matchesShoppingSignature,
  shoppingSignatureContext,
  ShoppingListApiError,
  type ShoppingFoodContext,
} from "@/lib/shoppingListStorage";
import type { ShoppingEditOps, ShoppingList } from "@/lib/supabase/shopping-lists";

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
  // D5: items whose adjusted quantity the last update dropped (their dishes changed). servings: the
  // week's frozen servings when the account told (null: unknown here).
  discardedAdjustments: string[];
  servings: number | null;
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

const visibleCategory = (category: SupermarketCategory) => (category === "congelados" ? "otros" : category);

// Visible line of an item: one per ingredient, unit and visible category (frozen food is shown under
// «otros»); an item added by hand is always its own line.
export function shoppingLineId(item: Pick<CachedShoppingItem, "name" | "unit" | "category" | "itemKey">) {
  if (isManualKey(item.itemKey)) return item.itemKey!.replace("|", "-");
  return getShoppingItemId({ name: item.name, unit: item.unit, category: visibleCategory(item.category) });
}

const isAdjustedItem = (item: Pick<CachedShoppingItem, "origins">) => Boolean(item.origins?.some((origin) => origin.kind === "user_adjust"));

// One line per ingredient, unit and visible category. editable: one item with an amount, and (signed
// in) its account row is known.
function visibleItems(items: CachedShoppingItem[], rowOf: (id: string, item: CachedShoppingItem) => string | null): ShoppingViewItem[] {
  const lines = new Map<string, ShoppingViewItem>();
  const counts = new Map<string, number>();
  for (const item of items) {
    const name = item.name.trim().replace(/\s+/g, " ");
    const unit = item.unit.trim().replace(/\s+/g, " ");
    if (!name || !unit) continue;
    if (item.quantity !== null && (typeof item.quantity !== "number" || !Number.isFinite(item.quantity) || item.quantity <= 0)) continue;
    const category = visibleCategory(item.category);
    const id = shoppingLineId({ ...item, name, unit });
    counts.set(id, (counts.get(id) ?? 0) + 1);
    const line = lines.get(id);
    if (line) {
      line.quantity = line.quantity === null ? item.quantity : item.quantity === null ? line.quantity : line.quantity + item.quantity;
      line.origins = [...line.origins, ...(item.origins ?? [])];
      line.needsReview ||= Boolean(item.needsReview);
      line.removed &&= Boolean(item.removed);
      line.adjusted ||= isAdjustedItem(item);
      line.editable = false;
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
      manual: isManualKey(item.itemKey),
      adjusted: isAdjustedItem(item),
      editable: item.quantity !== null && !item.removed && rowOf(id, item) !== null,
    });
  }
  return [...lines.values()].sort(
    (first, second) => categoryOrder(first.category) - categoryOrder(second.category) || first.name.localeCompare(second.name, "es"),
  );
}

// A row no longer needed that was unmarked afterwards is neither needed nor bought: not shown.
const shownRows = (list: ShoppingList) => list.items.filter((row) => !row.removedAt || row.checked);

// Account rows of each visible line: from the items' rows, or (copies written before D5) itemIds.
function indexRows(items: CachedShoppingItem[], previous: Record<string, string[]> = {}) {
  const itemIds: Record<string, string[]> = {};
  const withoutRow = new Set<string>();
  for (const item of items) {
    const id = shoppingLineId(item);
    if (item.rowId) (itemIds[id] ??= []).push(item.rowId);
    else withoutRow.add(id);
  }
  for (const id of withoutRow) if (!itemIds[id] && previous[id]) itemIds[id] = previous[id];
  return itemIds;
}

function listToCache(list: ShoppingList, signature: string): ShoppingCache {
  const rows = shownRows(list);
  const checked = new Set<string>();
  const items: CachedShoppingItem[] = rows.map((row) => ({
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    category: row.category,
    itemKey: row.itemKey ?? null,
    origins: row.origins ?? null,
    needsReview: Boolean(row.needsReview && row.checked),
    removed: Boolean(row.removedAt),
    ...(row.id ? { rowId: row.id } : {}),
  }));
  for (const row of rows) if (row.id && row.checked) checked.add(shoppingLineId(row));

  return {
    weekSignature: signature,
    items,
    checkedItemIds: [...checked],
    listId: list.id,
    itemIds: indexRows(items),
    pendingChecks: {},
    ingredientBasis: list.ingredientBasis ?? null,
  };
}

type ViewExtras = {
  change?: ReconcileSummary | null;
  aiError?: string | null;
  notUpdated?: boolean;
  discardedAdjustments?: string[];
  servings?: number | null;
};

function cacheToView(
  cache: ShoppingCache,
  source: ShoppingView["source"],
  offline: boolean,
  days: WeekDay[],
  discardedLocalChanges = false,
  extras: ViewExtras = {},
): ShoppingView {
  const signedIn = source !== "local";
  const items = visibleItems(cache.items, (id, item) => (signedIn ? item.rowId ?? (cache.itemIds?.[id]?.length === 1 ? cache.itemIds[id][0] : null) : id));
  const ids = new Set(items.map((item) => item.id));
  const withOrigins = cache.ingredientBasis === "mixed-v1";

  return {
    items,
    checkedItemIds: cache.checkedItemIds.filter((id) => ids.has(id)),
    source,
    offline,
    pending: signedIn && (!cache.listId || Object.keys(cache.pendingChecks ?? {}).length > 0 || (cache.pendingEdits?.length ?? 0) > 0),
    discardedLocalChanges,
    pendingDishes: withOrigins
      ? pendingDishesOf(cache.items.filter((item) => !item.removed), plannedDishes(days)).map(({ day, meal, title }) => ({ day, meal, title }))
      : [],
    // Only the dish cards' origins (an item added by hand, an adjusted quantity or a kind this
    // client does not know is not a card).
    fromCards: cache.items.some((item) => !item.removed && Boolean(item.origins?.some(isCardOrigin))),
    change: extras.change ?? null,
    aiError: extras.aiError ?? null,
    notUpdated: extras.notUpdated ?? false,
    discardedAdjustments: extras.discardedAdjustments ?? [],
    servings: extras.servings ?? null,
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

  // Rows added here whose add the account has not accepted yet: their marks wait (D5).
  const pendingAdds = new Set((cache.pendingEdits ?? []).flatMap((edit) => (edit.op === "add" ? [edit.id] : [])));
  for (const [itemId, value] of Object.entries(pending)) {
    const rows = cache.itemIds?.[itemId];
    if (rows?.some((row) => pendingAdds.has(row))) {
      remaining[itemId] = value;
      if (value) checked.add(itemId);
      else checked.delete(itemId);
      continue;
    }
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

// --- Edits of the user (D5) --------------------------------------------------------------------

// One edit applied to this device's copy (the account applies the same with edit_shopping_items).
function applyEdit(cache: ShoppingCache, edit: ShoppingEdit): ShoppingCache {
  let items = cache.items;
  let checkedItemIds = cache.checkedItemIds;
  let pendingChecks = cache.pendingChecks;
  if (edit.op === "add") {
    if (!items.some((item) => item.rowId === edit.id)) {
      items = [...items, {
        name: edit.name,
        quantity: edit.quantity,
        unit: edit.unit,
        category: edit.category,
        itemKey: edit.itemKey,
        origins: [{ kind: "manual", quantity: edit.quantity }],
        rowId: edit.id,
      }];
    }
  } else if (edit.op === "set_quantity") {
    items = items.map((item) => {
      if (item.rowId !== edit.id) return item;
      return isManualKey(item.itemKey)
        ? { ...item, quantity: edit.quantity, unit: edit.unit, origins: [{ kind: "manual", quantity: edit.quantity }] }
        : { ...item, quantity: edit.quantity, origins: edit.origins };
    });
  } else {
    const gone = items.find((item) => item.rowId === edit.id);
    if (gone) {
      const line = shoppingLineId(gone);
      items = items.filter((item) => item !== gone);
      checkedItemIds = checkedItemIds.filter((id) => id !== line);
      pendingChecks = Object.fromEntries(Object.entries(pendingChecks ?? {}).filter(([id]) => id !== line));
    }
  }
  return { ...cache, items, checkedItemIds, pendingChecks, itemIds: indexRows(items, cache.itemIds) };
}

const withEdits = (cache: ShoppingCache, edits: ShoppingEdit[]): ShoppingCache => ({
  ...edits.reduce(applyEdit, cache),
  pendingEdits: edits,
});

// Queue of edits: the last quantity of a row wins, and a removed row needs no quantity. An add is
// always kept (sent again it is a «duplicate»), so add + remove works even if the add arrived
// without an answer.
function queueEdit(edits: ShoppingEdit[], edit: ShoppingEdit) {
  const others = edit.op === "add" ? edits : edits.filter((queued) => !(queued.op === "set_quantity" && queued.id === edit.id));
  return [...others, edit];
}

function toOps(edits: ShoppingEdit[]): ShoppingEditOps {
  const ops: ShoppingEditOps = { add: [], set_quantity: [], remove: [] };
  for (const edit of edits) {
    if (edit.op === "add") ops.add.push({ id: edit.id, name: edit.name, quantity: edit.quantity, unit: edit.unit, category: edit.category, item_key: edit.itemKey });
    else if (edit.op === "set_quantity") ops.set_quantity.push({ id: edit.id, quantity: edit.quantity, unit: edit.unit, origins: edit.origins });
    else ops.remove.push({ id: edit.id });
  }
  return ops;
}

// At most 50 of each kind per call (the database's limit): 50 edits at a time, in order.
const EDIT_BATCH = 50;

// The edits sent in one call. The database applies adds, then quantities, then removes, and refuses
// a call that repeats an id or an added key: a call ends before any edit whose id or key already
// appeared in an add or remove of it (add, remove and add again of the same item → three calls).
function nextBatch(edits: ShoppingEdit[]) {
  const ids = new Set<string>();
  const keys = new Set<string>();
  const batch: ShoppingEdit[] = [];
  for (const edit of edits) {
    if (batch.length >= EDIT_BATCH) break;
    const key = edit.op === "add" ? edit.itemKey : edit.op === "remove" ? edit.itemKey ?? null : null;
    if (batch.length && (ids.has(edit.id) || (key !== null && keys.has(key)))) break;
    batch.push(edit);
    if (edit.op !== "set_quantity") {
      ids.add(edit.id);
      if (key !== null) keys.add(key);
    }
  }
  return batch;
}

const isRejection = (error: unknown) => Boolean(error && typeof error === "object" && (error as { rejected?: unknown }).rejected === true);

type EditsOutcome = {
  // none: nothing to send · synced: accepted · pending: kept here (no connection, or the database
  // cannot take edits yet) · stale: the list was replaced or the week is gone; the edits were dropped.
  status: "none" | "synced" | "pending" | "stale";
  // Adds the account refused because the same item was already in the list.
  existing: string[];
  // The list as the account returned it after the last accepted edits.
  list?: ShoppingList;
  // Tokens of edits the database refused (dropped, never sent again).
  rejected: Set<string>;
};

// Marks not accepted yet stay as this device has them.
function withPendingMarks(checkedItemIds: string[], pendingChecks: Record<string, boolean> | undefined) {
  const checked = new Set(checkedItemIds);
  for (const [id, value] of Object.entries(pendingChecks ?? {})) {
    if (value) checked.add(id);
    else checked.delete(id);
  }
  return [...checked];
}

// Sends this device's edits of its list, in the marks' queue. The device copy becomes the account
// list plus the edits made meanwhile.
function pushPendingEdits(identity: DataIdentity, isoWeek: IsoWeek): Promise<EditsOutcome> {
  return enqueue(queueKey(identity, isoWeek), async (): Promise<EditsOutcome> => {
    const remote = shoppingRemote(identity, isoWeek);
    const existing: string[] = [];
    const rejected = new Set<string>();
    let list: ShoppingList | undefined;
    for (;;) {
      const cache = readShoppingCache(identity, isoWeek);
      const edits = cache?.pendingEdits ?? [];
      if (!cache || !edits.length) return { status: list || rejected.size ? "synced" : "none", existing, list, rejected };
      if (!cache.listId || !remote?.edit) return { status: "pending", existing, rejected };
      const batch = nextBatch(edits);
      const sent = new Set(batch.map((edit) => edit.change));
      const remainingAfter = () => (readShoppingCache(identity, isoWeek)?.pendingEdits ?? []).filter((edit) => !sent.has(edit.change));
      let result;
      try {
        result = await remote.edit({ listId: cache.listId, ops: toOps(batch) });
      } catch (error) {
        // No connection: everything stays pending. Refused by the database: that call is dropped
        // (sending it again would be refused again) and the device shows the account list again.
        if (!isRejection(error)) return { status: "pending", existing, rejected };
        for (const token of sent) rejected.add(token);
        const current = readShoppingCache(identity, isoWeek);
        const remaining = remainingAfter();
        const fresh = await remote.fetch().catch(() => null);
        if (current && fresh?.list?.id === cache.listId) {
          const next = withEdits(listToCache(fresh.list, current.weekSignature), remaining);
          writeShoppingCache(identity, isoWeek, { ...next, checkedItemIds: withPendingMarks(next.checkedItemIds, current.pendingChecks), pendingChecks: current.pendingChecks ?? {} });
          list = fresh.list;
        } else if (current) {
          writeShoppingCache(identity, isoWeek, { ...current, pendingEdits: remaining });
        }
        continue;
      }
      if (result.status === "unavailable") return { status: "pending", existing, rejected };
      const current = readShoppingCache(identity, isoWeek);
      const remaining = remainingAfter();
      if (result.status === "stale" || result.status === "no_week") {
        if (current) writeShoppingCache(identity, isoWeek, { ...current, pendingEdits: [] });
        return { status: "stale", existing, rejected };
      }
      for (const entry of result.results) if (entry.result === "existing") existing.push(entry.id);
      list = result.list;
      const next = withEdits(listToCache(result.list, current?.weekSignature ?? cache.weekSignature), remaining);
      writeShoppingCache(identity, isoWeek, {
        ...next,
        checkedItemIds: withPendingMarks(next.checkedItemIds, current?.pendingChecks),
        pendingChecks: current?.pendingChecks ?? {},
      });
    }
  });
}

// The account list with this device's edits of it: sent first when there are any (the marks that
// follow may be of an item added here). Edits for another list are dropped.
async function settleEdits(identity: DataIdentity, isoWeek: IsoWeek, list: ShoppingList) {
  const cache = readShoppingCache(identity, isoWeek);
  if (!cache?.pendingEdits?.length) return { list, edits: [] as ShoppingEdit[], discarded: false };
  if (cache.listId !== list.id) return { list, edits: [] as ShoppingEdit[], discarded: true };
  const outcome = await pushPendingEdits(identity, isoWeek);
  const refused = outcome.rejected.size > 0;
  if (outcome.status === "stale") return { list, edits: [] as ShoppingEdit[], discarded: true };
  if (outcome.status === "pending") return { list: outcome.list ?? list, edits: readShoppingCache(identity, isoWeek)?.pendingEdits ?? [], discarded: refused };
  return { list: outcome.list ?? list, edits: readShoppingCache(identity, isoWeek)?.pendingEdits ?? [], discarded: refused };
}

export type EditResult = {
  // local: guest (this device only) · synced: in the account · pending: kept on this device and sent
  // later · stale: the account replaced the list; nothing was written · existing: that item is
  // already in the list · no_list: the week has no list yet · refused: not possible on this line ·
  // discarded: the database refused it; dropped, the device shows the account list again.
  status: "local" | "synced" | "pending" | "stale" | "existing" | "no_list" | "refused" | "discarded";
  view: ShoppingView | null;
};

const viewOf = (identity: DataIdentity, isoWeek: IsoWeek, days: WeekDay[], discarded = false) => {
  const cache = readShoppingCache(identity, isoWeek);
  return cache ? cacheToView(cache, identity.userId ? "remote" : "local", false, days, discarded) : null;
};

// The device copy as it is now (after an edit, a mark or a pantry change), for the page.
export function readShoppingView(identity: DataIdentity, isoWeek: IsoWeek, days: WeekDay[]) {
  return viewOf(identity, isoWeek, days);
}

type EditPlan = ShoppingEdit | { local: (cache: ShoppingCache) => ShoppingCache } | EditResult["status"];

async function runEdit(identity: DataIdentity, isoWeek: IsoWeek, days: WeekDay[], plan: (cache: ShoppingCache, signedIn: boolean) => EditPlan): Promise<EditResult> {
  const cache = readShoppingCache(identity, isoWeek);
  if (!cache?.items.length) return { status: "no_list", view: null };
  const remote = shoppingRemote(identity, isoWeek);
  const edit = plan(cache, Boolean(remote));
  if (typeof edit === "string") return { status: edit, view: viewOf(identity, isoWeek, days) };
  if ("local" in edit) {
    writeShoppingCache(identity, isoWeek, edit.local(cache));
    return { status: "local", view: viewOf(identity, isoWeek, days) };
  }
  writeShoppingCache(identity, isoWeek, { ...applyEdit(cache, edit), pendingEdits: queueEdit(cache.pendingEdits ?? [], edit) });
  const outcome = await pushPendingEdits(identity, isoWeek);
  const status = outcome.status === "stale" ? "stale"
    : outcome.rejected.has(edit.change) ? "discarded"
      : outcome.status === "pending" ? "pending"
        : edit.op === "add" && outcome.existing.includes(edit.id) ? "existing"
          : "synced";
  return { status, view: viewOf(identity, isoWeek, days, outcome.rejected.size > 0) };
}

const cleanText = (text: string) => text.normalize("NFC").trim().replace(/\s+/g, " ");
const validAmount = (quantity: number | null) => quantity === null || (Number.isFinite(quantity) && quantity > 0 && quantity <= 100000);

export type ManualItemInput = { name: string; quantity: number | null; unit: string; category: SupermarketCategory };

// Adds an item by hand to the week's list (only when the week has one). quantity null: «al gusto».
export function addManualShoppingItem(identity: DataIdentity, isoWeek: IsoWeek, input: ManualItemInput, days: WeekDay[]) {
  return runEdit(identity, isoWeek, days, (cache, signedIn): EditPlan => {
    const name = cleanText(input.name).slice(0, 120);
    const unit = input.quantity === null ? "al gusto" : cleanText(input.unit || "ud").slice(0, 40);
    if (!name || !unit || !validAmount(input.quantity) || !supermarketCategoryLabels.includes(input.category)) return "refused";
    const itemKey = manualItemKey(name);
    if (cache.items.some((item) => item.itemKey === itemKey && !item.removed)) return "existing";
    const edit: ShoppingEdit = { op: "add", id: crypto.randomUUID(), change: crypto.randomUUID(), name, quantity: input.quantity, unit, category: input.category, itemKey };
    return signedIn ? edit : { local: (current) => ({ ...applyEdit(current, edit), itemIds: current.itemIds }) };
  });
}

// The only item of a visible line (several rows of an old list cannot be edited one by one).
function onlyItem(cache: ShoppingCache, lineId: string) {
  const items = cache.items.filter((item) => shoppingLineId(item) === lineId);
  return items.length === 1 ? items[0] : null;
}

const rowIdOf = (cache: ShoppingCache, lineId: string, item: CachedShoppingItem) =>
  item.rowId ?? (cache.itemIds?.[lineId]?.length === 1 ? cache.itemIds[lineId][0] : null);

// Changes the quantity of one line. An item added by hand may change its unit too; an item of the
// dishes keeps its unit and records the user's amount (origin user_adjust) next to its dishes.
export function setShoppingItemQuantity(identity: DataIdentity, isoWeek: IsoWeek, lineId: string, quantity: number, days: WeekDay[], unit?: string) {
  return runEdit(identity, isoWeek, days, (cache, signedIn): EditPlan => {
    const item = onlyItem(cache, lineId);
    if (!item || item.quantity === null || item.removed || !validAmount(quantity)) return "refused";
    const manual = isManualKey(item.itemKey);
    const nextUnit = manual && unit !== undefined ? cleanText(unit).slice(0, 40) : item.unit;
    if (!nextUnit || nextUnit.toLowerCase() === "al gusto") return "refused";
    const origins = manual
      ? [{ kind: "manual" as const, quantity }]
      : [...dishOriginsOf(item.origins), { kind: "user_adjust" as const, quantity }];
    if (!signedIn) {
      return { local: (current) => ({ ...current, items: current.items.map((entry) => (entry === item || (shoppingLineId(entry) === lineId) ? { ...entry, quantity, unit: nextUnit, origins } : entry)) }) };
    }
    const rowId = rowIdOf(cache, lineId, item);
    if (!rowId) return "refused";
    return { op: "set_quantity", id: rowId, change: crypto.randomUUID(), quantity, unit: nextUnit, origins };
  });
}

// Removes an item added by hand (the items of the dishes follow the menu).
export function removeManualShoppingItem(identity: DataIdentity, isoWeek: IsoWeek, lineId: string, days: WeekDay[]) {
  return runEdit(identity, isoWeek, days, (cache, signedIn): EditPlan => {
    const item = onlyItem(cache, lineId);
    if (!item || !isManualKey(item.itemKey)) return "refused";
    if (!signedIn) {
      return {
        local: (current) => ({
          ...current,
          items: current.items.filter((entry) => shoppingLineId(entry) !== lineId),
          checkedItemIds: current.checkedItemIds.filter((id) => id !== lineId),
        }),
      };
    }
    const rowId = rowIdOf(cache, lineId, item);
    if (!rowId) return "refused";
    return { op: "remove", id: rowId, change: crypto.randomUUID(), itemKey: item.itemKey ?? null };
  });
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
  // D5: edits made on this device before the list reached the account (items added by hand).
  pendingEdits: ShoppingEdit[] = [],
): Promise<ShoppingLoad> {
  const remote = shoppingRemote(identity, isoWeek);
  // Items added by hand are sent as edits after the list is saved (with their own ids).
  const saved = remote ? items.filter((item) => !isManualKey(item.itemKey)) : items;
  const toSave = saved.filter((item) => !item.removed).map(({ name, quantity, unit, category, itemKey, origins }) => ({
    name,
    quantity,
    unit,
    category,
    ...(itemKey ? { itemKey, origins: origins ?? [] } : {}),
  }));
  const deviceCopy: ShoppingCache = withEdits(
    { weekSignature: signature, items: toSave, checkedItemIds, listId: null, ingredientBasis: basisOf(toSave) },
    remote ? pendingEdits : [],
  );
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
    if (pendingEdits.length) {
      writeShoppingCache(identity, isoWeek, withEdits(cache, pendingEdits));
      await pushPendingEdits(identity, isoWeek);
      cache = readShoppingCache(identity, isoWeek) ?? cache;
    }
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

  const extras: ViewExtras = { servings: context?.servings ?? null };
  if (state.list && isCurrentList(state.list, state.week, signature)) {
    // D5: this device's edits of the list first (a mark may be of an item added here).
    const settled = await settleEdits(identity, isoWeek, state.list);
    let next = withEdits(listToCache(settled.list, signature), settled.edits);
    const devicePending = Object.keys(cache?.pendingChecks ?? {}).length > 0;
    let discarded = settled.discarded || (devicePending && cache?.listId !== state.list.id);
    if (devicePending && cache?.listId === state.list.id) {
      const pushed = await pushPendingChecks(identity, isoWeek, next, cache!.pendingChecks!);
      next = pushed.cache;
      discarded ||= pushed.discarded;
    }
    writeShoppingCache(identity, isoWeek, next);
    return { status: "ready", view: cacheToView(next, "remote", false, state.week.days, discarded, extras) };
  }

  // This device has the list for this content but the account does not (generated while offline,
  // or replaced elsewhere and then changed back): save it, without calling the AI.
  if (deviceListMatches(state.week.days, context)) {
    return storeList(identity, isoWeek, signature, cache!.items, state.week.version, state.week.days, cache!.checkedItemIds, extras,
      cache!.listId === null ? cache!.pendingEdits ?? [] : []);
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
    // Step 34: the week's servings go with the new list, as when it is read again.
    const servings = context?.servings ?? null;
    if (computed.legacyItems && computed.items.length === 0) {
      return storeList(identity, isoWeek, signature, computed.legacyItems, weekVersion, weekDays, [], { servings });
    }
    // Nothing known (no card, the AI failed): nothing to save; the page shows why.
    if (computed.items.length === 0) throw nothingKnown(computed);
    return storeList(identity, isoWeek, signature, computed.items, weekVersion, weekDays, [], {
      aiError: computed.aiError ? aiErrorMessage(computed.aiError) : null,
      servings,
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
    let pushedEdits = false;
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

      // D5: edits this device made on this same list go first (items added by hand, quantities).
      const cache = readShoppingCache(identity, isoWeek);
      if (!pushedEdits && cache?.pendingEdits?.length) {
        pushedEdits = true;
        if (cache.listId === list.id) await pushPendingEdits(identity, isoWeek);
        else writeShoppingCache(identity, isoWeek, { ...cache, pendingEdits: [] });
        attempt--;
        continue;
      }
      // Marks this device made offline on this same list are sent first: they decide what is bought.
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
      const servings = context?.servings ?? null;
      const shown = (extras: ViewExtras = {}): ShoppingLoad => {
        const next = listToCache(list, signature);
        writeShoppingCache(identity, isoWeek, next);
        return { status: "ready", view: cacheToView(next, "remote", false, days, false, { servings, ...extras }) };
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
        return storeList(identity, isoWeek, signature, items, state.week.version, days, [], { aiError, servings });
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
        const needed = new Set(list.items.filter((row) => dishOriginsOf(row.origins).some((origin) => pending.has(pendingKey(origin)))).map((row) => row.id));
        ops.remove = ops.remove.filter((op) => !needed.has(op.id));
      }

      // D5: adjusted quantities this update recomputes (their dishes changed), to tell the user.
      const dropped = discardedAdjustments(toExistingRows(list), ops);
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
        return storeList(identity, isoWeek, signature, computed.items, state.week.version, days, [], { aiError, servings });
      }

      const next = listToCache(result.list, signature);
      writeShoppingCache(identity, isoWeek, next);
      return {
        status: "ready",
        view: cacheToView(next, "remote", false, days, false, {
          change: result.status === "applied" ? result.summary : null,
          aiError,
          servings,
          discardedAdjustments: result.status === "applied" ? dropped : [],
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
    items: cache.items.map((item) => (item.needsReview && shoppingLineId(item) === itemId ? { ...item, needsReview: false } : item)),
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
    // An item added here whose add has not reached the account yet: the mark stays pending (it is
    // sent after the add, on the next load) instead of being refused as a missing row.
    const result = await enqueue(queueKey(identity, isoWeek), () => {
      const now = readShoppingCache(identity, isoWeek);
      if (now?.pendingEdits?.some((edit) => edit.op === "add" && rows.includes(edit.id))) return Promise.resolve(null);
      return remote.setChecked(rows, checked);
    });
    if (result === null) {
      settle(true);
      return { status: "pending" };
    }
    settle(false);
    return result.status === "applied" ? { status: "synced" } : { status: "stale" };
  } catch {
    settle(true);
    return { status: "pending" };
  }
}
