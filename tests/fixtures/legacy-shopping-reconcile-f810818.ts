// Frozen copy of src/lib/shopping/reconcile.ts as served by main (f810818, C4) before D5: the diff
// the deployed client sends to reconcile_shopping_list. Used only by scripts/shopping-manual-db-tests.cjs.
// Do not edit except for the import paths.
// Delta between the list the account has and what the dishes need now (C4, roadmap step 20).
// Pure: the database applies it with reconcile_shopping_list, which has the last word on marks
// (a bought item is never removed, only marked «ya no hace falta» or «revisar»).
// Items are matched by item_key; rows made before C4 have none and get the key computed with the
// same rules (units.ts), so an old list is updated in place and keeps its marks.
import type { ShoppingOrigin, SupermarketCategory } from "./legacy-shopping-list-f810818";

import type { DesiredItem } from "../../src/lib/shopping/build";
import { storedItemKey } from "../../src/lib/shopping/units";

export type ExistingShoppingRow = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string;
  category: SupermarketCategory;
  checked: boolean;
  itemKey: string | null;
  origins: ShoppingOrigin[] | null;
  removedAt: string | null;
};

export type ReconcileItem = {
  name: string;
  quantity: number | null;
  unit: string;
  category: SupermarketCategory;
  item_key: string;
  origins: ShoppingOrigin[];
};

export type ReconcileOps = {
  add: ReconcileItem[];
  update: (ReconcileItem & { id: string })[];
  remove: { id: string }[];
};

export type ReconcileSummary = {
  added: number;
  removed: number;
  keptBought: number;
  changed: number;
  review: number;
};

const toItem = (desired: DesiredItem): ReconcileItem => ({
  name: desired.name,
  quantity: desired.quantity,
  unit: desired.unit,
  category: desired.category,
  item_key: desired.itemKey,
  origins: desired.origins,
});

function sameItem(row: ExistingShoppingRow, desired: DesiredItem) {
  return (
    row.removedAt === null &&
    row.itemKey === desired.itemKey &&
    row.name === desired.name &&
    row.quantity === desired.quantity &&
    row.unit === desired.unit &&
    row.category === desired.category &&
    JSON.stringify(row.origins ?? null) === JSON.stringify(desired.origins)
  );
}

// The row that keeps a key: an active one before one no longer needed, a bought one first.
function rank(row: ExistingShoppingRow) {
  return (row.removedAt === null ? 0 : 2) + (row.checked ? 0 : 1);
}

export function diffShoppingList(existing: ExistingShoppingRow[], desired: DesiredItem[]): ReconcileOps {
  const groups = new Map<string, ExistingShoppingRow[]>();
  for (const row of existing) {
    const key = storedItemKey(row);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(row);
  }
  for (const rows of groups.values()) rows.sort((first, second) => rank(first) - rank(second));

  const ops: ReconcileOps = { add: [], update: [], remove: [] };
  const wanted = new Set<string>();

  for (const item of desired) {
    wanted.add(item.itemKey);
    const [target, ...others] = groups.get(item.itemKey) ?? [];
    if (!target) ops.add.push(toItem(item));
    else if (!sameItem(target, item)) ops.update.push({ id: target.id, ...toItem(item) });
    // Duplicates of the same ingredient in an old list: one line remains.
    for (const row of others) if (row.removedAt === null || !row.checked) ops.remove.push({ id: row.id });
  }

  for (const [key, rows] of groups) {
    if (wanted.has(key)) continue;
    // Active rows go (bought ones stay as «ya no hace falta»); a row no longer needed that was
    // unmarked afterwards is not shown and goes too.
    for (const row of rows) if (row.removedAt === null || !row.checked) ops.remove.push({ id: row.id });
  }

  return ops;
}

export const isEmptyOps = (ops: ReconcileOps) => ops.add.length + ops.update.length + ops.remove.length === 0;

// «2 añadidos · 1 quitado · 1 comprado ya no hace falta · 1 para revisar».
export function describeReconcileSummary(summary: ReconcileSummary) {
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const parts = [
    summary.added ? plural(summary.added, "añadido", "añadidos") : null,
    summary.removed ? plural(summary.removed, "quitado", "quitados") : null,
    summary.changed ? plural(summary.changed, "cantidad cambiada", "cantidades cambiadas") : null,
    summary.keptBought ? plural(summary.keptBought, "comprado que ya no hace falta", "comprados que ya no hacen falta") : null,
    summary.review ? plural(summary.review, "comprado para revisar", "comprados para revisar") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Sin cambios en los ingredientes";
}
