import { normalizeFood } from "@/lib/recipes/food-lexicon";
import { dishCarb, dishProtein, type NutritionPlan, type PlanCarb, type PlanProtein } from "@/lib/nutritionPlan";
import { isStarchyDish } from "./carbs";
import { dishGroups, isFish, isMeat, type DishGroup, type DishIngredients } from "./food-groups";

// The weekly rules of every menu (Sergio, 2026-10-24), the ones of his nutritionist's plan:
// - lunches: one day each of legume, rice, pasta and potato, always with meat or fish; one day red
//   meat, two white meat (pollo, pavo, conejo, cordero, lomo de cerdo), two blue fish and two white
//   fish; every lunch with a vegetable side;
// - dinners: two days white fish, two egg and two white meat;
// - the carbohydrates (legume, rice, pasta, potato, bread…) on the training days of the profile.
// They come before the AESAN frequencies (quotas.ts) and the menu types. When a week cannot keep
// them all, the generator keeps the week that breaks the fewest (ruleViolations).
// The proteins are counted as the plan counts them (dishProtein: «lomo de cerdo» and «cordero»
// are white meat; seafood is white fish).

export type MealRules = {
  proteins: Partial<Record<PlanProtein, number>>;
  carbs: Partial<Record<PlanCarb, number>>;
  vegetableSide: boolean;
};

export type MenuRules = { lunch: MealRules; dinner: MealRules };

export const defaultMenuRules: MenuRules = {
  lunch: {
    proteins: { red_meat: 1, white_meat: 2, blue_fish: 2, white_fish: 2 },
    carbs: { legume: 1, rice: 1, pasta: 1, potato: 1 },
    vegetableSide: true,
  },
  dinner: {
    proteins: { white_fish: 2, egg: 2, white_meat: 2 },
    carbs: {},
    vegetableSide: false,
  },
};

// A nutritionist's plan brings its own rules («Dos días a la semana: pescado azul»); a plan
// without lunch or dinner rules keeps the default ones for that meal.
export function rulesFromPlan(plan: NutritionPlan): MenuRules {
  const meal = (key: "lunch" | "dinner"): MealRules => {
    const rules = plan[key].rules;
    if (!rules.length) return defaultMenuRules[key];
    const proteins: MealRules["proteins"] = {};
    const carbs: MealRules["carbs"] = {};
    for (const rule of rules) {
      if (rule.carb) carbs[rule.carb] = (carbs[rule.carb] ?? 0) + rule.days;
      else if (rule.protein) proteins[rule.protein] = (proteins[rule.protein] ?? 0) + rule.days;
    }
    return { proteins, carbs, vegetableSide: key === "lunch" && plan.sides.length > 0 };
  };
  return { lunch: meal("lunch"), dinner: meal("dinner") };
}

// What the rules read of a dish.
export type RuleDish = {
  protein: PlanProtein | null;
  carb: PlanCarb | null;
  // Meat or fish, for «arroz + carne o pescado».
  meatOrFish: boolean;
  // Any carbohydrate: the four of the rules, bread, couscous, quinoa… (carbs.ts) or a legume.
  hydrate: boolean;
  vegetable: boolean;
};

const vegetableWords =
  /\b(verduras?|ensaladas?|judias verdes|calabacin(es)?|zanahorias?|brocoli|coliflor|setas|champinon(es)?|esparragos|trigueros|pimientos?|pisto|espinacas|acelgas|berenjenas?|tomates?|pepinos?|alcachofas?|escalivada|escalibada|parrillada|lechugas?|canonigos|rucula|calabaza|judias|guisantes|col|repollo|lombarda|kale|grelos|endibias?|menestra|pimientos|cherrys?|alcaparras|apio|hinojo|chirivia|nabo|remolacha|edamame|brotes|hojas verdes|mezclum|lechuga)\b/;
// In the recipe (not in the title), onion, garlic, leek and tomato sauce flavour; they make no side.
const notASide = /\b(cebollas?|cebolletas?|ajos?|puerros?|tomate (triturado|frito|concentrado)|salsa de tomate|perejil|cilantro|albahaca)\b/g;

const proteinOfGroups = (groups: DishGroup[], text: string): PlanProtein | null => {
  if (groups.includes("blue_fish")) return "blue_fish";
  if (groups.includes("white_fish") || groups.includes("seafood")) return "white_fish";
  if (groups.includes("poultry")) return "white_meat";
  if (groups.includes("red_meat")) return /\b(lomo|cordero|lechazo|cabrito)\b/.test(text) ? "white_meat" : "red_meat";
  if (groups.includes("egg")) return "egg";
  return null;
};

export function ruleDish(title: string, ingredients: DishIngredients | null = null): RuleDish {
  const main = (ingredients ?? []).filter((ingredient) => !ingredient.optional).map((ingredient) => ingredient.name);
  const groups = dishGroups(title, ingredients);
  const animal = groups.some((group) => isMeat(group) || isFish(group));
  const protein = (animal || groups.includes("egg") ? dishProtein(title) : null) ?? proteinOfGroups(groups, normalizeFood([title, ...main].join(" ")));
  const carb = dishCarb(title) ?? main.map(dishCarb).find(Boolean) ?? null;
  const vegetable =
    vegetableWords.test(normalizeFood(title)) ||
    main.some((name) => vegetableWords.test(normalizeFood(name).replace(notASide, " ")));
  return {
    protein,
    carb,
    meatOrFish: animal && groups.some((group) => group !== "processed_meat" && (isMeat(group) || isFish(group))),
    hydrate: carb !== null || groups.includes("legume") || isStarchyDish(title, ingredients),
    vegetable,
  };
}

// 0 = Monday … 6 = Sunday. Free dinners (the plan's «Libre») count for no rule.
export type RuleWeek = { lunch: (RuleDish | null)[]; dinner: (RuleDish | null)[] };

export type RuleBreakdown = {
  // Missing days of each protein or carbohydrate rule, per meal («lunch.blue_fish»: 1).
  missing: Record<string, number>;
  // Meals with a carbohydrate on a day without training.
  hydrateOffTraining: number;
  // Lunches without a vegetable side.
  noVegetable: number;
  total: number;
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export function ruleBreakdown(rules: MenuRules, week: RuleWeek, trainingWeekdays: number[]): RuleBreakdown {
  const missing: Record<string, number> = {};
  for (const meal of ["lunch", "dinner"] as const) {
    const dishes = week[meal].filter((dish): dish is RuleDish => dish !== null);
    for (const [protein, days] of Object.entries(rules[meal].proteins)) {
      const short = Math.max(0, (days ?? 0) - dishes.filter((dish) => dish.protein === protein).length);
      if (short) missing[`${meal}.${protein}`] = short;
    }
    for (const [carb, days] of Object.entries(rules[meal].carbs)) {
      const short = Math.max(0, (days ?? 0) - dishes.filter((dish) => dish.carb === carb && dish.meatOrFish).length);
      if (short) missing[`${meal}.${carb}`] = short;
    }
  }
  const training = new Set(trainingWeekdays);
  const hydrateOffTraining = training.size
    ? sum((["lunch", "dinner"] as const).map((meal) => week[meal].filter((dish, day) => dish?.hydrate && !training.has(day + 1)).length))
    : 0;
  const noVegetable = rules.lunch.vegetableSide ? week.lunch.filter((dish) => dish && !dish.vegetable).length : 0;
  return { missing, hydrateOffTraining, noVegetable, total: sum(Object.values(missing)) + hydrateOffTraining + noVegetable };
}

export const ruleViolations = (rules: MenuRules, week: RuleWeek, trainingWeekdays: number[]) => ruleBreakdown(rules, week, trainingWeekdays).total;

// The fewest rules any week can break: carbohydrate lunches beyond the training days.
export function minimumViolations(rules: MenuRules, trainingWeekdays: number[]) {
  if (!trainingWeekdays.length) return 0;
  return Math.max(0, sum(Object.values(rules.lunch.carbs).map((days) => days ?? 0)) - trainingWeekdays.length);
}

// The red meat days of the rules: never more red meat in the week (AESAN: one a week at most).
export const redMeatDays = (rules: MenuRules) => (rules.lunch.proteins.red_meat ?? 0) + (rules.dinner.proteins.red_meat ?? 0);
