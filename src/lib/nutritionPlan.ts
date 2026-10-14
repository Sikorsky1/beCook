import catalog from "@/data/nutritionist-recipes.json";
import type { ImportedMenuDay } from "@/lib/importMenu";
import type { SupermarketCategory } from "@/lib/shoppingList";

// A nutritionist's plan (the Vitalitty PDF and plans written the same way) instead of a weekly
// menu: options for breakfast, mid-morning and snack, and for lunch and dinner only rules («Un día
// a la semana: arroz + carne o pescado», «Dos días a la semana: pescado azul (atún, sardinas…)»)
// with a few examples. Read on the device, without the AI:
// - parseNutritionPlan turns the text (as the PDF reader or a paste gives it) into the plan;
// - generatePlanWeek picks seven lunches and dinners that keep the rules, from the plan's examples,
//   the catalogue (src/data/nutritionist-recipes.json) and similar ideas below;
// - planDailyMeals rotates the options day by day (option 1 on Monday, 2 on Tuesday, 3 on
//   Wednesday, 1 again on Thursday…) and planShoppingItems adds up what they need for the week.
// Pure: no network, no storage.

export type PlanProtein = "red_meat" | "white_meat" | "blue_fish" | "white_fish" | "egg";
export type PlanCarb = "legume" | "rice" | "pasta" | "potato";

// «Un día a la semana: arroz + carne o pescado» is { days 1, carb rice }; «Dos días a la semana:
// Carne blanca (pollo, pavo…)» is { days 2, protein white_meat, examples [pollo, pavo…] }.
export type PlanRule = { days: number; protein: PlanProtein | null; carb: PlanCarb | null; examples: string[] };

export type PlanMealRules = { rules: PlanRule[]; examples: string[] };

export type PlanOption = { text: string; fillings: string[] };

export type NutritionPlan = {
  breakfast: PlanOption[];
  midMorning: PlanOption[];
  snack: PlanOption[];
  bedtime: PlanOption[];
  lunch: PlanMealRules;
  dinner: PlanMealRules;
  // The vegetable side every lunch and dinner takes («ensalada mixta, salteado de verduras…»).
  sides: string[];
  // «Evitar: … En cenas: carne roja».
  noRedMeatAtDinner: boolean;
};

export type PlanDailyMealKey = "breakfast" | "midMorning" | "snack" | "bedtime";

export const planDailyMealLabels: Record<PlanDailyMealKey, string> = {
  breakfast: "Desayuno",
  midMorning: "Media mañana",
  snack: "Merienda",
  bedtime: "Antes de dormir",
};

// What one day eats apart from lunch and dinner: the option text and its number (1-based).
export type PlanDailyMeal = { meal: PlanDailyMealKey; option: number; options: number; text: string };

export type PlanShoppingItem = { name: string; quantity: number; unit: "g" | "ml" | "ud"; category: SupermarketCategory };

// What travels with the imported menu: the day-by-day meals (shown before using the menu) and what
// they need for the week (added to the shopping list when the menu is used).
export type PlanExtras = {
  days: { dayName: ImportedMenuDay["dayName"]; meals: PlanDailyMeal[] }[];
  items: PlanShoppingItem[];
};

const dayNames: ImportedMenuDay["dayName"][] = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

export function normalizePlanText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// --- Reading the plan ---------------------------------------------------------------------------

type Section =
  | "breakfast"
  | "midMorning"
  | "snack"
  | "bedtime"
  | "lunch"
  | "dinner"
  | "training"
  | "other";

const sectionHeaders: Record<string, Section> = {
  desayuno: "breakfast",
  "media manana": "midMorning",
  "a media manana": "midMorning",
  merienda: "snack",
  "antes de dormir": "bedtime",
  recena: "bedtime",
  comida: "lunch",
  almuerzo: "lunch",
  cena: "dinner",
  "pre-entreno": "training",
  "pre entreno": "training",
  "post-entreno": "training",
  "post entreno": "training",
  "plan nutricional": "other",
  observaciones: "other",
  alimentos: "other",
  evitar: "other",
  habitos: "other",
  "si entrenamos": "other",
  "si no entrenamos": "other",
};

function headerOf(line: string): Section | null {
  const key = normalizePlanText(line).replace(/^[-–•▪o]\s+/, "").replace(/[:.\s]+$/, "");
  return sectionHeaders[key] ?? null;
}

// A line that starts something new: a list marker, «Opción 2:», «Día 3:», a header, or a capital.
// Anything else (it starts in lower case) continues the line above, as the PDF wraps long lines.
function startsNewLine(line: string) {
  return !/^\p{Ll}/u.test(line) || /^o\s+\p{Lu}/u.test(line);
}

function joinWrappedLines(text: string) {
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\t+/g, " ").replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (lines.length && !startsNewLine(line) && !headerOf(line)) lines[lines.length - 1] += ` ${line}`;
    else lines.push(line);
  }
  return lines;
}

const countWords: Record<string, number> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7 };

const ruleLine = /^[-–•▪]?\s*(un|uno|una|dos|tres|cuatro|cinco|seis|siete|\d)\s+dias?\s+(?:a|por|de)\s+la\s+semana\s*:\s*(.+)$/;

function classifyCarb(text: string): PlanCarb | null {
  if (/\b(legumbres?|lentejas?|garbanzos?|alubias?|judion(es)?|judias blancas|fabes)\b/.test(text)) return "legume";
  if (/\b(arroz|paella|risotto)\b/.test(text)) return "rice";
  if (/\b(pasta|espaguetis?|macarrones|tallarines|fideos?|fideua|lasana)\b/.test(text)) return "pasta";
  if (/\b(patatas?|batatas?)\b/.test(text)) return "potato";
  return null;
}

function ruleProtein(text: string): PlanProtein | null {
  if (/\bcarnes? rojas?\b/.test(text)) return "red_meat";
  if (/\bcarnes? blancas?\b/.test(text)) return "white_meat";
  if (/\bpescados? azul(es)?\b/.test(text)) return "blue_fish";
  if (/\bpescados? blancos?\b/.test(text)) return "white_fish";
  if (/\b(huevos?|tortillas?)\b/.test(text)) return "egg";
  return null;
}

function parenExamples(text: string) {
  const inside = text.match(/\(([^)]*)\)/)?.[1] ?? "";
  return inside
    .split(/,|\s+y\s+/)
    .map((part) => part.replace(/(\.{3}|…)?\s*etc\.?/g, "").replace(/[.…]+$/, "").trim())
    .filter((part) => part.length > 1);
}

function parseRule(line: string): PlanRule | null {
  const match = normalizePlanText(line).match(ruleLine);
  if (!match) return null;
  const days = countWords[match[1]] ?? Number(match[1]);
  const body = match[2];
  const carb = classifyCarb(body.replace(/\(.*\)/, ""));
  // «arroz + carne o pescado»: the carbohydrate decides; any meat or fish goes with it.
  const protein = carb && /\+/.test(body) ? null : ruleProtein(body);
  if (!carb && !protein) return null;
  return { days, protein, carb, examples: parenExamples(body) };
}

const optionLine = /^opcion\s*\d+\s*[:.)-]\s*(.+)$/;
const exampleLine = /^dia\s*([1-7])\s*[:.)-]\s*(.+)$/;

// «Todos los días acompañaremos nuestra comida con una guarnición de verdura: ensalada mixta, …».
function parseSides(line: string) {
  const normalized = normalizePlanText(line);
  if (!/guarnicion|acompanaremos/.test(normalized) || !line.includes(":")) return null;
  return line
    .slice(line.indexOf(":") + 1)
    .split(",")
    .map((side) => side.replace(/[.;]+$/, "").trim())
    .filter(Boolean);
}

function withoutMarker(line: string) {
  return line.replace(/^[-–•▪]\s*/, "").trim();
}

export function parseNutritionPlan(text: string): NutritionPlan | null {
  const plan: NutritionPlan = {
    breakfast: [],
    midMorning: [],
    snack: [],
    bedtime: [],
    lunch: { rules: [], examples: [] },
    dinner: { rules: [], examples: [] },
    sides: [],
    noRedMeatAtDinner: false,
  };
  let section: Section | null = null;
  // «Yogur proteico + (elegir entre):» then «- 250gr de fruta»…: one option per choice.
  let snackBase: string | null = null;
  // Examples of a meal may come after its own header and before the next one.
  const examples: Record<"lunch" | "dinner", Map<number, string>> = { lunch: new Map(), dinner: new Map() };

  for (const line of joinWrappedLines(text)) {
    const header = headerOf(line);
    if (header) {
      section = header;
      snackBase = null;
      continue;
    }
    const normalized = normalizePlanText(line);

    if (/en cenas\s*:?\s*carnes? rojas?/.test(normalized)) plan.noRedMeatAtDinner = true;
    if (!section || section === "training" || section === "other") continue;

    if (section === "lunch" || section === "dinner") {
      const sides = parseSides(line);
      if (sides) {
        if (!plan.sides.length) plan.sides = sides;
        continue;
      }
      const rule = parseRule(line);
      if (rule) {
        plan[section].rules.push(rule);
        continue;
      }
      const example = withoutMarker(line).match(/^d[ií]a\s*([1-7])\s*[:.)-]\s*(.+)$/i);
      if (example && exampleLine.test(normalizePlanText(withoutMarker(line)))) {
        examples[section].set(Number(example[1]), example[2].trim());
      }
      continue;
    }

    const options = plan[section];
    const option = withoutMarker(line).match(/^opci[oó]n\s*\d+\s*[:.)-]\s*(.+)$/i);
    if (option && optionLine.test(normalizePlanText(withoutMarker(line)))) {
      options.push({ text: option[1].trim(), fillings: [] });
      continue;
    }

    // «- Podrá ser de: pavo y queso, jamón y tomate, atún y pimientos, etc.» under an option.
    const fillings = normalized.match(/^[-–•▪]?\s*podra ser de\s*:\s*(.+)$/);
    if (fillings && options.length) {
      const raw = withoutMarker(line).slice(withoutMarker(line).indexOf(":") + 1);
      options[options.length - 1].fillings = raw
        .split(",")
        .map((part) => part.replace(/(\.{3}|…)?\s*etc\.?/gi, "").replace(/[.…]+$/, "").trim())
        .filter(Boolean);
      continue;
    }

    const base = line.match(/^(.+?)\s*\+\s*\(?\s*elegir entre\s*\)?\s*:?\s*$/i);
    if (base) {
      snackBase = base[1].trim();
      continue;
    }

    if (snackBase && /^[-–•▪]/.test(line)) {
      options.push({ text: `${snackBase} + ${withoutMarker(line)}`, fillings: [] });
      continue;
    }

    // A meal with one way of eating it («Lácteo desnatado (250ml) + 20gr de whey»).
    if (!options.length && !/^[-–•▪]/.test(line)) options.push({ text: line, fillings: [] });
  }

  for (const meal of ["lunch", "dinner"] as const) {
    plan[meal].examples = [...examples[meal].entries()].sort(([a], [b]) => a - b).map(([, dish]) => dish);
  }

  // A plan has rules for lunch or dinner and options for the rest of the day.
  const rules = plan.lunch.rules.length + plan.dinner.rules.length;
  const dailyOptions = plan.breakfast.length + plan.midMorning.length + plan.snack.length;
  return rules >= 3 && dailyOptions >= 1 ? plan : null;
}

export function isNutritionPlanText(text: string) {
  return parseNutritionPlan(text) !== null;
}

// --- Dishes -------------------------------------------------------------------------------------

const proteinWords: [PlanProtein, RegExp][] = [
  [
    "blue_fish",
    /\b(atun|bonito|sardinas?|salmon|caballa|arenques?|anchoas?|boquerones?|cazon|pez espada|emperador|salmonetes?|ventresca|trucha)\b/,
  ],
  [
    "white_fish",
    /\b(merluza|bacalao|panga|gallo|sepia|lubina|lenguado|rape|rodaballo|dorada|calamar(es)?|pulpo|gambas?|langostinos?|mejillones|chirlas|almejas|pescadilla|abadejo|corvina|pescado blanco)\b/,
  ],
  ["white_meat", /\b(pollo|pavo|conejo|lomo|cinta de lomo|cordero|codorniz)\b/],
  ["red_meat", /\b(ternera|buey|vaca|hamburguesas?|entrecot|solomillo|chuleton|carrillada|boloñesa|bolonesa|carne picada)\b/],
  ["egg", /\b(huevos?|tortilla|revuelto)\b/],
];

const vegetableWords =
  /\b(verduras?|ensaladas?|judias verdes|calabacin|zanahorias?|brocoli|coliflor|setas|champinon(es)?|esparragos|trigueros|pimientos?|pisto|espinacas|acelgas|berenjenas?|tomates?|pepino|alcachofas?|escalibada|parrillada|lechuga|canonigos|cebolla|puerro|calabaza|judias)\b/;

// Fried, battered or processed dishes are out (Evitar: alimentos fritos o rebozados, procesados).
const avoidedWords = /\b(frit[oa]s?|rebozad[oa]s?|empanad[oa]s?|tosta|tostas|jamon|pizza|croquetas?)\b/;

export function dishProtein(title: string): PlanProtein | null {
  const text = normalizePlanText(title);
  return proteinWords.find(([, words]) => words.test(text))?.[0] ?? null;
}

export function dishCarb(title: string): PlanCarb | null {
  return classifyCarb(normalizePlanText(title).replace(/judias verdes/g, ""));
}

const hasVegetable = (title: string) => vegetableWords.test(normalizePlanText(title));

// Similar ideas to the plan's examples, for weeks where the examples and the catalogue fall short.
const ideas: { title: string; meals: ("lunch" | "dinner")[] }[] = [
  { title: "Lentejas estofadas con pollo y verduras", meals: ["lunch"] },
  { title: "Garbanzos con bacalao y espinacas", meals: ["lunch"] },
  { title: "Alubias blancas con merluza y verduras", meals: ["lunch"] },
  { title: "Arroz con pollo y verduras", meals: ["lunch"] },
  { title: "Arroz con sepia y verduras", meals: ["lunch"] },
  { title: "Poke de arroz con salmón y verduras", meals: ["lunch"] },
  { title: "Pasta integral con atún y tomate", meals: ["lunch"] },
  { title: "Espaguetis integrales con pavo y verduras", meals: ["lunch"] },
  { title: "Macarrones integrales con salmón y espinacas", meals: ["lunch"] },
  { title: "Merluza al vapor con patata cocida y judías verdes", meals: ["lunch"] },
  { title: "Salmón al horno con patata asada y espárragos", meals: ["lunch"] },
  { title: "Pollo asado con batata y verduras al horno", meals: ["lunch"] },
  { title: "Ternera a la plancha con patata cocida y ensalada mixta", meals: ["lunch"] },
  { title: "Solomillo de ternera a la plancha con setas salteadas", meals: ["lunch"] },
  { title: "Ternera a la plancha con pimientos asados", meals: ["lunch"] },
  { title: "Conejo al horno con verduras", meals: ["lunch"] },
  { title: "Lomo de cerdo a la plancha con coliflor al vapor", meals: ["lunch", "dinner"] },
  { title: "Pechuga de pollo a la plancha con ensalada mixta", meals: ["lunch", "dinner"] },
  { title: "Pavo al horno con verduras asadas", meals: ["lunch", "dinner"] },
  { title: "Sardinas a la plancha con ensalada mixta", meals: ["lunch"] },
  { title: "Atún a la plancha con pisto", meals: ["lunch"] },
  { title: "Caballa al horno con tomate y pimientos", meals: ["lunch"] },
  { title: "Emperador a la plancha con calabacín", meals: ["lunch"] },
  { title: "Lubina al horno con verduras", meals: ["lunch", "dinner"] },
  { title: "Rape al vapor con brócoli", meals: ["lunch", "dinner"] },
  { title: "Merluza a la plancha con espárragos", meals: ["dinner"] },
  { title: "Lenguado a la plancha con verduras salteadas", meals: ["dinner"] },
  { title: "Bacalao al horno con pimientos", meals: ["dinner"] },
  { title: "Tortilla de espinacas con ensalada de tomate", meals: ["dinner"] },
  { title: "Revuelto de setas y espárragos trigueros", meals: ["dinner"] },
  { title: "Huevos cocidos con pisto", meals: ["dinner"] },
  { title: "Tortilla francesa con calabacín a la plancha", meals: ["dinner"] },
  { title: "Brochetas de pollo con verduras", meals: ["dinner"] },
  { title: "Pavo a la plancha con champiñones salteados", meals: ["dinner"] },
];

type Candidate = { title: string; protein: PlanProtein | null; carb: PlanCarb | null; source: "plan" | "catalog" | "idea" };

function candidates(meal: "lunch" | "dinner", plan: NutritionPlan): Candidate[] {
  const titles: [string, Candidate["source"]][] = [
    ...plan[meal].examples.map((title): [string, Candidate["source"]] => [title, "plan"]),
    ...catalog.recipes.filter((recipe) => recipe.slot === meal).map((recipe): [string, Candidate["source"]] => [recipe.name, "catalog"]),
    ...ideas.filter((idea) => idea.meals.includes(meal)).map((idea): [string, Candidate["source"]] => [idea.title, "idea"]),
  ];
  const seen = new Set<string>();
  return titles.flatMap(([title, source]) => {
    const key = normalizePlanText(title);
    if (seen.has(key) || /^libre\.?$/.test(key) || avoidedWords.test(key)) return [];
    seen.add(key);
    return [{ title, protein: dishProtein(title), carb: dishCarb(title), source }];
  });
}

// --- Choosing the week --------------------------------------------------------------------------

// A small seeded generator (mulberry32): the same seed gives the same week (tests); the page
// passes a new seed each time, so processing the plan again gives another week.
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

type Random = () => number;

function shuffle<T>(items: T[], random: Random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

const pick = <T,>(items: T[], random: Random) => items[Math.floor(random() * items.length)];

type Slot = { protein: PlanProtein | null; carb: PlanCarb | null; free: boolean };

// The rules as seven slots: proteins spread over the week, then each carbohydrate on a day of its
// own. Days no rule covers are free at dinner (the plan's «Libre», the weekly social meal: always
// Saturday) and
// «carne o pescado» at lunch.
function slotsFor(meal: "lunch" | "dinner", plan: NutritionPlan, random: Random): Slot[] {
  const proteins = plan[meal].rules.flatMap((rule) => (rule.protein && !rule.carb ? Array(rule.days).fill(rule.protein) : []));
  const carbs = shuffle(plan[meal].rules.flatMap((rule) => (rule.carb ? Array(rule.days).fill(rule.carb) : [])), random);
  const planned = shuffle(proteins.slice(0, 7), random);
  const freeCount = meal === "dinner" ? Math.max(0, 7 - Math.max(planned.length, carbs.length)) : 0;

  const slots: Slot[] = Array.from({ length: 7 }, (_, index) => ({ protein: planned[index] ?? null, carb: null, free: false }));
  // The free dinner is always on Saturday (Sergio's choice), then Sunday, Friday… if there are more.
  if (freeCount) {
    const freeDays = [5, 6, 4, 3, 2, 1, 0];
    const used = slots.filter((slot) => slot.protein).length;
    // Proteins move off the free days so that every rule keeps its days.
    const proteinsLeft = slots.map((slot) => slot.protein).filter(Boolean) as PlanProtein[];
    const free = new Set(freeDays.slice(0, Math.min(freeCount, 7 - used)));
    let next = 0;
    for (let day = 0; day < 7; day++) {
      slots[day] = free.has(day) ? { protein: null, carb: null, free: true } : { protein: proteinsLeft[next++] ?? null, carb: null, free: false };
    }
  }
  const open = shuffle(slots.map((slot, day) => (slot.free ? -1 : day)).filter((day) => day >= 0), random);
  carbs.slice(0, open.length).forEach((carb, index) => (slots[open[index]].carb = carb));
  return slots;
}

const proteinNames: Record<PlanProtein, string[]> = {
  red_meat: ["Ternera", "Solomillo de ternera"],
  white_meat: ["Pollo", "Pavo", "Conejo", "Lomo de cerdo"],
  blue_fish: ["Salmón", "Atún", "Sardinas", "Emperador"],
  white_fish: ["Merluza", "Lubina", "Bacalao", "Rape"],
  egg: ["Tortilla francesa", "Huevos revueltos"],
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// A dish built from the slot when no example or idea fits: «Conejo al horno con patata asada y
// verduras al horno», «Arroz con merluza y verduras».
function composeDish(slot: Slot, plan: NutritionPlan, rule: PlanRule | undefined, side: string, random: Random) {
  const examples = (rule?.examples ?? []).filter((example) => (slot.protein ? dishProtein(example) === slot.protein : true));
  const protein = slot.protein ?? pick(["white_meat", "blue_fish", "white_fish"] as PlanProtein[], random);
  const name = capitalize(examples.length ? pick(examples, random) : pick(proteinNames[protein], random));
  const lower = name.toLowerCase();
  const cooking = protein === "egg" ? "" : ` ${pick(["a la plancha", "al horno", "al vapor"], random)}`;
  switch (slot.carb) {
    case "legume":
      return `Lentejas estofadas con ${lower} y verduras`;
    case "rice":
      return `Arroz con ${lower} y verduras`;
    case "pasta":
      return `Pasta integral con ${lower} y verduras`;
    case "potato":
      return `${name}${cooking} con patata asada y ${side}`;
    default:
      return `${name}${cooking} con ${side}`;
  }
}

function withSide(title: string, side: string) {
  if (hasVegetable(title)) return title;
  return / y /.test(title) ? `${title} con guarnición de ${side}` : `${title} y ${side}`;
}

// used: titles already in the week (a dish fits lunch and dinner; it is never eaten twice).
function chooseDishes(meal: "lunch" | "dinner", plan: NutritionPlan, random: Random, used: Set<string>) {
  const pool = candidates(meal, plan).filter(
    (dish) =>
      !(meal === "dinner" && plan.noRedMeatAtDinner && dish.protein === "red_meat") &&
      // Dinners carry no carbohydrate unless a rule asks for one.
      !(meal === "dinner" && dish.carb && !plan.dinner.rules.some((rule) => rule.carb === dish.carb)),
  );
  const sides = plan.sides.length ? plan.sides : ["ensalada mixta", "verduras al horno", "salteado de verduras"];

  // A few arrangements of the slots; the one where most days have a real dish wins.
  let best: { slots: Slot[]; score: number } | null = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const slots = slotsFor(meal, plan, random);
    const score = slots.filter(
      (slot) => slot.free || pool.some((dish) => dish.carb === slot.carb && (slot.protein ? dish.protein === slot.protein : dish.protein && dish.protein !== "egg" && dish.protein !== "red_meat")),
    ).length;
    if (!best || score > best.score) best = { slots, score };
    if (score === 7) break;
  }

  return best!.slots.map((slot): string | null => {
    if (slot.free) return null;
    const matches = pool.filter(
      (dish) =>
        !used.has(dish.title) &&
        dish.carb === slot.carb &&
        (slot.protein ? dish.protein === slot.protein : dish.protein !== null && dish.protein !== "egg" && dish.protein !== "red_meat"),
    );
    // The plan's own examples first, then the catalogue and the ideas.
    const own = matches.filter((dish) => dish.source === "plan");
    const chosen = own.length && random() < 0.6 ? pick(own, random) : matches.length ? pick(matches, random) : null;
    const side = pick(sides, random);
    if (chosen) {
      used.add(chosen.title);
      return withSide(chosen.title, side);
    }
    const rule = plan[meal].rules.find((candidate) => candidate.protein === slot.protein && !candidate.carb);
    let composed = composeDish(slot, plan, rule, side, random);
    for (let retry = 0; retry < 5 && used.has(composed); retry++) composed = composeDish(slot, plan, rule, pick(sides, random), random);
    used.add(composed);
    return composed;
  });
}

// Seven lunches and dinners (Monday to Sunday) that keep the plan's rules.
export function generatePlanWeek(plan: NutritionPlan, seed: number): ImportedMenuDay[] {
  const random = seededRandom(seed);
  const used = new Set<string>();
  const lunches = chooseDishes("lunch", plan, random, used);
  const dinners = chooseDishes("dinner", plan, random, used);
  const slot = (title: string | null) => (title ? { status: "planned" as const, dishName: title } : { status: "free" as const, dishName: "" });
  return dayNames.map((dayName, index) => ({ dayName, lunch: slot(lunches[index]), dinner: slot(dinners[index]) }));
}

// --- Breakfast, mid-morning, snack and bedtime ---------------------------------------------------

// Day 1 (Monday) takes option 1, day 2 option 2, day 3 option 3, day 4 option 1 again…
export function planDailyMeals(plan: NutritionPlan, dayIndex: number): PlanDailyMeal[] {
  return (["breakfast", "midMorning", "snack", "bedtime"] as PlanDailyMealKey[]).flatMap((meal) => {
    const options = plan[meal];
    if (!options.length) return [];
    const index = dayIndex % options.length;
    const option = options[index];
    // A sandwich «Podrá ser de: pavo y queso, jamón y tomate…» changes its filling each time.
    const round = Math.floor(dayIndex / options.length);
    const filling = option.fillings.length ? option.fillings[round % option.fillings.length] : null;
    const parts = option.text.split(/\s+\+\s+/);
    if (filling) {
      const sandwich = parts.findIndex((part) => /s[aá]ndwich|bocadillo|tostada/i.test(part));
      parts[sandwich >= 0 ? sandwich : parts.length - 1] += ` (${filling})`;
    }
    return [{ meal, option: index + 1, options: options.length, text: parts.join(" + ") }];
  });
}

const categoryWords: [SupermarketCategory, RegExp][] = [
  ["despensa", /\b(whey|proteina|copos|cereales|tortitas|pan|frutos secos|cafe|atun|avena)\b/],
  ["lácteos", /\b(leche|lacteo|yogur|kefir|queso|batido|huevos?|claras)\b/],
  ["carnicería", /\b(pavo|jamon|lomo|lacon|pollo|embuchado)\b/],
  ["pescadería", /\b(salmon|merluza)\b/],
  ["frutería", /\b(fruta|manzana|platano|naranja|tomate|pimientos?|kiwi|pera|fresas?)\b/],
];

function categoryOf(name: string): SupermarketCategory {
  const text = normalizePlanText(name);
  return categoryWords.find(([, words]) => words.test(text))?.[0] ?? "otros";
}

// Names as they are bought: one of the alternatives, without notes.
const nameAliases: [RegExp, string][] = [
  [/^lacteo desnatado$/, "leche desnatada"],
  [/^frutos ecos$/, "frutos secos"],
  [/^whey$/, "proteína whey"],
  [/^huevos? cocidos?$|^huevos? completos?$|^huevos?$/, "huevos"],
  [/^tortitas de (arroz|maiz).*$/, "tortitas de arroz o maíz"],
  [/^pieza de fruta$|^fruta.*$/, "fruta"],
  [/^yogur proteico$/, "yogur proteico"],
  [/^yogur desnatado$/, "yogur desnatado"],
];

function shoppingName(raw: string) {
  let name = raw
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:]+$/, "");
  // «pavo, jamón cocido o lacón», «jamón o lomo embuchado»: the first one.
  if (!/^tortitas/i.test(name)) name = name.split(/,|\s+o\s+/)[0].trim();
  const key = normalizePlanText(name);
  const alias = nameAliases.find(([pattern]) => pattern.test(key));
  return alias ? alias[1] : name.toLowerCase();
}

// Per serving when the plan gives no amount (a toast, a sandwich, «yogur proteico»).
const defaultPortions: [RegExp, Omit<PlanShoppingItem, "name" | "category">][] = [
  [/^fruta$/, { quantity: 200, unit: "g" }],
  [/^pan integral$/, { quantity: 35, unit: "g" }],
  [/^(pavo|jamon.*|lacon|lomo.*|salmon.*)$/, { quantity: 40, unit: "g" }],
  [/^queso.*$/, { quantity: 30, unit: "g" }],
  [/^atun$/, { quantity: 1, unit: "ud" }],
];

function portionOf(name: string) {
  const key = normalizePlanText(name);
  return defaultPortions.find(([pattern]) => pattern.test(key))?.[1] ?? { quantity: 1, unit: "ud" as const };
}

const unitOf = (unit: string): "g" | "ml" => (/^(ml|l)$/i.test(unit) ? "ml" : "g");
const unitFactor = (unit: string) => (/^(kg|l)$/i.test(unit) ? 1000 : 1);

function item(raw: string, quantity?: number, unit?: "g" | "ml" | "ud"): PlanShoppingItem | null {
  const name = shoppingName(raw);
  if (!name || name.length < 2) return null;
  const amount = quantity && unit ? { quantity, unit } : portionOf(name);
  return { name, ...amount, category: categoryOf(name) };
}

// What one part of an option needs: «250ml de leche desnatada», «kéfir (150ml)», «4 tortitas de
// arroz o maíz», «pieza de fruta», «tostada de pan integral con tomate y 40gr de jamón»…
function componentItems(raw: string): PlanShoppingItem[] {
  const text = raw.replace(/\((libre|sin piel)\)/gi, "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  // «tostada de pan integral con tomate y 60gr de pavo», «sándwich de pan integral (pavo y queso)».
  const bread = text.match(/^(tostadas?|s[aá]ndwich|bocadillo)\s+de\s+(pan\s+[\p{L} ]+?)(?:\s+con\s+(.+?))?(?:\s*\((.+)\))?$/iu);
  if (bread) {
    const pieces = /^tostada/i.test(bread[1]) ? 1 : 2;
    const breadItem = item("pan integral", portionOf("pan integral").quantity * pieces, "g");
    const extras = [bread[3], bread[4]]
      .filter((part): part is string => Boolean(part))
      .flatMap((part) => part.split(/\s+y\s+/))
      .flatMap((part) => componentItems(part));
    return [...(breadItem ? [breadItem] : []), ...extras];
  }

  const measured = text.match(/^(\d+(?:[.,]\d+)?)\s*(gr?s?|g|kg|ml|l)\.?\s+(?:de\s+)?(.+)$/i);
  if (measured) {
    const quantity = Number(measured[1].replace(",", ".")) * unitFactor(measured[2]);
    const found = item(measured[3], quantity, unitOf(measured[2]));
    return found ? [found] : [];
  }

  const inParens = text.match(/^(.+?)\s*\((\d+(?:[.,]\d+)?)\s*(gr?s?|g|kg|ml|l)\)\s*$/i);
  if (inParens) {
    const quantity = Number(inParens[2].replace(",", ".")) * unitFactor(inParens[3]);
    const found = item(inParens[1], quantity, unitOf(inParens[3]));
    return found ? [found] : [];
  }

  const counted = text.match(/^(\d+)\s+(.+)$/);
  if (counted) {
    const found = item(counted[2], Number(counted[1]), "ud");
    return found ? [found] : [];
  }

  const found = item(text);
  return found ? [found] : [];
}

export function optionItems(text: string): PlanShoppingItem[] {
  return text
    .split(/\s+\+\s+/)
    .flatMap((part) => componentItems(part));
}

const itemKey = (entry: Pick<PlanShoppingItem, "name">) => normalizePlanText(entry.name);

// Everything the week's breakfasts, mid-mornings, snacks and bedtime need, added up per item (one
// person: the plan's amounts are personal).
export function planShoppingItems(plan: NutritionPlan): PlanShoppingItem[] {
  const totals = new Map<string, PlanShoppingItem>();
  for (let day = 0; day < 7; day++) {
    for (const meal of planDailyMeals(plan, day)) {
      for (const entry of optionItems(meal.text)) {
        const known = totals.get(itemKey(entry));
        if (!known) totals.set(itemKey(entry), { ...entry });
        // Same name in another unit (rare): the first unit stays; the amount is not mixed.
        else if (known.unit === entry.unit) known.quantity += entry.quantity;
      }
    }
  }
  return [...totals.values()].map((entry) => ({ ...entry, quantity: Math.round(entry.quantity) }));
}

export function planExtras(plan: NutritionPlan): PlanExtras {
  return {
    days: dayNames.map((dayName, index) => ({ dayName, meals: planDailyMeals(plan, index) })),
    items: planShoppingItems(plan),
  };
}

export function isPlanExtras(value: unknown): value is PlanExtras {
  if (!value || typeof value !== "object") return false;
  const extras = value as Partial<PlanExtras>;
  return (
    Array.isArray(extras.days) &&
    Array.isArray(extras.items) &&
    extras.items.every(
      (entry) =>
        !!entry &&
        typeof entry.name === "string" &&
        typeof entry.quantity === "number" &&
        entry.quantity > 0 &&
        (entry.unit === "g" || entry.unit === "ml" || entry.unit === "ud") &&
        typeof entry.category === "string",
    )
  );
}

// Why the week looks the way it does, for the proposal's notes.
export function planWarnings(plan: NutritionPlan, days: ImportedMenuDay[]) {
  const free = days.filter((day) => day.dinner.status === "free").map((day) => day.dayName.toLowerCase());
  return [
    "Es un plan nutricional: hemos elegido las comidas y las cenas siguiendo sus reglas y ejemplos. Cambia con «Otra idea» lo que no te encaje.",
    ...(free.length ? [`Cena libre el ${free.join(" y el ")}: la comida social de la semana del plan.`] : []),
  ];
}
