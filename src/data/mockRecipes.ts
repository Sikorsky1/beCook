import type { WeekDay } from "@/data/mockWeek";

export type SupermarketCategory =
  | "frutería"
  | "carnicería"
  | "pescadería"
  | "lácteos"
  | "despensa"
  | "otros";

export type RecipeIngredient = {
  name: string;
  quantity: number;
  unit: string;
  category: SupermarketCategory;
};

export type RecipeCatalog = Record<string, RecipeIngredient[]>;

export const supermarketCategoryLabels: SupermarketCategory[] = [
  "frutería",
  "carnicería",
  "pescadería",
  "lácteos",
  "despensa",
  "otros",
];

export const mockRecipeCatalog: RecipeCatalog = {
  "Salmón con calabacín": [
    { name: "Salmón", quantity: 2, unit: "lomos", category: "pescadería" },
    { name: "Calabacín", quantity: 2, unit: "uds", category: "frutería" },
    { name: "Limón", quantity: 1, unit: "ud", category: "frutería" },
    { name: "Aceite de oliva", quantity: 1, unit: "botella", category: "despensa" },
    { name: "Sal", quantity: 1, unit: "paquete", category: "despensa" },
    { name: "Pimienta", quantity: 1, unit: "bote", category: "despensa" },
  ],
  "Pollo con arroz y brócoli": [
    { name: "Pechuga de pollo", quantity: 2, unit: "uds", category: "carnicería" },
    { name: "Arroz", quantity: 300, unit: "g", category: "despensa" },
    { name: "Brócoli", quantity: 1, unit: "ud", category: "frutería" },
    { name: "Aceite de oliva", quantity: 1, unit: "botella", category: "despensa" },
  ],
  "Tortilla francesa con tomate": [
    { name: "Huevos", quantity: 4, unit: "uds", category: "lácteos" },
    { name: "Tomates", quantity: 2, unit: "uds", category: "frutería" },
    { name: "Sal", quantity: 1, unit: "paquete", category: "despensa" },
  ],
  "Lentejas estofadas con verduras": [
    { name: "Lentejas", quantity: 500, unit: "g", category: "despensa" },
    { name: "Zanahorias", quantity: 3, unit: "uds", category: "frutería" },
    { name: "Cebollas", quantity: 2, unit: "uds", category: "frutería" },
    { name: "Pimiento verde", quantity: 1, unit: "ud", category: "frutería" },
  ],
  "Crema de calabaza y tostadas": [
    { name: "Calabaza", quantity: 1, unit: "trozo", category: "frutería" },
    { name: "Patatas", quantity: 2, unit: "uds", category: "frutería" },
    { name: "Pan de molde", quantity: 1, unit: "paquete", category: "despensa" },
    { name: "Aceite de oliva", quantity: 1, unit: "botella", category: "despensa" },
  ],
  "Pasta integral con atún y espinacas": [
    { name: "Pasta integral", quantity: 400, unit: "g", category: "despensa" },
    { name: "Atún", quantity: 2, unit: "latas", category: "despensa" },
    { name: "Espinacas", quantity: 1, unit: "bolsa", category: "frutería" },
  ],
  "Albóndigas con puré de patata": [
    { name: "Albóndigas", quantity: 500, unit: "g", category: "carnicería" },
    { name: "Patatas", quantity: 4, unit: "uds", category: "frutería" },
    { name: "Leche", quantity: 1, unit: "brick", category: "lácteos" },
  ],
  "Ensalada césar con pollo": [
    { name: "Lechuga romana", quantity: 1, unit: "ud", category: "frutería" },
    { name: "Pechuga de pollo", quantity: 1, unit: "ud", category: "carnicería" },
    { name: "Queso parmesano", quantity: 1, unit: "cuña", category: "lácteos" },
    { name: "Picatostes", quantity: 1, unit: "bolsa", category: "despensa" },
    { name: "Mostaza", quantity: 1, unit: "bote", category: "despensa" },
  ],
  "Arroz salteado con verduras y gambas": [
    { name: "Arroz", quantity: 300, unit: "g", category: "despensa" },
    { name: "Gambas", quantity: 300, unit: "g", category: "pescadería" },
    { name: "Zanahorias", quantity: 2, unit: "uds", category: "frutería" },
    { name: "Guisantes", quantity: 1, unit: "bolsa", category: "otros" },
  ],
  "Pizza casera de verduras": [
    { name: "Base de pizza", quantity: 2, unit: "uds", category: "despensa" },
    { name: "Mozzarella", quantity: 2, unit: "bolas", category: "lácteos" },
    { name: "Champiñones", quantity: 250, unit: "g", category: "frutería" },
    { name: "Pimiento rojo", quantity: 1, unit: "ud", category: "frutería" },
    { name: "Ajo en polvo", quantity: 1, unit: "bote", category: "despensa" },
  ],
  "Paella de pollo y verduras": [
    { name: "Arroz", quantity: 400, unit: "g", category: "despensa" },
    { name: "Contramuslos de pollo", quantity: 4, unit: "uds", category: "carnicería" },
    { name: "Judías verdes", quantity: 250, unit: "g", category: "frutería" },
    { name: "Pimiento rojo", quantity: 1, unit: "ud", category: "frutería" },
    { name: "Aceite de oliva", quantity: 1, unit: "botella", category: "despensa" },
  ],
  "Sopa ligera con huevo cocido": [
    { name: "Caldo", quantity: 1, unit: "litro", category: "despensa" },
    { name: "Huevos", quantity: 4, unit: "uds", category: "lácteos" },
    { name: "Fideos finos", quantity: 1, unit: "paquete", category: "despensa" },
  ],
};

type StoredMealSlot =
  | WeekDay["lunch"]
  | {
      status?: string;
      dishName?: string;
    };

function getRecipeNameFromSlot(slot: StoredMealSlot): string | null {
  if (typeof slot === "string") {
    const recipeName = slot.trim();

    if (!recipeName || recipeName.toUpperCase() === "LIBRE") {
      return null;
    }

    return recipeName;
  }

  if (!slot || typeof slot !== "object") {
    return null;
  }

  if (slot.status === "free") {
    return null;
  }

  const recipeName = typeof slot.dishName === "string" ? slot.dishName.trim() : "";

  return recipeName || null;
}

export const mockRecipesFromWeek = (days: WeekDay[]) =>
  days
    .flatMap((day) => [day.lunch, day.dinner])
    .map((meal) => getRecipeNameFromSlot(meal))
    .filter((meal): meal is string => Boolean(meal));
