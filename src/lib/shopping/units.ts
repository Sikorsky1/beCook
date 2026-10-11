// Units and identity of a shopping item (C4, roadmap step 19).
// - Mass is kept in grams and volume in millilitres (kg ×1000; cl ×10, l ×1000); counts in «ud»
//   (ud, uds, unidad(es) or no unit). Spoons, cloves and pinches are grouped by name, never
//   converted. Volume and mass are never converted into each other.
// - A NULL quantity is «al gusto» (its own line, never added to a measured one).
// - kg and l are only how an amount is shown (from 1000 g / 1000 ml); what is stored stays in g/ml,
//   so the same ingredient keeps the same unit, the same key and the same visible line.
// The database compares amounts with the same table (public.shopping_quantity_base).
import { normalizeIngredientName, type SupermarketCategory } from "@/lib/shoppingList";

export const TASTE_UNIT = "al gusto";

// mass | volume | count | taste | unit:<grouped unit name>
export type ShoppingDimension = string;

export type ShoppingAmount = {
  dimension: ShoppingDimension;
  // In the dimension's base unit (g, ml, ud, or the grouped unit). null: «al gusto».
  quantity: number | null;
  // Unit stored with the item: g, ml, ud, al gusto, or the grouped unit (singular).
  unit: string;
};

const massFactors: Record<string, number> = {
  g: 1, gr: 1, grs: 1, gramo: 1, gramos: 1,
  kg: 1000, kgs: 1000, kilo: 1000, kilos: 1000, kilogramo: 1000, kilogramos: 1000,
};
const volumeFactors: Record<string, number> = {
  ml: 1, mililitro: 1, mililitros: 1, cl: 10, centilitro: 10, centilitros: 10,
  l: 1000, lt: 1000, litro: 1000, litros: 1000,
};
const countUnits = new Set(["", "u", "ud", "uds", "unidad", "unidades", "pieza", "piezas"]);
// Grouped by name, never converted (singular form → plural shown when there is more than one).
const groupedUnits: Record<string, string> = {
  cucharada: "cucharada", cucharadas: "cucharada", cda: "cucharada", cdas: "cucharada",
  cucharadita: "cucharadita", cucharaditas: "cucharadita", cdta: "cucharadita", cdtas: "cucharadita",
  diente: "diente", dientes: "diente",
  pizca: "pizca", pizcas: "pizca",
};
const groupedPlurals: Record<string, string> = {
  cucharada: "cucharadas", cucharadita: "cucharaditas", diente: "dientes", pizca: "pizcas",
};
// Half steps make sense for these; every other counted unit is bought whole.
const halfStepUnits = new Set(["cucharada", "cucharadita", "pizca"]);

function unitText(unit: string | null | undefined) {
  return normalizeIngredientName(unit ?? "").replace(/\.$/, "");
}

export function normalizeAmount(quantity: number | null | undefined, unit: string | null | undefined): ShoppingAmount {
  const text = unitText(unit);
  if (quantity === null || quantity === undefined || !Number.isFinite(quantity) || text === TASTE_UNIT) {
    return { dimension: "taste", quantity: null, unit: TASTE_UNIT };
  }
  if (text in massFactors) return { dimension: "mass", quantity: quantity * massFactors[text], unit: "g" };
  if (text in volumeFactors) return { dimension: "volume", quantity: quantity * volumeFactors[text], unit: "ml" };
  if (countUnits.has(text)) return { dimension: "count", quantity, unit: "ud" };
  const grouped = groupedUnits[text] ?? text;
  return { dimension: `unit:${grouped}`, quantity, unit: grouped };
}

// What is bought: whole grams, millilitres and units; half spoons and pinches.
export function roundShoppingQuantity(dimension: ShoppingDimension, quantity: number | null) {
  if (quantity === null) return null;
  const unit = dimension.startsWith("unit:") ? dimension.slice(5) : "";
  if (halfStepUnits.has(unit)) return Math.max(0.5, Math.ceil(quantity * 2 - 1e-6) / 2);
  return Math.max(1, Math.ceil(quantity - 1e-6));
}

const formatNumber = (value: number) => value.toLocaleString("es-ES", { maximumFractionDigits: 2 });

// «1,2 kg», «750 g», «2 dientes», «al gusto».
export function formatShoppingAmount(quantity: number | null, unit: string) {
  if (quantity === null) return TASTE_UNIT;
  const text = unitText(unit);
  if (text === "g" && quantity >= 1000) return `${formatNumber(quantity / 1000)} kg`;
  if (text === "ml" && quantity >= 1000) return `${formatNumber(quantity / 1000)} l`;
  const shown = quantity > 1 && groupedPlurals[text] ? groupedPlurals[text] : unit;
  return `${formatNumber(quantity)} ${shown}`;
}

// Simple Spanish plural: «tomates» → «tomate», «limones» → «limon», «nueces» → «nuez».
function singularWord(word: string) {
  if (word.length <= 3) return word;
  if (word.endsWith("ces")) return `${word.slice(0, -3)}z`;
  // «limones», «flores», «cereales»; not «verdes» or «hojaldres» (verde, hojaldre).
  if (/[aeiou][lrnj]es$/.test(word)) return word.slice(0, -2);
  if (/[aeiou]s$/.test(word)) return word.slice(0, -1);
  return word;
}

// Name as compared: no case, accents or extra spaces, simple plurals.
export function shoppingNameKey(name: string) {
  return normalizeIngredientName(name).split(" ").map(singularWord).join(" ");
}

// «category|normalised name|dimension»: one line per ingredient and kind of amount.
export function shoppingItemKey(category: SupermarketCategory, name: string, dimension: ShoppingDimension) {
  return `${category}|${shoppingNameKey(name)}|${dimension}`.slice(0, 200);
}

// Key of any stored item (rows made before C4 have none: it is computed with the same rules).
export function storedItemKey(item: { name: string; quantity: number | null; unit: string | null; category: SupermarketCategory; itemKey?: string | null }) {
  return item.itemKey || shoppingItemKey(item.category, item.name, normalizeAmount(item.quantity, item.unit).dimension);
}
