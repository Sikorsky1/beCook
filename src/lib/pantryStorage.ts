import { pantryBaseItems } from "@/data/mockPantry";

const PANTRY_STORAGE_KEY = "becook-pantry-base";

export type PantryCategory =
  | "básicos"
  | "especias"
  | "aceites y vinagres"
  | "salsas"
  | "conservas"
  | "congelados"
  | "otros";
type LegacyPantryCategory = PantryCategory;

export type PantryStorageItem = {
  name: string;
  category: PantryCategory;
  active: boolean;
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
  return {
    name: capitalizePantryItemName(item.name),
    category: item.category,
    active: item.active,
  };
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

function parsePantryStorageItems(value: unknown): PantryStorageItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  if (value.every((item) => typeof item === "string")) {
    return getLegacyPantryItems(value.map((item) => String(item)));
  }

  const itemMap = new Map<string, PantryStorageItem>();

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const parsedItem = item as Partial<PantryStorageItem>;
    const name =
      typeof parsedItem.name === "string"
        ? capitalizePantryItemName(parsedItem.name)
        : "";

    if (!name || !isPantryCategory(parsedItem.category)) {
      continue;
    }

    const category = parsedItem.category;

    itemMap.set(`${category}:${normalizePantryItemName(name)}`, {
      name,
      category,
      active: parsedItem.active !== false,
    });
  }

  return Array.from(itemMap.values()).sort((firstItem, secondItem) =>
    firstItem.name.localeCompare(secondItem.name, "es"),
  );
}

export function readPantryItems(): PantryStorageItem[] {
  if (typeof window === "undefined") {
    return [];
  }

  const savedPantryBase = window.localStorage.getItem(PANTRY_STORAGE_KEY);

  if (!savedPantryBase) {
    return getLegacyPantryItems([]);
  }

  try {
    return parsePantryStorageItems(JSON.parse(savedPantryBase));
  } catch {
    return getLegacyPantryItems([]);
  }
}

export function savePantryItems(items: PantryStorageItem[]) {
  if (typeof window === "undefined") {
    return;
  }

  const itemMap = new Map<string, PantryStorageItem>();

  for (const item of items) {
    const normalizedItem = normalizePantryItem(item);

    if (!normalizedItem.name) {
      continue;
    }

    itemMap.set(
      `${normalizedItem.category}:${normalizePantryItemName(normalizedItem.name)}`,
      normalizedItem,
    );
  }

  window.localStorage.setItem(
    PANTRY_STORAGE_KEY,
    JSON.stringify(Array.from(itemMap.values())),
  );
}

export function readPantryBase(): string[] {
  return readPantryItems()
    .filter((item) => item.active)
    .map((item) => normalizePantryItemName(item.name));
}

export function savePantryBase(items: string[]) {
  savePantryItems(
    getLegacyPantryItems(items.map((item) => normalizePantryItemName(item))),
  );
}

export function pantryHasItem(pantryItems: string[], itemName: string) {
  return pantryItems.includes(normalizePantryItemName(itemName));
}
