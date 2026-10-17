// What the week's dishes need (C4, roadmap step 19). Pure: no network, no storage.
// - A dish with a card (C2) takes the card's ingredients scaled to the week's servings
//   (servings / card.baseServings). Optional ingredients are left out (and reported).
// - A catalogue dish without a card takes the ingredients of its catalogue recipe, scaled the same
//   way, without AI (N11). They are unreviewed drafts: «card_inferred», without a version.
// - A dish without a card takes the AI ingredients computed for that dish (already for the week's
//   servings): reused from the list's own origins, or from one breakdown call (data/shopping.ts).
// - A dish with neither is pending: the rest of the list is still built.
// - The pantry (B7) has no amounts: nothing is subtracted; it only changes how a line is shown.
import { getDayPosition } from "@/lib/isoWeek";
import { parseLeftover } from "@/lib/menu-generation/leftovers";
import { recipeTitleKey, type RecipeCard, type RecipeCardContent } from "@/lib/recipes/card";
import {
  dishOriginsOf,
  isCardOrigin,
  supermarketCategoryLabels,
  type ShoppingOrigin,
  type ShoppingRowOrigin,
  type ShoppingViewItem,
  type StoredShoppingItem,
  type SupermarketCategory,
} from "@/lib/shoppingList";
import type { WeekDay } from "@/data/mockWeek";

import {
  normalizeAmount,
  roundShoppingQuantity,
  shoppingItemKey,
  shoppingNameKey,
  type ShoppingDimension,
} from "./units";

export type MealKey = "lunch" | "dinner";

export type PlannedDish = {
  day: number;
  meal: MealKey;
  title: string;
  // recipeTitleKey of the title.
  dish: string;
  versionId: string | null;
  // Times it is eaten: 2 when a leftover of it is planned later in the week (N17).
  portions?: number;
  // A leftover («… (sobras del lunes)»): the dish key of its dish, planned the same week.
  leftoverOf?: string;
};

// An ingredient of one dish before it is added up (from a card or from the AI).
export type DishIngredient = {
  name: string;
  quantity: number | null;
  unit: string | null;
  category: SupermarketCategory;
};

// An item the dishes need: what the list should have for its key.
export type DesiredItem = Required<Pick<StoredShoppingItem, "name" | "quantity" | "unit" | "category">> & {
  itemKey: string;
  origins: ShoppingOrigin[];
};

export const slotKey = (day: number, meal: MealKey) => `${day}|${meal}`;

const meals: MealKey[] = ["lunch", "dinner"];

// Planned meals of a week (free meals and unknown days left out), in day order. A leftover
// («… (sobras del lunes)», N17) of a dish planned the same week is marked: when that dish has a
// recipe, it is bought once for both meals (portions 2) and the leftover adds nothing.
export function plannedDishes(days: WeekDay[]): PlannedDish[] {
  const all = days
    .flatMap((day) => {
      const position = getDayPosition(day.day);
      if (position === -1) return [];
      return meals.flatMap((meal) => {
        const title = day[meal].normalize("NFC").trim().replace(/\s+/g, " ");
        if (!title || title === "LIBRE") return [];
        const link = meal === "lunch" ? day.lunchRecipe : day.dinnerRecipe;
        return [{ day: position, meal, title, dish: recipeTitleKey(title), versionId: link?.versionId ?? null }];
      });
    })
    .sort((first, second) => first.day - second.day || meals.indexOf(first.meal) - meals.indexOf(second.meal));
  const leftovers = all.map((dish) => parseLeftover(dish.title));
  const bases = new Map<string, number>();
  for (const leftover of leftovers) if (leftover) bases.set(recipeTitleKey(leftover.base), (bases.get(recipeTitleKey(leftover.base)) ?? 0) + 1);
  return all.map((dish, index) => {
    const leftover = leftovers[index];
    const base = leftover ? recipeTitleKey(leftover.base) : null;
    if (base && all.some((other) => other.dish === base)) return { ...dish, leftoverOf: base };
    return bases.has(dish.dish) ? { ...dish, portions: 1 + (bases.get(dish.dish) ?? 0) } : dish;
  });
}

// Leftovers whose dish is bought with a recipe (card or catalogue): nothing to add or ask for.
export function leftoversCoveredBy(dishes: PlannedDish[], hasRecipe: (dish: PlannedDish) => boolean) {
  const withRecipe = new Set(dishes.filter((dish) => !dish.leftoverOf && hasRecipe(dish)).map((dish) => dish.dish));
  return new Set(dishes.filter((dish) => dish.leftoverOf && withRecipe.has(dish.leftoverOf)).map((dish) => slotKey(dish.day, dish.meal)));
}

type Contribution = {
  key: string;
  name: string;
  category: SupermarketCategory;
  dimension: ShoppingDimension;
  unit: string;
  quantity: number | null;
  origin: ShoppingOrigin;
};

const roundOrigin = (quantity: number | null) => (quantity === null ? null : Math.round(quantity * 100) / 100);

function contribution(dish: PlannedDish, ingredient: DishIngredient, kind: ShoppingOrigin["kind"], versionId?: string): Contribution | null {
  const name = ingredient.name.trim().replace(/\s+/g, " ");
  if (!name) return null;
  const amount = normalizeAmount(ingredient.quantity, ingredient.unit);
  return {
    key: shoppingItemKey(ingredient.category, name, amount.dimension),
    name,
    category: ingredient.category,
    dimension: amount.dimension,
    unit: amount.unit,
    quantity: amount.quantity,
    origin: {
      day: dish.day,
      meal: dish.meal,
      dish: dish.dish,
      kind,
      ...(versionId ? { versionId } : {}),
      quantity: roundOrigin(amount.quantity),
    },
  };
}

export type BuildInput = {
  dishes: PlannedDish[];
  servings: number;
  // Card versions that could be read, by version id.
  cards: Map<string, RecipeCard>;
  // AI ingredients of dishes without a card, by slotKey(day, meal).
  aiItems: Map<string, DishIngredient[]>;
  // Catalogue recipes of dishes without a card, by slotKey(day, meal) (N11).
  catalogCards?: Map<string, RecipeCardContent>;
};

export type BuildResult = {
  items: DesiredItem[];
  // Dishes whose ingredients are not known (no card, no AI answer).
  pending: PlannedDish[];
  // Optional card ingredients left out of the list.
  excludedOptional: { dish: string; name: string }[];
};

export function buildDesiredList({ dishes, servings, cards, aiItems, catalogCards = new Map() }: BuildInput): BuildResult {
  const contributions: Contribution[] = [];
  const pending: PlannedDish[] = [];
  const excludedOptional: BuildResult["excludedOptional"] = [];

  const recipeOf = (dish: PlannedDish) => (dish.versionId ? cards.get(dish.versionId) : undefined) ?? catalogCards.get(slotKey(dish.day, dish.meal));
  const coveredLeftovers = leftoversCoveredBy(dishes, (dish) => Boolean(recipeOf(dish)));

  for (const dish of dishes) {
    if (coveredLeftovers.has(slotKey(dish.day, dish.meal))) continue;
    const versioned = dish.versionId ? cards.get(dish.versionId) : undefined;
    const card = versioned ?? catalogCards.get(slotKey(dish.day, dish.meal));
    if (card) {
      // Portions only on this path: a dish without a recipe keeps its leftover as its own dish.
      const factor = (servings * (dish.portions ?? 1)) / card.baseServings;
      const kind = versioned?.reviewStatus === "reviewed" ? "card_reviewed" : "card_inferred";
      for (const ingredient of card.ingredients) {
        if (ingredient.optional) {
          excludedOptional.push({ dish: dish.title, name: ingredient.name });
          continue;
        }
        const scaled = { ...ingredient, quantity: ingredient.quantity === null ? null : ingredient.quantity * factor };
        const entry = contribution(dish, scaled, kind, versioned?.versionId);
        if (entry) contributions.push(entry);
      }
      continue;
    }
    const ai = aiItems.get(slotKey(dish.day, dish.meal));
    if (!ai) {
      pending.push(dish);
      continue;
    }
    // AI ingredients are kept as answered (they are reused from the list's origins, so scaling
    // them here would scale them again on every update).
    for (const ingredient of ai) {
      const entry = contribution(dish, ingredient, "ai_title");
      if (entry) contributions.push(entry);
    }
  }

  const byKey = new Map<string, Contribution[]>();
  for (const entry of contributions) (byKey.get(entry.key) ?? byKey.set(entry.key, []).get(entry.key)!).push(entry);

  const items = [...byKey.entries()].map(([itemKey, entries]): DesiredItem => {
    const [first] = entries;
    const measured = entries.filter((entry) => entry.quantity !== null);
    const total = measured.length ? measured.reduce((sum, entry) => sum + (entry.quantity as number), 0) : null;
    return {
      itemKey,
      name: first.name,
      quantity: roundShoppingQuantity(first.dimension, total),
      unit: first.unit,
      category: first.category,
      origins: entries.map((entry) => entry.origin),
    };
  });

  return { items: sortItems(items), pending, excludedOptional };
}

function sortItems<T extends { category: SupermarketCategory; name: string }>(items: T[]) {
  return [...items].sort(
    (first, second) =>
      supermarketCategoryLabels.indexOf(first.category) - supermarketCategoryLabels.indexOf(second.category) ||
      first.name.localeCompare(second.name, "es"),
  );
}

// AI ingredients the list already has for dishes without a card, from its own origins: the same
// day and meal, or the same dish elsewhere in the week (it moved). Only for lists made with origins
// for the same servings and restrictions (data/shopping.ts decides).
export function aiItemsFromList(items: StoredShoppingItem[], dishes: PlannedDish[]) {
  const bySlot = new Map<string, DishIngredient[]>();
  const byDish = new Map<string, { slot: string; items: DishIngredient[] }>();

  for (const item of items) {
    for (const origin of dishOriginsOf(item.origins)) {
      if (origin.kind !== "ai_title") continue;
      const slot = slotKey(origin.day, origin.meal);
      const ingredient: DishIngredient = { name: item.name, quantity: origin.quantity, unit: origin.quantity === null ? null : item.unit, category: item.category };
      const key = `${slot}|${origin.dish}`;
      (bySlot.get(key) ?? bySlot.set(key, []).get(key)!).push(ingredient);
      const known = byDish.get(origin.dish);
      if (!known) byDish.set(origin.dish, { slot, items: [ingredient] });
      else if (known.slot === slot) known.items.push(ingredient);
    }
  }

  const result = new Map<string, DishIngredient[]>();
  for (const dish of dishes) {
    if (dish.versionId) continue;
    const found = bySlot.get(`${slotKey(dish.day, dish.meal)}|${dish.dish}`) ?? byDish.get(dish.dish)?.items;
    if (found) result.set(slotKey(dish.day, dish.meal), found);
  }
  return result;
}

// Dishes whose ingredients are not in a list made with origins (an AI call failed or there was no
// quota when the list was updated). Lists without origins (before C4) are never reported.
export function pendingDishesOf(items: StoredShoppingItem[], dishes: PlannedDish[]) {
  const covered = new Set<string>();
  const fromCard = new Set<string>();
  for (const item of items) {
    for (const origin of dishOriginsOf(item.origins)) {
      covered.add(`${slotKey(origin.day, origin.meal)}|${origin.dish}`);
      if (isCardOrigin(origin)) fromCard.add(origin.dish);
    }
  }
  // A leftover of a dish bought from its recipe is covered by that dish (N17).
  return dishes.filter((dish) => !covered.has(`${slotKey(dish.day, dish.meal)}|${dish.dish}`) && !(dish.leftoverOf && fromCard.has(dish.leftoverOf)));
}

// --- How a line is shown (pantry and bought state) -------------------------------------------

export type ShoppingLineStatus = "to_buy" | "pantry" | "bought" | "bought_unneeded" | "review";

export const shoppingLineLabels: Record<ShoppingLineStatus, string> = {
  to_buy: "Te falta comprar",
  pantry: "Ya lo tienes habitualmente",
  bought: "Comprado",
  bought_unneeded: "Comprado, ya no hace falta",
  review: "Revisar",
};

// Pantry names compared like item names (no case, accents, extra spaces; simple plurals).
export function pantryNameKeys(pantryNames: string[]) {
  return new Set(pantryNames.map(shoppingNameKey));
}

// An item added by hand (D5) is never «usually at home»: the user asked for it explicitly.
export function classifyShoppingLine(
  item: Pick<ShoppingViewItem, "name" | "needsReview" | "removed"> & { manual?: boolean },
  checked: boolean,
  pantry: Set<string>,
): ShoppingLineStatus {
  if (checked && item.needsReview) return "review";
  if (checked && item.removed) return "bought_unneeded";
  if (checked) return "bought";
  if (!item.manual && pantry.has(shoppingNameKey(item.name))) return "pantry";
  return "to_buy";
}

// Lines grouped by status, in the order they are shown.
export function classifyShoppingView(items: ShoppingViewItem[], checkedIds: string[], pantryNames: string[]) {
  const checked = new Set(checkedIds);
  const pantry = pantryNameKeys(pantryNames);
  const groups: Record<ShoppingLineStatus, ShoppingViewItem[]> = { review: [], to_buy: [], pantry: [], bought: [], bought_unneeded: [] };
  for (const item of items) groups[classifyShoppingLine(item, checked.has(item.id), pantry)].push(item);
  return groups;
}

// «Lunes, comida: Lentejas» for the origin line of an item.
const dayLabels = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
export function describeOrigins(origins: ShoppingRowOrigin[], dishes: PlannedDish[]) {
  const titles = new Map(dishes.map((dish) => [`${slotKey(dish.day, dish.meal)}|${dish.dish}`, dish.title]));
  const names = dishOriginsOf(origins).map((origin) => titles.get(`${slotKey(origin.day, origin.meal)}|${origin.dish}`) ?? `${dayLabels[origin.day]} ${origin.meal === "lunch" ? "comida" : "cena"}`);
  return [...new Set(names)];
}
