import { pantryBaseItems } from "@/data/mockPantry";

// Pure pantry helpers. Persistence lives in @/lib/data/repositories (scoped by identity).

export type PantryCategory =
  | "básicos"
  | "especias"
  | "aceites y vinagres"
  | "salsas"
  | "conservas"
  | "congelados"
  | "otros";
type LegacyPantryCategory = PantryCategory;

// Account row of an item and the version this copy is based on (B7).
export type PantryRowRef = { id: string; version: number };

// A change of this device not accepted by the account yet (signed-in only). change: token of the
// latest local change, so a write that returns after a newer change does not clear it.
// add: not in the account yet, sent with this id · active: set item.active · delete: hidden.
export type PantryPendingChange = { op: "add"; id: string; change: string } | { op: "active" | "delete"; change: string };

export type PantryStorageItem = {
  name: string;
  category: PantryCategory;
  active: boolean;
  // Signed-in only: the account rows of this item (several when the previous client duplicated it).
  rows?: PantryRowRef[];
  pending?: PantryPendingChange;
};

const pantryCategoryValues = new Set<LegacyPantryCategory>([
  "básicos",
  "especias",
  "aceites y vinagres",
  "salsas",
  "conservas",
  "congelados",
  "otros",
]);

const pantryCategoryByItem = new Map<string, PantryCategory>([
  ["sal", "básicos"],
  ["pimienta", "especias"],
  ["ajo en polvo", "especias"],
  ["mostaza", "salsas"],
  ["aceite de oliva", "aceites y vinagres"],
  ["vinagre", "aceites y vinagres"],
]);

export function normalizePantryItemName(itemName: string) {
  return itemName
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function getPantryItemCategory(itemName: string): PantryCategory {
  return pantryCategoryByItem.get(normalizePantryItemName(itemName)) ?? "otros";
}

export function capitalizePantryItemName(itemName: string) {
  const normalizedName = itemName.trim().replace(/\s+/g, " ");

  if (!normalizedName) {
    return "";
  }

  return normalizedName.charAt(0).toUpperCase() + normalizedName.slice(1);
}

function isPantryCategory(value: unknown): value is LegacyPantryCategory {
  return (
    typeof value === "string" &&
    pantryCategoryValues.has(value as LegacyPantryCategory)
  );
}

function normalizePantryItem(item: PantryStorageItem): PantryStorageItem {
  return { ...item, name: capitalizePantryItemName(item.name) };
}

export function pantryItemKey(item: Pick<PantryStorageItem, "name" | "category">) {
  return `${item.category}:${normalizePantryItemName(item.name)}`;
}

function parseRows(value: unknown): PantryRowRef[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value.filter(
    (row): row is PantryRowRef =>
      Boolean(row) && typeof row.id === "string" && typeof row.version === "number",
  );
  return rows.length ? rows.map(({ id, version }) => ({ id, version })) : undefined;
}

function parsePending(value: unknown): PantryPendingChange | undefined {
  const pending = value as Partial<{ op: string; id: string; change: string }> | null;
  if (!pending || typeof pending.change !== "string") return undefined;
  if (pending.op === "add" && typeof pending.id === "string") return { op: "add", id: pending.id, change: pending.change };
  if (pending.op === "active" || pending.op === "delete") return { op: pending.op, change: pending.change };
  return undefined;
}

function getLegacyPantryItems(activeItems: string[]): PantryStorageItem[] {
  const normalizedActiveItems = new Set(
    activeItems.map((item) => normalizePantryItemName(item)),
  );

  return pantryBaseItems.map((itemName) => ({
    name: itemName,
    category: getPantryItemCategory(itemName),
    active: normalizedActiveItems.has(normalizePantryItemName(itemName)),
  }));
}

function parseStoredItem(item: unknown): PantryStorageItem | null {
  if (!item || typeof item !== "object") {
    return null;
  }

  const parsedItem = item as Partial<PantryStorageItem>;
  const name =
    typeof parsedItem.name === "string"
      ? capitalizePantryItemName(parsedItem.name)
      : "";

  if (!name || !isPantryCategory(parsedItem.category)) {
    return null;
  }

  const rows = parseRows(parsedItem.rows);
  const pending = parsePending(parsedItem.pending);
  return {
    name,
    category: parsedItem.category,
    active: parsedItem.active !== false,
    ...(rows ? { rows } : {}),
    ...(pending ? { pending } : {}),
  };
}

function parsePantryStorageItems(value: unknown): PantryStorageItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  if (value.every((item) => typeof item === "string")) {
    return getLegacyPantryItems(value.map((item) => String(item)));
  }

  const itemMap = new Map<string, PantryStorageItem>();

  for (const item of parseStoredPantryItems(value)) {
    // Deleted on this device, not yet in the account: no longer shown.
    if (item.pending?.op !== "delete") {
      itemMap.set(pantryItemKey(item), item);
    }
  }

  return Array.from(itemMap.values()).sort((firstItem, secondItem) =>
    firstItem.name.localeCompare(secondItem.name, "es"),
  );
}

// Every stored item, including those deleted on this device and not yet in the account.
export function parseStoredPantryItems(value: unknown): PantryStorageItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(parseStoredItem).filter((item): item is PantryStorageItem => item !== null);
}

// Stored data (or none yet) -> the list shown, including the default base items.
export function pantryItemsOrDefault(value: unknown): PantryStorageItem[] {
  if (value === null || value === undefined) {
    return getLegacyPantryItems([]);
  }

  return parsePantryStorageItems(value);
}

export function normalizePantryItems(items: PantryStorageItem[]): PantryStorageItem[] {
  const itemMap = new Map<string, PantryStorageItem>();

  for (const item of items) {
    const normalizedItem = normalizePantryItem(item);

    if (!normalizedItem.name) {
      continue;
    }

    itemMap.set(pantryItemKey(normalizedItem), normalizedItem);
  }

  return Array.from(itemMap.values());
}

export function activePantryNames(items: PantryStorageItem[]): string[] {
  return items
    .filter((item) => item.active)
    .map((item) => normalizePantryItemName(item.name));
}

export function pantryHasItem(pantryItems: string[], itemName: string) {
  return pantryItems.includes(normalizePantryItemName(itemName));
}
