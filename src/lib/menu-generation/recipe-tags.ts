import { normalizeFood } from "@/lib/recipes/food-lexicon";
import { dishGroups, highMercury, type DishGroup } from "./food-groups";

// Nutritional tags of a catalogue recipe (N07), computed from its card for two people and kept in
// src/data/recipe-cards/catalog-tags.json (scripts/build-catalog-tags.cjs). Estimates for planning,
// not nutrition facts: unit weights are approximate («1 ud de calabacín» ≈ 250 g) and the tags are
// pending review like the recipes themselves.

export type Starch = "wholegrain" | "refined" | "potato" | null;

export type RecipeTags = {
  groups: DishGroup[];
  // Grams of vegetables per person (not potato, garlic, herbs or fruit).
  vegGrams: number;
  starch: Starch;
  // ≥ 50 g of fruit per person.
  fruit: boolean;
  nuts: boolean;
  // A probably ultra-processed ingredient (NOVA 4): sliced bread, wheat tortillas, sausages, mayonnaise…
  upf: boolean;
  // Months (1–12) the main vegetable is in season in Spain; [] when it has none or is year-round.
  season: number[];
  // 1 cheap, 2 normal, 3 expensive (by its main protein).
  cost: 1 | 2 | 3;
  mercury: boolean;
  minutes: number | null;
  // The main animal species or legume («salmon», «pollo», «garbanzo»), for variety.
  species: string | null;
};

type Ingredient = { name: string; quantity: number | null; unit: string | null; category: string; optional: boolean };
export type TagCard = { baseServings: number; totalMinutes: number | null; ingredients: Ingredient[] };

// Approximate grams of one unit («ud») of a vegetable or fruit.
const unitWeights: [RegExp, number][] = [
  [/tomates? cherry|cherry/, 15],
  [/rabanit|rabano/, 15],
  [/coliflor|lombarda|repollo|\bcol\b|melon|sandia|pina/, 800],
  [/brocoli|lechuga|calabaza|berenjena|pepino|calabacin|mango/, 300],
  [/pimiento|boniato|batata|patata|naranja|manzana|pera|aguacate|hinojo/, 180],
  [/cebolla|tomate|alcachofa|puerro|kiwi|melocoton/, 140],
  [/zanahoria|cebolleta|chalota|platano|limon|lima/, 90],
];

const notVegetables = /\b(ajo|ajos|perejil|cilantro|albahaca|eneldo|tomillo|romero|menta|hierbabuena|cebollino|salvia|estragon|jengibre|guindilla|limon|lima|zumo|patata|patatas|boniato|boniatos|batata|finas hierbas|hojas de laurel)\b/;
const fruitWords = /\b(manzana|pera|naranja|mandarina|fresas?|uvas?|pina|mango|platano|melocoton|higos?|granada|frambuesas|arandanos|moras|kiwi|melon|sandia|cerezas|albaricoques?|ciruelas?|frutos rojos)\b/;
const nutWords = /\b(nueces|nuez(?! moscada)|almendras?|avellanas?|pistachos?|anacardos?|pinones|cacahuetes?|semillas de (calabaza|girasol|chia|lino)|sesamo|frutos secos)\b/;
const upfWords = /\b(pan de molde|tortillas? de trigo|tortillas? mexicanas?|wraps?|chorizo|bacon|beicon|salchichas?|fiambre|mortadela|mayonesa|ketchup|salsa barbacoa|surimi|palitos de cangrejo|nuggets?|pan de hamburguesa|pan de perrito|lonchas de pavo|queso en lonchas|nata para cocinar)\b/;
const wholegrainWords = /\b(integral(es)?|quinoa|avena|trigo sarraceno|cebada|espelta|bulgur|mijo)\b/;
const refinedWords = /\b(pasta|espaguetis|macarrones|tallarines|fideos|noodles|arroz|cuscus|pan|tortillas? de trigo|harina|lasana|canelones|ñoquis|noquis|gnocchi|tortellini|penne|fusilli|orzo|pizza|hojaldre|masa)\b/;
const potatoWords = /\b(patatas?|boniatos?|batatas?)\b/;

// Months in season in Spain (MAPA calendar, rounded), for the main vegetable of a recipe.
const seasons: [RegExp, number[]][] = [
  [/esparrago/, [3, 4, 5, 6]],
  [/alcachofa/, [1, 2, 3, 4, 5, 10, 11, 12]],
  [/calabacin/, [5, 6, 7, 8, 9, 10]],
  [/berenjena/, [6, 7, 8, 9, 10]],
  [/tomate/, [6, 7, 8, 9, 10]],
  [/pimiento/, [6, 7, 8, 9, 10, 11]],
  [/pepino/, [5, 6, 7, 8, 9]],
  [/judias verdes/, [5, 6, 7, 8, 9, 10]],
  [/calabaza/, [9, 10, 11, 12, 1, 2]],
  [/coliflor|brocoli|bimi|repollo|lombarda|\bcol\b|coles de bruselas|kale/, [10, 11, 12, 1, 2, 3]],
  [/espinaca|acelga|canonigos|rucula|berros/, [10, 11, 12, 1, 2, 3, 4, 5]],
  [/puerro/, [10, 11, 12, 1, 2, 3, 4]],
  [/setas|boletus|champinon|shiitake/, [9, 10, 11, 12]],
  [/guisantes|habas/, [2, 3, 4, 5]],
  [/lechuga|escarola/, [10, 11, 12, 1, 2, 3, 4, 5]],
  [/remolacha|nabo|chirivia/, [10, 11, 12, 1, 2, 3]],
];

const expensive = /\b(salmon|rape|rodaballo|lubina|dorada|lenguado|bonito|atun fresco|atun rojo|langostinos?|gambas?|carabineros|vieiras|pulpo|solomillo|entrecot|chuleton|cordero|pato|bacalao fresco|pez espada|emperador)\b/;
const cheap = /\b(lentejas?|garbanzos?|alubias?|judias|huevos?|tortilla|sardinas?|caballa|jurel|boqueron|pollo|pavo|tofu|soja texturizada|atun en lata|atun|conserva)\b/;
const speciesWords = /\b(salmon|atun|bonito|sardinas?|caballa|merluza|bacalao|lubina|dorada|rape|gallo|lenguado|sepia|calamar(es)?|pulpo|gambas?|langostinos?|mejillones|pollo|pavo|conejo|ternera|cerdo|cordero|lentejas?|garbanzos?|alubias?|tofu|huevos?)\b/;

const singular = (word: string) => word.replace(/(es|s)$/, "").replace(/^calamar$/, "calamar");

function grams(ingredient: Ingredient): number {
  const { quantity, unit } = ingredient;
  if (quantity === null) return 0;
  const name = normalizeFood(ingredient.name);
  switch (unit) {
    case "g":
      return quantity;
    case "ml":
      return quantity;
    case "ud":
    case "unidades":
      return quantity * (unitWeights.find(([words]) => words.test(name))?.[1] ?? 100);
    case "hojas":
      return quantity * 5;
    case "manojo":
    case "manojos":
      return quantity * 100;
    case "lata":
    case "latas":
      return quantity * 250;
    default:
      return 0;
  }
}

export function recipeTags(title: string, card: TagCard): RecipeTags {
  const people = card.baseServings || 2;
  const used = card.ingredients.filter((ingredient) => !ingredient.optional);
  const names = used.map((ingredient) => normalizeFood(ingredient.name));
  const all = [normalizeFood(title), ...names].join(" | ");
  let vegGrams = 0;
  let fruitGrams = 0;
  let mainVeg: { name: string; grams: number } | null = null;
  for (const ingredient of used) {
    if (ingredient.category !== "frutería" && ingredient.category !== "congelados") continue;
    const name = normalizeFood(ingredient.name);
    const weight = grams(ingredient);
    if (fruitWords.test(name)) fruitGrams += weight;
    else if (!notVegetables.test(name)) {
      vegGrams += weight;
      if (!mainVeg || weight > mainVeg.grams) mainVeg = { name, grams: weight };
    }
  }
  const starchText = names.join(" | ");
  const starch: Starch = wholegrainWords.test(starchText)
    ? "wholegrain"
    : refinedWords.test(starchText.replace(/pan rallado/g, ""))
      ? "refined"
      : potatoWords.test(starchText)
        ? "potato"
        : null;
  const groups = dishGroups(title, used);
  const species = all.match(speciesWords)?.[0] ?? null;
  return {
    groups,
    vegGrams: Math.round(vegGrams / people),
    starch,
    fruit: fruitGrams / people >= 50,
    nuts: nutWords.test(starchText),
    upf: upfWords.test(all),
    season: (mainVeg && seasons.find(([words]) => words.test(mainVeg.name))?.[1]) ?? [],
    cost: expensive.test(all) ? 3 : cheap.test(normalizeFood(title)) ? 1 : 2,
    mercury: highMercury.test(all),
    minutes: card.totalMinutes,
    species: species ? singular(species) : null,
  };
}

// How to complete the plate (N12, Harvard plate and AESAN: half vegetables, a quarter wholegrain):
// short suggestions for a recipe that lacks vegetables or a starch, or whose starch is refined.
export function plateSuggestions(tags: RecipeTags): string[] {
  const suggestions: string[] = [];
  const hasLegume = tags.groups.includes("legume");
  if (tags.vegGrams < 100) suggestions.push("Acompáñalo con una ensalada o una ración de verdura.");
  if (!tags.starch && !hasLegume) suggestions.push("Añade pan integral o una patata cocida.");
  if (tags.starch === "refined") suggestions.push("Si usas pasta, arroz o pan, puedes elegir la versión integral.");
  if (!tags.fruit) suggestions.push("De postre, una pieza de fruta de temporada.");
  return suggestions;
}
