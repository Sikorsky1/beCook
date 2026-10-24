const {test, beforeEach, afterEach} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// A nutritionist's plan uploaded as a PDF (options for breakfast, mid-morning and snack; rules and
// examples for lunch and dinner) becomes a week on the device, without the AI, and its daily meals
// join the week's shopping list as items added by hand. The fixture is the plan part of the text the
// PDF reader gives for the nutritionist's PDF (lines wrapped as in the PDF).
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "synthetic-anon-key";
const {createDevice, useDevice} = require("./helpers/fake-browser.cjs");
const {createShoppingAccount} = require("./helpers/fake-shopping.cjs");
const {supabase} = require("../src/lib/supabase/client.ts");
const repos = require("../src/lib/data/repositories.ts");
const shopping = require("../src/lib/data/shopping.ts");
const planExtrasData = require("../src/lib/data/planExtras.ts");
const np = require("../src/lib/nutritionPlan.ts");
const {generatePlanWeek} = require("../src/lib/menu-generation/plan-week.ts");
const {menuFileLimits} = require("../src/lib/menuFile.ts");
const {parseMenuTextLocally} = require("../src/lib/importMenu.ts");
const {withWeekDates} = require("../src/lib/weekStorage.ts");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const pdfText = read("tests/fixtures/nutrition-plan-pdf.txt");
const plan = np.parseNutritionPlan(pdfText);

const count = (values) => values.reduce((totals, value) => ({...totals, [value]: (totals[value] ?? 0) + 1}), {});

test("the plan is read: daily options, wrapped lines, rules with their examples, sides and «En cenas: carne roja»", () => {
 assert.ok(plan);
 assert.equal(plan.breakfast.length, 3);
 assert.equal(plan.midMorning.length, 3);
 assert.equal(plan.snack.length, 3);
 assert.equal(plan.bedtime.length, 1);
 assert.equal(plan.breakfast[2].text, "kéfir (150ml) + tostada de pan integral con tomate y 40gr de jamón o lomo embuchado", "a wrapped line is joined");
 assert.deepEqual(plan.midMorning[1].fillings, ["pavo y queso", "jamón y tomate", "atún y pimientos"]);
 assert.deepEqual(plan.snack.map((option) => option.text), [
  "Yogur proteico + 250gr de fruta",
  "Yogur proteico + 15gr de frutos ecos",
  "Yogur proteico + 60gr de pavo, jamón cocido o lacón",
 ]);
 assert.equal(plan.bedtime[0].text, "Lácteo desnatado (250ml) + 20gr de whey");
 // Pre and post-workout are left out: the breakfast is used every day.
 assert.ok(!plan.breakfast.some((option) => /queso batido|manzana/.test(option.text)));

 assert.deepEqual(plan.lunch.rules.map((rule) => [rule.days, rule.protein, rule.carb]), [
  [1, null, "legume"], [1, null, "rice"], [1, null, "pasta"], [1, null, "potato"],
  [1, "red_meat", null], [2, "white_meat", null], [2, "blue_fish", null], [2, "white_fish", null],
 ]);
 assert.ok(plan.lunch.rules[6].examples.includes("pez espada"), "examples of a wrapped rule");
 assert.ok(plan.lunch.rules[6].examples.includes("salmonete"), "«…etc.» is dropped");
 assert.deepEqual(plan.dinner.rules.map((rule) => [rule.days, rule.protein]), [[2, "white_fish"], [2, "egg"], [2, "white_meat"]]);
 assert.equal(plan.lunch.examples.length, 7);
 assert.equal(plan.dinner.examples.at(-1), "Libre");
 assert.deepEqual(plan.sides, ["ensalada mixta", "salteado de verduras", "verduras al horno", "setas", "espárragos", "coliflor"]);
 assert.equal(plan.noRedMeatAtDinner, true);
});

test("a weekly menu is not a plan, and the plan is not something the menu parser reads", () => {
 assert.equal(np.parseNutritionPlan("Lunes\nComida: Lentejas\nCena: Tortilla"), null);
 assert.equal(np.parseNutritionPlan("DÍA\tCOMIDA\tCENA\nLunes\tLentejas\tLIBRE"), null);
 assert.equal(parseMenuTextLocally(pdfText).kind, "ambiguous");
 assert.equal(np.isNutritionPlanText(pdfText), true);
});

// generatePlanRulesWeek is the last resort of the plan's week (when the marked recipes cannot fill
// it): it keeps the plan's rules with the plan's examples and ideas.
test("last resort: every rules week keeps the plan's rules: lunch proteins and carbohydrates, dinners, one free dinner on Saturday", () => {
 for (let seed = 1; seed <= 60; seed++) {
  const days = np.generatePlanRulesWeek(plan, seed);
  assert.deepEqual(days.map((day) => day.dayName), ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]);
  const lunches = days.map((day) => day.lunch);
  const dinners = days.map((day) => day.dinner);
  assert.ok(lunches.every((slot) => slot.status === "planned"), `seed ${seed}: every lunch planned`);
  assert.deepEqual(count(lunches.map((slot) => np.dishProtein(slot.dishName))), {red_meat: 1, white_meat: 2, blue_fish: 2, white_fish: 2}, `seed ${seed}: ${lunches.map((slot) => slot.dishName).join(" / ")}`);
  assert.deepEqual(count(lunches.map((slot) => np.dishCarb(slot.dishName)).filter(Boolean)), {legume: 1, rice: 1, pasta: 1, potato: 1}, `seed ${seed}: carbohydrates`);
  assert.deepEqual(dinners.map((slot) => slot.status), ["planned", "planned", "planned", "planned", "planned", "free", "planned"], "the free dinner is always Saturday");
  assert.deepEqual(count(dinners.filter((slot) => slot.status === "planned").map((slot) => np.dishProtein(slot.dishName))), {white_fish: 2, egg: 2, white_meat: 2}, `seed ${seed}: dinners`);
  assert.ok(dinners.every((slot) => !np.dishCarb(slot.dishName)), "no carbohydrate at dinner");
  const titles = [...lunches, ...dinners].filter((slot) => slot.status === "planned").map((slot) => slot.dishName);
  assert.equal(new Set(titles).size, titles.length, "no dish twice in the week");
  assert.ok(titles.every((title) => !/frit|rebozad|hamburguesa/i.test(title)), "no fried dishes and no red meat at dinner");
 }
 assert.deepEqual(np.generatePlanRulesWeek(plan, 7), np.generatePlanRulesWeek(plan, 7), "same seed, same week");
 assert.notDeepEqual(np.generatePlanRulesWeek(plan, 7), np.generatePlanRulesWeek(plan, 8));
});

test("last resort: with training days, the plan's rice, pasta and potato go on those days and no other starch on the rest", () => {
 const {isStarchyDish} = require("../src/lib/menu-generation/carbs.ts");
 const {catalogCardForCheck} = require("../src/lib/recipes/catalogChecks.ts");
 const starchy = (title) => isStarchyDish(title, catalogCardForCheck(title)?.ingredients ?? null);
 for (const [trainingDays, starchyOnRest] of [[[1, 3, 5], 0], [[1, 2, 3, 4, 5], 0], [[2, 4], 1]]) {
  for (let seed = 1; seed <= 40; seed++) {
   const days = np.generatePlanRulesWeek(plan, seed, null, trainingDays);
   const lunches = days.map((day) => day.lunch.dishName);
   assert.deepEqual(count(lunches.map(np.dishCarb).filter(Boolean)), {legume: 1, rice: 1, pasta: 1, potato: 1}, `seed ${seed}: the plan keeps its carbohydrates`);
   const onTraining = lunches.filter((title, index) => trainingDays.includes(index + 1) && starchy(title)).length;
   const onRest = lunches.filter((title, index) => !trainingDays.includes(index + 1) && starchy(title)).length;
   assert.equal(onTraining, Math.min(3, trainingDays.length), `seed ${seed} ${trainingDays}: ${lunches.join(" / ")}`);
   assert.equal(onRest, starchyOnRest, `seed ${seed} ${trainingDays}: ${lunches.join(" / ")}`);
   assert.ok(lunches.every((title, index) => np.dishCarb(title) !== "legume" || !trainingDays.includes(index + 1) || trainingDays.length === 7), "the legume on a rest day");
   assert.ok(days.every((day) => day.dinner.status === "free" || !starchy(day.dinner.dishName)), `seed ${seed}: dinners without starch`);
  }
 }
});

// Since 2026-10-22 the plan's lunches and dinners are a Crear menú week of the marked recipes
// (plan-week.ts); the plan keeps its free dinner and gives the rest of the day.
const marked = (meal) => new Set(require("../src/data/nutritionist-recipes.json").recipes
 .filter((recipe) => recipe.slot === meal && require("../src/data/recipe-selection.json").recipes.some((chosen) => chosen.id === recipe.id))
 .map((recipe) => recipe.name));

test("the plan's week: only marked recipes, by exact title and in their meal; free dinner on Saturday; no dish twice", () => {
 const lunches = marked("lunch");
 const dinners = marked("dinner");
 for (let seed = 1; seed <= 40; seed++) {
  const days = generatePlanWeek(plan, seed, null, [1, 3, 5]);
  assert.deepEqual(days.map((day) => day.dayName), ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]);
  assert.ok(days.every((day) => day.lunch.status === "planned" && lunches.has(day.lunch.dishName)), `seed ${seed}: ${days.map((day) => day.lunch.dishName).join(" / ")}`);
  assert.deepEqual(days.map((day) => day.dinner.status), ["planned", "planned", "planned", "planned", "planned", "free", "planned"], "the free dinner is always Saturday");
  assert.ok(days.every((day) => day.dinner.status === "free" || dinners.has(day.dinner.dishName)), `seed ${seed}: dinners`);
  const titles = days.flatMap((day) => [day.lunch, day.dinner]).filter((slot) => slot.status === "planned").map((slot) => slot.dishName);
  assert.equal(new Set(titles).size, titles.length, "no dish twice in the week");
 }
 assert.deepEqual(generatePlanWeek(plan, 7), generatePlanWeek(plan, 7), "same seed, same week");
 assert.notDeepEqual(generatePlanWeek(plan, 7), generatePlanWeek(plan, 8));
});

test("the plan's week keeps the plan's rules (Sergio, 2026-10-24): the fewest broken, carbohydrates on the training days", () => {
 const {ruleBreakdown, rulesFromPlan, defaultMenuRules, minimumViolations, ruleDish} = require("../src/lib/menu-generation/menu-rules.ts");
 const {catalogCardForCheck} = require("../src/lib/recipes/catalogChecks.ts");
 const rules = rulesFromPlan(plan);
 // The PDF's rules are the default ones of every menu.
 assert.deepEqual(rules, defaultMenuRules);
 const dish = (slot) => (slot.status === "planned" ? ruleDish(slot.dishName, catalogCardForCheck(slot.dishName)?.ingredients ?? null) : null);
 for (const trainingDays of [[1, 3, 5], [2, 4, 6, 7], [1, 2, 3, 4, 5]]) {
  let atMinimum = 0;
  const weeks = 150;
  for (let seed = 1; seed <= weeks; seed++) {
   const days = generatePlanWeek(plan, seed * 7919, null, trainingDays);
   const broken = ruleBreakdown(rules, {lunch: days.map((day) => dish(day.lunch)), dinner: days.map((day) => dish(day.dinner))}, trainingDays);
   if (broken.total <= minimumViolations(rules, trainingDays)) atMinimum++;
   // No blue fish or red meat at dinner: the plan's dinners are white fish, egg and white meat.
   for (const day of days) if (day.dinner.status === "planned") assert.ok(!["blue_fish", "red_meat"].includes(dish(day.dinner).protein), day.dinner.dishName);
  }
  assert.ok(atMinimum / weeks >= 0.95, `${trainingDays}: ${atMinimum}/${weeks}`);
 }
});

test("the plan's week: «En cenas: carne roja» under «Evitar» keeps red meat off the dinners; fried dishes stay", () => {
 const {dishGroups} = require("../src/lib/menu-generation/food-groups.ts");
 const {catalogCardForCheck} = require("../src/lib/recipes/catalogChecks.ts");
 const redMeat = (title) => np.dishProtein(title) === "red_meat" || (dishGroups(title, catalogCardForCheck(title)?.ingredients ?? null).includes("red_meat") && np.dishProtein(title) !== "white_meat");
 const redDinners = (rules) => {
  let count = 0;
  for (let seed = 1; seed <= 300; seed++) for (const day of generatePlanWeek(rules, seed, null, [1, 3, 5])) if (day.dinner.status === "planned" && redMeat(day.dinner.dishName)) count++;
  return count;
 };
 assert.equal(plan.noRedMeatAtDinner, true);
 assert.equal(redDinners(plan), 0);
 assert.ok(redDinners({...plan, noRedMeatAtDinner: false}) > 0, "without the rule, red meat dinners come up");
 // Fried and processed dishes are not filtered (Sergio, 2026-10-22).
 const fried = /\b(frit\w*|rebozad[oa]s?|empanad[oa]s?)\b/;
 let friedDishes = 0;
 for (let seed = 1; seed <= 300; seed++) for (const day of generatePlanWeek(plan, seed, null, [1, 3, 5])) for (const slot of [day.lunch, day.dinner]) if (slot.status === "planned" && fried.test(np.normalizePlanText(slot.dishName))) friedDishes++;
 assert.ok(friedDishes > 0);
});

test("the plan's week: no carbohydrate on the days without training; three training days leave one carbohydrate lunch out", () => {
 const {ruleDish} = require("../src/lib/menu-generation/menu-rules.ts");
 const {catalogCardForCheck} = require("../src/lib/recipes/catalogChecks.ts");
 const hydrate = (title) => ruleDish(title, catalogCardForCheck(title)?.ingredients ?? null).hydrate;
 for (const trainingDays of [[1, 3, 5], [2, 4, 6, 7]]) {
  let off = 0, carbLunches = 0;
  const weeks = 200;
  for (let seed = 1; seed <= weeks; seed++) {
   generatePlanWeek(plan, seed, null, trainingDays).forEach((day, index) => {
    for (const slot of [day.lunch, day.dinner]) if (slot.status === "planned" && hydrate(slot.dishName) && !trainingDays.includes(index + 1)) off++;
    if (hydrate(day.lunch.dishName)) carbLunches++;
   });
  }
  // Four carbohydrate lunches a week: with three training days, one is missing or on a rest day.
  assert.ok(off / weeks <= (trainingDays.length >= 4 ? 0.05 : 1), `${trainingDays}: ${off} off training`);
  assert.ok(carbLunches / weeks >= Math.min(4, trainingDays.length) - 0.05, `${trainingDays}: ${carbLunches} carbohydrate lunches`);
 }
});

test("the plan's week: without enough marked recipes for the profile, the plan's rules decide (last resort)", () => {
 const vegan = {dietaryRestrictions: ["vegan"], allergies: [], otherAllergies: "", dislikedFoods: []};
 assert.deepEqual(generatePlanWeek(plan, 5, vegan, [1, 3, 5]), np.generatePlanRulesWeek(plan, 5, vegan, [1, 3, 5]));
});

test("with the profile, the week leaves out dishes that show its allergies, diets and disliked foods", () => {
 const {checkDish, blocksAutomaticProposal, mentionsDislikedFood} = require("../src/lib/recipes/restriction-check.ts");
 const profile = {dietaryRestrictions: [], allergies: ["shellfish", "nuts"], otherAllergies: "", dislikedFoods: ["salmón", "garbanzos"]};
 for (let seed = 1; seed <= 30; seed++) {
  const titles = [...generatePlanWeek(plan, seed, profile), ...np.generatePlanRulesWeek(plan, seed, profile)].flatMap((day) => [day.lunch, day.dinner]).filter((slot) => slot.status === "planned").map((slot) => slot.dishName);
  for (const title of titles) {
   const check = checkDish({title, card: null}, profile, {automatic: true});
   assert.ok(!blocksAutomaticProposal(check) && !mentionsDislikedFood(check), `seed ${seed}: ${title}`);
  }
 }
});

test("breakfast, mid-morning and snack follow the weekly rotation set with the plan; the sandwich filling changes", () => {
 const extras = np.planExtras(plan);
 const options = (meal) => extras.days.map((day) => day.meals.find((entry) => entry.meal === meal).option);
 // Sergio, 2026-10-19: Monday first.
 assert.deepEqual(options("breakfast"), [1, 2, 3, 1, 2, 3, 2]);
 assert.deepEqual(options("midMorning"), [2, 1, 1, 3, 1, 1, 1]);
 assert.deepEqual(options("snack"), [2, 3, 1, 3, 2, 1, 2]);
 assert.deepEqual(options("bedtime"), [1, 1, 1, 1, 1, 1, 1]);
 const meal = (index, key) => extras.days[index].meals.find((entry) => entry.meal === key).text;
 assert.equal(meal(0, "breakfast"), "250ml de leche desnatada + 40gr de copos de maíz + pieza de fruta");
 assert.equal(meal(0, "midMorning"), "sándwich de pan integral (pavo y queso) + yogur desnatado");
 assert.equal(meal(1, "breakfast"), "4 tortitas de arroz o maíz + 60gr de jamón cocido + yogur proteico");
 assert.equal(meal(1, "snack"), "Yogur proteico + 60gr de pavo, jamón cocido o lacón");
 assert.equal(meal(2, "breakfast"), "kéfir (150ml) + tostada de pan integral con tomate y 40gr de jamón o lomo embuchado");
 assert.equal(meal(3, "midMorning"), "2 tortitas de arroz o maíz + 50gr de pavo + naranja");
 assert.equal(meal(0, "snack"), "Yogur proteico + 15gr de frutos secos", "the PDF's typo is shown as meant");
 assert.equal(meal(2, "snack"), "Yogur proteico + 250gr de fruta");
});

test("the week's shopping for those meals is added up from the plan's amounts (one person)", () => {
 const items = Object.fromEntries(np.planShoppingItems(plan).map((entry) => [entry.name, entry]));
 const extras = np.planExtras(plan);
 const times = (meal, option) => extras.days.filter((day) => day.meals.some((entry) => entry.meal === meal && entry.option === option)).length;
 // Bedtime every day (7 × 250 ml) and breakfast 1 (250 ml each time).
 assert.deepEqual(items["leche desnatada"], {name: "leche desnatada", quantity: 250 * (7 + times("breakfast", 1)), unit: "ml", category: "lácteos"});
 assert.deepEqual(items["proteína whey"], {name: "proteína whey", quantity: 140, unit: "g", category: "despensa"});
 assert.equal(items["copos de maíz"].quantity, 40 * times("breakfast", 1));
 // Breakfast 2 and every snack.
 assert.equal(items["yogur proteico"].quantity, times("breakfast", 2) + 7);
 assert.equal(items["yogur desnatado"].quantity, times("midMorning", 1) + times("midMorning", 2));
 // A piece of fruit (200 g), 300 g mid-morning, 250 g snack.
 assert.deepEqual([items.fruta.quantity, items.fruta.unit, items.fruta.category], [200 * times("breakfast", 1) + 300 * times("midMorning", 1) + 250 * times("snack", 1), "g", "frutería"]);
 assert.equal(items["tortitas de arroz o maíz"].quantity, 4 * times("breakfast", 2) + 2 * times("midMorning", 3));
 assert.equal(items["kéfir"].quantity, 150 * times("breakfast", 3));
 assert.equal(items["frutos secos"].quantity, 15 * times("snack", 2), "«frutos ecos» read as frutos secos");
 assert.equal(items.naranja.quantity, times("midMorning", 3));
 assert.equal(items["jamón cocido"].category, "carnicería");
 assert.ok(Object.values(items).every((entry) => entry.quantity > 0 && ["g", "ml", "ud"].includes(entry.unit)));
});

test("a nutritionist's PDF with text may have more pages than a scanned one", () => {
 assert.ok(menuFileLimits.maxTextPdfPages >= 5);
 assert.equal(menuFileLimits.maxPages, 4, "the AI still takes at most four page images");
 const reader = read("src/lib/menuFileReader.ts");
 assert.match(reader, /numPages > menuFileLimits\.maxTextPdfPages/);
 assert.match(reader, /numPages > menuFileLimits\.maxPages\) return fail\("too_many_pages"\);\n    const images/);
});

test("the page recognises a plan before the paste limits and a plan read from a file is processed at once", () => {
 const page = read("src/components/pages/CreateMenuPage.tsx");
 assert.ok(page.indexOf("parseNutritionPlan(source)") < page.indexOf("validateImportText(source, importTextLimits)"));
 assert.match(page, /writePendingPlanExtras\(dataIdentity, weekForUse, importedMenu\.planExtras\?\.items\)/);
 assert.match(page, /applyPendingPlanExtras\(shoppingIdentity, isoWeek, weekDays\)/);
 const panel = read("src/components/features/ImportMenuPanel.tsx");
 assert.match(panel, /if \(!isNutritionPlanText\(text\)\) return "filled";\n\s+onProcess\(text\);/);
});

// --- data layer -------------------------------------------------------------------------------

const A = "00000000-0000-4000-8000-00000000000a";
const asA = {scope: "u_" + A, userId: A};
const W41 = {isoYear: 2026, isoWeek: 41};
const week = withWeekDates([{day: "Lunes", date: "", lunch: "Merluza", dinner: "LIBRE"}], W41);
let account, restoreDevice, originalFetch, originalGetSession;

beforeEach(() => {
 account = createShoppingAccount();
 repos.configureRemotes(account.remotes);
 shopping.forgetShoppingUpdateFailures();
 originalFetch = global.fetch;
 global.fetch = async (url, init) => {
  assert.equal(String(url), "/api/generate-shopping-list");
  const body = JSON.parse(init.body);
  const dishes = body.week.flatMap((d) => ["lunch", "dinner"].filter((meal) => d[meal] !== "LIBRE")
   .map((meal) => ({day: d.day, meal, items: [{name: d[meal].toLowerCase(), quantity: 400, unit: "g", category: "pescadería"}]})));
  return Response.json({items: dishes.flatMap((d) => d.items), dishes});
 };
 originalGetSession = supabase.auth.getSession;
 supabase.auth.getSession = async () => ({data: {session: {access_token: "synthetic"}}, error: null});
 restoreDevice = useDevice(createDevice());
});

afterEach(() => {
 repos.configureRemotes(null);
 global.fetch = originalFetch;
 supabase.auth.getSession = originalGetSession;
 restoreDevice?.();
 restoreDevice = null;
});

const planItems = [
 {name: "leche desnatada", quantity: 2500, unit: "ml", category: "lácteos"},
 {name: "yogur proteico", quantity: 9, unit: "ud", category: "lácteos"},
];

test("the plan's items wait without a list and join it, labelled for breakfasts and snacks, once it exists", async () => {
 account.writeWeek(W41, week);
 planExtrasData.writePendingPlanExtras(asA, W41, planItems);
 assert.equal(await planExtrasData.applyPendingPlanExtras(asA, W41, week), null, "no list: nothing to show");
 assert.equal(planExtrasData.readPendingPlanExtras(asA, W41).length, 2, "no list yet: they keep waiting");

 assert.equal((await shopping.ensureShoppingList(asA, W41, week)).status, "ready");
 const view = await planExtrasData.applyPendingPlanExtras(asA, W41, week);
 const line = view.items.find((entry) => entry.name === "leche desnatada");
 assert.deepEqual([line.quantity, line.unit, line.manual, line.forDailyMeals], [2500, "ml", true, true]);
 assert.ok(view.items.some((entry) => entry.name === "merluza"), "the dishes' items stay");
 assert.deepEqual(planExtrasData.readPendingPlanExtras(asA, W41), [], "nothing left waiting");
 const rows = account.listsOf(W41).at(-1).items;
 assert.equal(rows.filter((row) => row.itemKey === "manual|extras|yogur proteico").length, 1);

 // Applying again (another tab) adds nothing twice.
 planExtrasData.writePendingPlanExtras(asA, W41, planItems);
 await planExtrasData.applyPendingPlanExtras(asA, W41, week);
 assert.equal(account.listsOf(W41).at(-1).items.filter((row) => row.itemKey === "manual|extras|yogur proteico").length, 1);
 assert.deepEqual(planExtrasData.readPendingPlanExtras(asA, W41), []);
});

test("a menu that is not a plan clears what was waiting for the week", () => {
 planExtrasData.writePendingPlanExtras(asA, W41, planItems);
 planExtrasData.writePendingPlanExtras(asA, W41, undefined);
 assert.deepEqual(planExtrasData.readPendingPlanExtras(asA, W41), []);
});

test("the week's breakfasts and snacks are kept for Semana (guest: on the device); a menu without them clears them", async () => {
 const dailyMeals = require("../src/lib/data/dailyMeals.ts");
 const guest = {scope: "guest", userId: null};
 const extras = np.planExtras(plan);
 await dailyMeals.saveWeekDailyMeals(guest, W41, extras.days);
 const loaded = await dailyMeals.loadWeekDailyMeals(guest, W41);
 assert.equal(loaded.length, 7);
 assert.equal(loaded[0].dayName, "Lunes");
 assert.ok(loaded[0].meals.some(meal => meal.meal === "breakfast"));
 assert.deepEqual(dailyMeals.parseDailyMeals([{dayName: "Lunes", meals: [{meal: "lunch", text: "x", option: 1, options: 1}]}, "x"]), [{dayName: "Lunes", meals: []}], "only daily meals, well formed");
 await dailyMeals.saveWeekDailyMeals(guest, W41, undefined);
 assert.deepEqual(await dailyMeals.loadWeekDailyMeals(guest, W41), []);
});

test("the plan's daily options are kept after importing it and drive the breakfasts of the next menus", async () => {
 const store = require("../src/lib/data/nutritionPlanStore.ts");
 const guest = {scope: "guest", userId: null};
 await store.saveDailyPlanOptions(guest, store.dailyPlanOptionsOf(plan));
 const loaded = await store.loadDailyPlanOptions(guest);
 assert.equal(loaded.breakfast.length, 3);
 assert.equal(loaded.midMorning[1].fillings.length > 0, true, "the sandwich fillings are kept");
 // The same week as importing the plan itself.
 const fromStore = np.planExtras(store.planFromDailyOptions(loaded));
 assert.deepEqual(fromStore.days, np.planExtras(plan).days);
 assert.equal(fromStore.fromPlan, true);
 assert.equal(store.parseDailyPlanOptions({breakfast: [{text: ""}], snack: "x"}), null);
 await store.saveDailyPlanOptions(guest, null);
 assert.equal(await store.loadDailyPlanOptions(guest), null);
});

test("on training days (Perfil) the plan's pre-workout and post-workout replace breakfast; post-workout options take turns", () => {
 assert.deepEqual(plan.preWorkout.map(o => o.text), ["Café + manzana (sin piel)"]);
 assert.equal(plan.postWorkout.length, 3);
 assert.match(plan.postWorkout[1].text, /^15gr de whey \+ 150ml de kéfir \+ plátano \+ tostada .* 60gr de pavo$/);
 const extras = np.planExtras(plan, [1, 3, 5]);
 const meals = (index) => extras.days[index].meals.map(m => `${m.meal}${m.option}`);
 assert.deepEqual(meals(0).slice(0, 2), ["preWorkout1", "postWorkout1"]);
 assert.ok(!meals(0).some(m => m.startsWith("breakfast")));
 assert.deepEqual(meals(2).slice(0, 2), ["preWorkout1", "postWorkout2"]);
 assert.deepEqual(meals(4).slice(0, 2), ["preWorkout1", "postWorkout3"]);
 assert.equal(meals(1)[0], "breakfast2", "a rest day keeps its breakfast (weekly rotation)");
 // The other meals keep the weekly rotation.
 assert.deepEqual(extras.days.map(d => d.meals.find(m => m.meal === "snack").option), [2, 3, 1, 3, 2, 1, 2]);
 const items = Object.fromEntries(extras.items.map(i => [i.name, i]));
 assert.equal(items["manzana"].quantity, 3);
 assert.equal(items["proteína whey"].quantity, 7 * 20 + 3 * 15);
 // Without training days, as before.
 assert.deepEqual(np.planExtras(plan).days, np.planExtras(plan, []).days);
 assert.ok(np.planExtras(plan).days.every(d => d.meals[0].meal === "breakfast"));
});
