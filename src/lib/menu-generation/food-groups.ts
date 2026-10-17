import { normalizeFood } from "@/lib/recipes/food-lexicon";

// Food groups of a dish as the AESAN 2022 weekly frequencies count them (N04): legumes, fish (blue,
// white, seafood), poultry and rabbit, red meat (beef, pork, lamb), processed meat and eggs. A dish
// may count for more than one group («Garbanzos con sepia»: legume and seafood). Read from the title
// and, when the title names no group, from the main ingredients of its catalogue recipe.
// Not the nutritionist's plan: that one keeps the categories of the plan itself (dishProtein in
// src/lib/nutritionPlan.ts, where «lomo de cerdo» and «cordero» are «carne blanca», as in the PDF).

export type DishGroup = "legume" | "blue_fish" | "white_fish" | "seafood" | "poultry" | "red_meat" | "processed_meat" | "egg";

export const dishGroupLabels: Record<DishGroup, string> = {
  legume: "legumbre",
  blue_fish: "pescado azul",
  white_fish: "pescado blanco",
  seafood: "marisco",
  poultry: "ave",
  red_meat: "carne roja",
  processed_meat: "carne procesada",
  egg: "huevo",
};

const fishGroups: DishGroup[] = ["blue_fish", "white_fish", "seafood"];
const meatGroups: DishGroup[] = ["poultry", "red_meat", "processed_meat"];

export const isFish = (group: DishGroup) => fishGroups.includes(group);
export const isMeat = (group: DishGroup) => meatGroups.includes(group);

// Words of normalizeFood text (lower case, no accents). «judias verdes», «salsa de soja» and stocks
// are removed before matching.
const groupWords: [DishGroup, RegExp][] = [
  ["processed_meat", /\b(jamon|chorizo|bacon|beicon|panceta|salchichas?|salchichon|longanizas?|fiambre|mortadela|sobrasada|morcilla|butifarra|cecina|lacon|guanciale|pancetta|pepperoni|frankfurt|lonchas de pavo|fiambre de pavo)\b/],
  ["poultry", /\b(pollo|pavo|conejo|codorniz|codornices|pato|pularda|picantones?|contramuslos?)\b/],
  ["red_meat", /\b(ternera|buey|vaca|cerdo|cordero|cabrito|lechazo|secreto|presa iberica|pluma iberica|carrillada|carrilleras?|costillas?|higado|entrecot|chuleton|rabo de toro|magro|boloñesa|bolonesa)\b/],
  ["blue_fish", /\b(atun|bonito|sardinas?|salmon|caballa|arenques?|anchoas?|boquerones?|jurel|chicharro|palometa|truchas?|salmonetes?|pez espada|emperador|ventresca|melva|cazon)\b/],
  ["white_fish", /\b(merluza|bacalao|gallo|lubina|lenguado|rape|rodaballo|dorada|doradas|pescadilla|abadejo|corvina|besugo|perca|tilapia|panga|mero|pargo|cabracho|bacaladilla|sargo|pescado blanco|pescado)\b/],
  ["seafood", /\b(sepia|calamar(es)?|chipirones|pulpo|gambas?|langostinos?|mejillones|almejas|chirlas|berberechos|navajas|vieiras|camarones|cangrejo|surimi|marisco|carabineros|cigalas)\b/],
  ["legume", /\b(lentejas?|garbanzos?|alubias?|judias|habichuelas|frijoles|fabes|fabada|verdinas|azukis?|edamame|tofu|tempeh|soja texturizada|hummus|falafel|legumbres|habas|habitas)\b/],
  ["egg", /\b(huevos?|tortilla|tortillas|revuelto|revueltos|claras|frittata|shakshuka|quiche)\b/],
];

// Cuts and preparations that name no animal: red meat only when no other animal group is named
// («Lomo de cerdo» → red meat; «Lomo de merluza», «Hamburguesas de atún» → fish).
const unnamedMeat = /\b(lomo|lomos|solomillo|hamburguesas?|albondigas|carne picada|carne)\b/;

function cleaned(text: string) {
  return normalizeFood(text)
    .replace(/\bjudias verdes\b/g, " ")
    .replace(/\b(salsa|leche|bebida|aceite) de soja\b/g, " ")
    .replace(/\btortillas? (de )?(trigo|maiz|harina|integral(es)?|mexicanas?)\b/g, " ")
    .replace(/\b(pasta|espaguetis|tallarines|fideos|tagliatelle) al huevo\b/g, " ")
    .replace(/\brevuelto de tofu\b/g, "tofu")
    .replace(/\b(caldo|fondo|fumet|pastilla|concentrado) de \w+( \w+)?\b/g, " ");
}

export function groupsInText(text: string): DishGroup[] {
  const value = cleaned(text);
  const groups = groupWords.filter(([, words]) => words.test(value)).map(([group]) => group);
  if (!groups.some((group) => isMeat(group) || isFish(group)) && unnamedMeat.test(value)) groups.push("red_meat");
  // «Albóndigas de berenjena y alubias»: the legume names the dish, «albóndigas» is no meat.
  if (groups.includes("red_meat") && groups.includes("legume") && !groupWords[2][1].test(value)) {
    return groups.filter((group) => group !== "red_meat");
  }
  return groups;
}

export type DishIngredients = { name: string; optional: boolean }[];

// The groups of a dish: its title, or the non-optional ingredients of its recipe when the title
// names none («Pipirrana» with tuna and egg).
export function dishGroups(title: string, ingredients: DishIngredients | null = null): DishGroup[] {
  const fromTitle = groupsInText(title);
  if (fromTitle.length || !ingredients) return fromTitle;
  return [...new Set(ingredients.filter((ingredient) => !ingredient.optional).flatMap((ingredient) => groupsInText(ingredient.name)))];
}

// The main group, for variety (not the same protein at lunch and dinner): the first animal one,
// fish grouped together, else legume, else egg.
export function mainProtein(groups: DishGroup[]): "fish" | "poultry" | "red_meat" | "processed_meat" | "legume" | "egg" | null {
  const animal = groups.find((group) => isMeat(group) || isFish(group));
  if (animal) return isFish(animal) ? "fish" : (animal as "poultry" | "red_meat" | "processed_meat");
  if (groups.includes("legume")) return "legume";
  if (groups.includes("egg")) return "egg";
  return null;
}

// Species AESAN advises children under 10 to avoid (mercury, N13).
export const highMercury = /\b(pez espada|emperador|atun rojo|tiburon|cazon|lucio|marrajo|tintorera)\b/;
