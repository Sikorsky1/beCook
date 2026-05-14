const PANTRY_STORAGE_KEY = "becook-pantry-base";

export function normalizePantryItemName(itemName: string) {
  return itemName.trim().toLowerCase();
}

export function readPantryBase(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  const savedPantryBase = window.localStorage.getItem(PANTRY_STORAGE_KEY);

  if (!savedPantryBase) {
    return [];
  }

  try {
    const pantryItems = JSON.parse(savedPantryBase);

    if (!Array.isArray(pantryItems)) {
      return [];
    }

    return pantryItems.map((item) => normalizePantryItemName(String(item)));
  } catch {
    return [];
  }
}

export function savePantryBase(items: string[]) {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedItems = items.map((item) => normalizePantryItemName(item));

  window.localStorage.setItem(
    PANTRY_STORAGE_KEY,
    JSON.stringify(normalizedItems),
  );
}

export function pantryHasItem(pantryItems: string[], itemName: string) {
  return pantryItems.includes(normalizePantryItemName(itemName));
}
