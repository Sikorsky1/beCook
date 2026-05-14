export type SupermarketCategory =
  | "frutería"
  | "carnicería"
  | "pescadería"
  | "lácteos"
  | "despensa"
  | "congelados"
  | "otros";

export const supermarketCategoryLabels: SupermarketCategory[] = [
  "frutería",
  "carnicería",
  "pescadería",
  "lácteos",
  "despensa",
  "congelados",
  "otros",
];

export type GeneratedShoppingListItem = {
  name: string;
  quantity: number;
  unit: string;
  category: SupermarketCategory;
};

export type GeneratedShoppingListResponse = {
  items: GeneratedShoppingListItem[];
};

export type ShoppingListItem = GeneratedShoppingListItem & {
  id: string;
};

export type ShoppingCategoryGroup = {
  category: SupermarketCategory;
  items: ShoppingListItem[];
};

export const generatedShoppingListSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "quantity", "unit", "category"],
        properties: {
          name: {
            type: "string",
          },
          quantity: {
            type: "number",
          },
          unit: {
            type: "string",
          },
          category: {
            type: "string",
            enum: supermarketCategoryLabels,
          },
        },
      },
    },
  },
} as const;

export function isGeneratedShoppingListResponse(
  value: unknown,
): value is GeneratedShoppingListResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const parsedValue = value as Partial<GeneratedShoppingListResponse>;

  if (!Array.isArray(parsedValue.items)) {
    return false;
  }

  return parsedValue.items.every((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }

    const parsedItem = item as Partial<GeneratedShoppingListItem>;

    return (
      typeof parsedItem.name === "string" &&
      typeof parsedItem.quantity === "number" &&
      Number.isFinite(parsedItem.quantity) &&
      parsedItem.quantity > 0 &&
      typeof parsedItem.unit === "string" &&
      typeof parsedItem.category === "string" &&
      supermarketCategoryLabels.includes(parsedItem.category as SupermarketCategory)
    );
  });
}

export function normalizeIngredientName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function normalizeDisplayText(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

function normalizeIngredientUnit(unit: string) {
  return normalizeDisplayText(unit).toLowerCase();
}

export function groupShoppingListItems(
  items: GeneratedShoppingListItem[],
): ShoppingCategoryGroup[] {
  const itemMap = new Map<string, GeneratedShoppingListItem>();

  for (const item of items) {
    const displayName = normalizeDisplayText(item.name);
    const displayUnit = normalizeDisplayText(item.unit);
    const normalizedName = normalizeIngredientName(item.name);
    const normalizedUnit = normalizeIngredientUnit(item.unit);

    if (!displayName || !displayUnit || !normalizedName || !normalizedUnit) {
      continue;
    }

    if (typeof item.quantity !== "number" || !Number.isFinite(item.quantity) || item.quantity <= 0) {
      continue;
    }

    const itemKey = `${item.category}-${normalizedName}-${normalizedUnit}`;
    const existingItem = itemMap.get(itemKey);

    if (existingItem) {
      itemMap.set(itemKey, {
        ...existingItem,
        quantity: existingItem.quantity + item.quantity,
      });
      continue;
    }

    itemMap.set(itemKey, {
      ...item,
      name: displayName,
      unit: displayUnit,
    });
  }

  return supermarketCategoryLabels
    .map((category) => {
      const categoryItems = Array.from(itemMap.values())
        .filter((item) => item.category === category)
        .map((item) => ({
          ...item,
          id: `${item.category}-${normalizeIngredientName(item.name)}-${normalizeIngredientUnit(item.unit)}`,
        }))
        .sort((firstItem, secondItem) =>
          firstItem.name.localeCompare(secondItem.name, "es"),
        );

      return {
        category,
        items: categoryItems,
      };
    })
    .filter((group) => group.items.length > 0);
}
