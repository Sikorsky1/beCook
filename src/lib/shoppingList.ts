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

// C4: which planned dish needs an item and how much (in the item's base unit; null: «al gusto»).
// day: position 0 (Monday) – 6; dish: the dish title key (recipeTitleKey).
export type ShoppingOriginKind = "card_reviewed" | "card_inferred" | "ai_title";

export type ShoppingOrigin = {
  day: number;
  meal: "lunch" | "dinner";
  dish: string;
  kind: ShoppingOriginKind;
  versionId?: string;
  quantity: number | null;
};

// An item as stored (account row or device copy). quantity null = «al gusto». itemKey and origins
// are absent on lists made before C4.
export type StoredShoppingItem = {
  name: string;
  quantity: number | null;
  unit: string;
  category: SupermarketCategory;
  itemKey?: string | null;
  origins?: ShoppingOrigin[] | null;
};

// One visible line of the list.
export type ShoppingViewItem = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string;
  category: SupermarketCategory;
  origins: ShoppingOrigin[];
  // Bought, but the dishes now need more than that.
  needsReview: boolean;
  // Bought, and no dish needs it any more.
  removed: boolean;
};

const originKinds = new Set<ShoppingOriginKind>(["card_reviewed", "card_inferred", "ai_title"]);

// Origins as read from the account (null: none recorded). Entries outside the shape are dropped.
export function parseShoppingOrigins(value: unknown): ShoppingOrigin[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { day, meal, dish, kind, versionId, quantity } = entry as Record<string, unknown>;
    if (!Number.isInteger(day) || (day as number) < 0 || (day as number) > 6) return [];
    if (meal !== "lunch" && meal !== "dinner") return [];
    if (typeof dish !== "string" || dish.length === 0 || dish.length > 200) return [];
    if (!originKinds.has(kind as ShoppingOriginKind)) return [];
    if (quantity !== null && (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 0)) return [];
    return [{
      day: day as number,
      meal,
      dish,
      kind: kind as ShoppingOriginKind,
      ...(typeof versionId === "string" ? { versionId } : {}),
      quantity: quantity as number | null,
    }];
  });
}

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

// Visible identity of an item: the same ingredient and unit in one category is one line.
export function getShoppingItemId(item: Pick<GeneratedShoppingListItem, "name" | "unit" | "category">) {
  return `${item.category}-${normalizeIngredientName(item.name)}-${normalizeIngredientUnit(item.unit)}`;
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
          id: getShoppingItemId(item),
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

// C4: the AI answer per dish (/api/generate-shopping-list with breakdown: true). day is the day name
// sent in the week; only planned meals of that week are kept by the route.
export type GeneratedShoppingDish = {
  day: string;
  meal: "lunch" | "dinner";
  items: GeneratedShoppingListItem[];
};

export const generatedShoppingBreakdownSchema = {
  type: "object",
  additionalProperties: false,
  required: ["dishes"],
  properties: {
    dishes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["day", "meal", "items"],
        properties: {
          day: { type: "string" },
          meal: { type: "string", enum: ["lunch", "dinner"] },
          items: generatedShoppingListSchema.properties.items,
        },
      },
    },
  },
} as const;

export function isGeneratedShoppingBreakdown(value: unknown): value is { dishes: GeneratedShoppingDish[] } {
  if (!value || typeof value !== "object" || !Array.isArray((value as { dishes?: unknown }).dishes)) return false;
  return (value as { dishes: unknown[] }).dishes.every((dish) => {
    if (!dish || typeof dish !== "object") return false;
    const { day, meal, items } = dish as Record<string, unknown>;
    return typeof day === "string" && (meal === "lunch" || meal === "dinner") && isGeneratedShoppingListResponse({ items });
  });
}
