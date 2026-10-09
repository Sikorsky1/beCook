// Pantry (B7, roadmap step 13, audit H8 §8).
// - Signed in, the account pantry is read first; this device's copy is shown only when the account
//   cannot be reached. Nothing is declared empty until the account confirms it.
// - Every change writes one item: add (with an id chosen here, so a resend changes nothing), set
//   in the pantry / used up (a value, never a toggle) or delete, each checked against the version
//   of that item's rows. The whole pantry is never deleted and inserted again.
// - Changes to different items never conflict. A change to an item that another device changed
//   since it was read is refused: the account wins and the item is shown as it is there.
// - Without connection a change stays on this device (pending) and is sent on the next load.
// - When the account confirms its pantry is empty, the default items are shown and the first
//   change adds them too. Without that confirmation only the changed item is sent.
// - Guests: local only, as before.
import { pantryRemote, type DataIdentity, type PantryRemote } from "@/lib/data/repositories";
import type { LoadResult } from "@/lib/data/sync";
import {
  capitalizePantryItemName,
  pantryItemKey,
  pantryItemsOrDefault,
  parseStoredPantryItems,
  type PantryCategory,
  type PantryStorageItem,
} from "@/lib/pantryStorage";
import { readEnvelope, readScoped, removeScoped, writeScoped } from "@/lib/storage/scoped-storage";
import type { PantryRowState } from "@/lib/supabase/pantry";

// remoteVersion of a device copy kept item by item: CONFIRMED when written right after reading
// the account (items without rows are then the defaults of an empty pantry), UNCONFIRMED when
// changed before any account read. Copies saved before B7 hold an updated_at.
const CONFIRMED = "b7";
const UNCONFIRMED = "b7-unconfirmed";

const token = () => crypto.randomUUID();
const newAdd = () => ({ op: "add" as const, id: token(), change: token() });

type Stored = { items: PantryStorageItem[]; legacyPending: boolean; version: string | null };

function readStored(identity: DataIdentity): Stored | null {
  const envelope = readEnvelope<unknown>(identity.scope, "pantry");
  if (!envelope) return null;
  return {
    items: parseStoredPantryItems(envelope.data),
    legacyPending: envelope.pending && envelope.remoteVersion !== CONFIRMED && envelope.remoteVersion !== UNCONFIRMED,
    version: envelope.remoteVersion,
  };
}

function writeStored(identity: DataIdentity, items: PantryStorageItem[], version: string) {
  writeScoped(identity.scope, "pantry", items, {
    remoteVersion: version,
    pending: items.some((item) => item.pending),
  });
}

// Applies a synchronous change to the device copy (no await in between: never loses a change).
function updateStored(identity: DataIdentity, mutate: (items: PantryStorageItem[]) => void) {
  const stored = readStored(identity);
  const items = stored?.items ?? [];
  mutate(items);
  writeStored(identity, items, stored?.version === CONFIRMED ? CONFIRMED : UNCONFIRMED);
}

const indexOfKey = (items: PantryStorageItem[], key: string) =>
  items.findIndex((item) => pantryItemKey(item) === key);

// Account rows → one item per category and name (the previous client could duplicate rows).
function rowsToItems(rows: PantryRowState[]): PantryStorageItem[] {
  const items = new Map<string, PantryStorageItem>();
  for (const row of rows) {
    const key = pantryItemKey(row);
    const item = items.get(key);
    if (item) {
      item.rows!.push({ id: row.id, version: row.version });
    } else {
      items.set(key, {
        name: capitalizePantryItemName(row.name),
        category: row.category,
        active: row.active,
        rows: [{ id: row.id, version: row.version }],
      });
    }
  }
  return [...items.values()];
}

// The account pantry plus this device's changes not accepted yet. A pending change keeps the row
// versions it was based on, so a change made elsewhere meanwhile is detected when it is sent.
function withPending(account: PantryStorageItem[], stored: PantryStorageItem[]) {
  const items = new Map(account.map((item) => [pantryItemKey(item), item]));
  for (const item of stored) {
    if (!item.pending) continue;
    const key = pantryItemKey(item);
    const current = items.get(key);
    if (item.pending.op === "add") {
      // Already there (this add arrived, or another device added it): the account copy is kept.
      if (!current) items.set(key, item);
    } else if (current) {
      // Not there any more: deleted elsewhere, the account wins.
      items.set(key, { ...current, active: item.active, rows: item.rows, pending: item.pending });
    }
  }
  return [...items.values()];
}

// A device copy saved before B7 with a change not sent: if the account is still the version it
// was based on, the change becomes one write per item; otherwise the account wins.
function convertLegacyPending(stored: PantryStorageItem[], rows: PantryRowState[]) {
  const account = new Map(rowsToItems(rows).map((item) => [pantryItemKey(item), item]));
  const items: PantryStorageItem[] = [];
  for (const item of stored) {
    const key = pantryItemKey(item);
    const current = account.get(key);
    account.delete(key);
    if (!current) items.push({ ...item, rows: undefined, pending: newAdd() });
    else items.push(current.active === item.active ? current : { ...current, active: item.active, pending: { op: "active", change: token() } });
  }
  for (const removed of account.values()) items.push({ ...removed, pending: { op: "delete", change: token() } });
  return items;
}

// Pantry writes of one identity are sent one at a time, in order.
const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const next = (queues.get(key) ?? Promise.resolve()).then(task, task);
  queues.set(key, next);
  return next;
}

type FlushOutcome = { failed: boolean; discarded: boolean };

// Sends this device's pending changes. Stops at the first one that cannot reach the account.
async function flush(identity: DataIdentity, remote: PantryRemote): Promise<FlushOutcome> {
  let discarded = false;

  // Adds go in one request (the first change of an empty pantry also adds the default items).
  const adds = (readStored(identity)?.items ?? []).filter((item) => item.pending?.op === "add");
  if (adds.length) {
    let results;
    try {
      results = await remote.add(adds.map((item) => ({
        id: item.pending!.op === "add" ? item.pending!.id : token(),
        name: item.name,
        category: item.category,
        active: item.active,
      })));
    } catch {
      return { failed: true, discarded };
    }
    updateStored(identity, (items) => {
      results.forEach((result, position) => {
        const sent = adds[position];
        const index = indexOfKey(items, pantryItemKey(sent));
        if (index < 0) return;
        const current = items[index];
        const rows = [{ id: result.row.id, version: result.row.version }];
        const account: PantryStorageItem = {
          name: capitalizePantryItemName(result.row.name),
          category: result.row.category,
          active: result.row.active,
          rows,
        };
        if (result.result === "existing" && result.row.active !== sent.active) discarded = true;
        if (current.pending?.change === sent.pending?.change || result.result === "existing") {
          items[index] = account;
        } else if (current.pending?.op === "delete") {
          items[index] = { ...current, rows };
        } else {
          // Changed again while the add was on its way: that change is sent next.
          items[index] = current.active === account.active
            ? account
            : { ...account, active: current.active, pending: { op: "active", change: current.pending!.change } };
        }
      });
    });
  }

  for (;;) {
    const item = (readStored(identity)?.items ?? []).find((stored) => stored.pending && stored.pending.op !== "add");
    if (!item) break;
    const key = pantryItemKey(item);
    if (!item.rows?.length) {
      // Nothing of it in the account (cannot happen after the adds above): drop the change.
      updateStored(identity, (items) => {
        const index = indexOfKey(items, key);
        if (index >= 0) items.splice(index, 1);
      });
      continue;
    }
    let result;
    try {
      result = item.pending!.op === "delete"
        ? await remote.remove(item.rows)
        : await remote.setActive(item.rows, item.active);
    } catch {
      return { failed: true, discarded };
    }
    updateStored(identity, (items) => {
      const index = indexOfKey(items, key);
      if (index < 0) return;
      const current = items[index];
      if (result.status === "missing") {
        // Deleted on another device.
        discarded = true;
        items.splice(index, 1);
      } else if (result.status === "conflict") {
        // Changed on another device since this copy was read: the account wins.
        discarded = true;
        items[index] = rowsToItems(result.rows)[0] ?? current;
        if (!result.rows.length) items.splice(index, 1);
      } else if (item.pending!.op === "delete") {
        if (current.pending?.op === "delete") items.splice(index, 1);
        // Added back while the delete was on its way: it is in the account no more.
        else items[index] = { ...current, rows: undefined, pending: { op: "add", id: token(), change: current.pending!.change } };
      } else if (current.pending?.change === item.pending!.change) {
        items[index] = rowsToItems(result.rows)[0] ?? current;
      } else {
        items[index] = { ...current, rows: rowsToItems(result.rows)[0]?.rows ?? current.rows };
      }
    });
  }

  return { failed: false, discarded };
}

// Device copy as shown: the stored items, or the default items when there is none.
export function readCachedPantry(identity: DataIdentity) {
  return readScoped<unknown>(identity.scope, "pantry");
}

export function readPantryView(identity: DataIdentity) {
  return pantryItemsOrDefault(readCachedPantry(identity));
}

// The device copy becomes the account pantry plus this device's changes not accepted yet.
function adoptAccount(identity: DataIdentity, rows: PantryRowState[]) {
  const items = withPending(rowsToItems(rows), readStored(identity)?.items ?? []);
  // An empty account pantry: this device keeps the default items, not yet in the account.
  writeStored(identity, items.length ? items : pantryItemsOrDefault(null), CONFIRMED);
  return items;
}

export function loadPantry(identity: DataIdentity): Promise<LoadResult<PantryStorageItem[]>> {
  const remote = pantryRemote(identity);
  if (identity.scope === "guest" || !remote) {
    const data = readCachedPantry(identity);
    return Promise.resolve({
      data: data === null ? null : pantryItemsOrDefault(data),
      source: "local",
      offline: false,
      discardedLocalChanges: false,
      pending: false,
    });
  }

  return enqueue(identity.scope, async () => {
    const fromDevice = (discardedLocalChanges: boolean): LoadResult<PantryStorageItem[]> => {
      const stored = readStored(identity);
      return {
        data: stored ? pantryItemsOrDefault(stored.items) : null,
        source: "cache",
        offline: true,
        discardedLocalChanges,
        pending: Boolean(stored?.items.some((item) => item.pending) || stored?.legacyPending),
      };
    };

    let account: Awaited<ReturnType<PantryRemote["fetch"]>>;
    try {
      account = await remote.fetch();
    } catch {
      return fromDevice(false);
    }

    let discarded = false;
    const stored = readStored(identity);
    if (stored?.legacyPending) {
      if (account.version === stored.version) {
        writeStored(identity, convertLegacyPending(stored.items, account.rows), CONFIRMED);
      } else {
        discarded = true;
        removeScoped(identity.scope, "pantry");
      }
    }

    if (readStored(identity)?.items.some((item) => item.pending)) {
      const outcome = await flush(identity, remote);
      discarded ||= outcome.discarded;
      if (outcome.failed) return fromDevice(discarded);
      try {
        account = await remote.fetch();
      } catch {
        return fromDevice(discarded);
      }
    }

    const items = adoptAccount(identity, account.rows);
    return {
      data: items.length ? pantryItemsOrDefault(items) : null,
      source: "remote",
      offline: false,
      discardedLocalChanges: discarded,
      pending: items.some((item) => item.pending),
    };
  });
}

export type PantryChangeResult = {
  // local: guest · synced: in the account · pending: kept on this device, sent on the next load ·
  // conflict: another device had changed that item; the account copy is shown.
  status: "local" | "synced" | "pending" | "conflict";
  items: PantryStorageItem[];
};

// The device copy changes at once; then only the changed items are written to the account.
function applyChange(
  identity: DataIdentity,
  mutate: (items: PantryStorageItem[]) => void,
): Promise<PantryChangeResult> {
  const remote = pantryRemote(identity);
  if (identity.scope === "guest" || !remote) {
    const items = pantryItemsOrDefault(readCachedPantry(identity));
    mutate(items);
    writeScoped(identity.scope, "pantry", items.map(({ name, category, active }) => ({ name, category, active })));
    return Promise.resolve({ status: "local", items: readPantryView(identity) });
  }

  // Items without account rows in a copy written after reading the account are the defaults of
  // an empty pantry: they are added too. Any other copy (none yet, or saved before B7) may not
  // match the account, so only the changed item is sent (the account merges it by name).
  const stored = readStored(identity);
  const confirmed = stored?.version === CONFIRMED;
  const items = (stored ? stored.items : pantryItemsOrDefault(null)).map((item) =>
    item.rows || item.pending || !confirmed ? item : { ...item, pending: newAdd() },
  );
  mutate(items);
  writeStored(identity, items, confirmed ? CONFIRMED : UNCONFIRMED);

  return enqueue(identity.scope, async () => {
    const outcome = await flush(identity, remote);
    if (outcome.discarded && !outcome.failed) {
      // Another device changed the pantry: show it as the account has it now.
      await remote.fetch().then((account) => adoptAccount(identity, account.rows), () => undefined);
    }
    return {
      status: outcome.failed ? "pending" : outcome.discarded ? "conflict" : "synced",
      items: readPantryView(identity),
    };
  });
}

const findShown = (items: PantryStorageItem[], key: string) =>
  items.findIndex((item) => pantryItemKey(item) === key && item.pending?.op !== "delete");

export function setPantryItemActive(
  identity: DataIdentity,
  category: PantryCategory,
  name: string,
  active: boolean,
) {
  const key = pantryItemKey({ category, name });
  return applyChange(identity, (items) => {
    const index = findShown(items, key);
    if (index < 0) return;
    const item = items[index];
    items[index] = {
      ...item,
      active,
      pending: item.pending?.op === "add"
        ? { ...item.pending, change: token() }
        : item.rows ? { op: "active", change: token() } : newAdd(),
    };
  });
}

export function addPantryItem(identity: DataIdentity, category: PantryCategory, name: string) {
  const displayName = capitalizePantryItemName(name);
  const key = pantryItemKey({ category, name: displayName });
  return applyChange(identity, (items) => {
    if (!displayName || findShown(items, key) >= 0) return;
    const index = indexOfKey(items, key);
    if (index >= 0) {
      // Deleted on this device but not yet in the account: it stays, in the pantry.
      items[index] = { ...items[index], active: true, pending: { op: "active", change: token() } };
    } else {
      items.push({ name: displayName, category, active: true, pending: newAdd() });
    }
  });
}

export function deletePantryItem(identity: DataIdentity, category: PantryCategory, name: string) {
  const key = pantryItemKey({ category, name });
  return applyChange(identity, (items) => {
    const index = findShown(items, key);
    if (index < 0) return;
    const item = items[index];
    if (item.pending?.op === "add") {
      // Its add may have arrived without an answer: delete that row if it exists, unchanged.
      items[index] = { ...item, rows: [{ id: item.pending.id, version: 1 }], pending: { op: "delete", change: token() } };
    } else if (item.rows) {
      items[index] = { ...item, pending: { op: "delete", change: token() } };
    } else {
      items.splice(index, 1);
    }
  });
}

// Explicit import of pre-B1 device data into an account without pantry: every item is added.
export async function importPantryItems(identity: DataIdentity, imported: PantryStorageItem[]) {
  const result = await applyChange(identity, (items) => {
    items.splice(0, items.length, ...imported.map(({ name, category, active }) => ({
      name: capitalizePantryItemName(name),
      category,
      active,
      pending: newAdd(),
    })));
  });
  return result.status;
}
