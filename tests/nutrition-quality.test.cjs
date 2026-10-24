// Nutritional analysis, phase 1 (analisis-nutricional-becook.md): allergies checked with the recipe
// (N01), the 14 EU allergens (N02), AESAN food groups (N04), weekly frequencies (N05) and habit
// goals (N06). Simulations of Crear menú with fixed seeds, without network or database.
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {catalogMenu} = require("../src/lib/menu-generation/catalog-menu.ts");
const {readMenuProfile} = require("../src/lib/menu-generation/prompt.ts");
const {dishGroups, mainProtein, highMercury} = require("../src/lib/menu-generation/food-groups.ts");
const {countGroups, meetsQuotas, weekQuotas} = require("../src/lib/menu-generation/quotas.ts");
const {catalogAlternative} = require("../src/lib/menu-generation/substitution.ts");
const {catalogCardForCheck} = require("../src/lib/recipes/catalogChecks.ts");
const {checkDish, blocksAutomaticProposal, allergyLabels} = require("../src/lib/recipes/restriction-check.ts");
const {normalizeFood} = require("../src/lib/recipes/food-lexicon.ts");
// The options of the profile, read from the component source (tests do not load .tsx).
const profileFields = fs.readFileSync(path.join(__dirname, "../src/components/features/ProfileFields.tsx"), "utf8");
const optionsOf = name => [...profileFields.slice(profileFields.indexOf(`export const ${name}`)).split("];")[0].matchAll(/\{ label: "([^"]+)", value: (?:"([^"]+)"|\w+) \}/g)].map(m => ({label: m[1], value: m[2]}));
const goalOptions = optionsOf("goalOptions");
const allergyOptions = optionsOf("allergyOptions");
const {catalogChecks} = require("../scripts/build-catalog-checks.cjs");

const root = path.resolve(__dirname, "..");
const weekOf = menu => menu.days.flatMap(d => [d.lunch.dishName, d.dinner.dishName]);
const groupsOf = title => dishGroups(title, catalogCardForCheck(title)?.ingredients ?? null);
const week = (profile, seed, styles = ["healthy_balanced"]) => catalogMenu({profile, styles, seed});

test("catalog-checks.json is the compact copy of catalog-recipes.json (node scripts/build-catalog-checks.cjs)", () => {
 const file = JSON.parse(fs.readFileSync(path.join(root, "src/data/recipe-cards/catalog-recipes.json"), "utf8"));
 const compact = JSON.parse(fs.readFileSync(path.join(root, "src/data/recipe-cards/catalog-checks.json"), "utf8"));
 assert.deepEqual(compact, catalogChecks(file));
});

test("N01: Crear menú never proposes a dish whose recipe lists an allergen of the profile", () => {
 const allergies = Object.keys(allergyLabels);
 assert.equal(allergies.length, 16, "14 EU allergens, lactose intolerance and the old «Marisco»");
 for (const allergy of allergies) {
  const profile = readMenuProfile({allergies: [allergy]});
  for (let seed = 1; seed <= 25; seed++) {
   const menu = week(profile, seed * 7919);
   if (!menu) continue; // the AI decides; never a conflicting catalogue week
   for (const dish of weekOf(menu)) {
    const check = checkDish({title: dish, card: catalogCardForCheck(dish)}, profile, {automatic: true});
    assert.equal(blocksAutomaticProposal(check), false, `${allergy}: ${dish}`);
   }
  }
 }
 // The examples of the analysis: a soy sauce with wheat, surimi with egg.
 assert.equal(blocksAutomaticProposal(checkDish({title: "Poke bowl de arroz, salmón marinado y aguacate", card: catalogCardForCheck("Poke bowl de arroz, salmón marinado y aguacate")}, readMenuProfile({allergies: ["gluten"]}), {automatic: true})), true);
 assert.equal(blocksAutomaticProposal(checkDish({title: "Salpicón de legumbres con palitos de cangrejo", card: catalogCardForCheck("Salpicón de legumbres con palitos de cangrejo")}, readMenuProfile({allergies: ["egg"]}), {automatic: true})), true);
});

test("N01: a vegan week has no milk, egg, fish, seafood, meat or honey in its recipes", () => {
 const vegan = readMenuProfile({dietaryRestrictions: ["vegan"]});
 for (let seed = 1; seed <= 30; seed++) {
  // The marked recipes (2026-10-22) have only a few vegan ones: without a catalogue week the AI
  // decides, never a conflicting catalogue week.
  const menu = week(vegan, seed);
  if (!menu) continue;
  for (const dish of weekOf(menu)) {
   const card = catalogCardForCheck(dish);
   assert.ok(card, dish);
   const certain = checkDish({title: dish, card}, vegan, {automatic: true}).findings.filter(f => f.certainty === "certain");
   assert.deepEqual(certain, [], dish);
   assert.ok(!card.possibleAllergens.some(a => ["milk", "eggs", "fish", "crustaceans", "molluscs"].includes(a)), dish);
  }
 }
});

test("N01: «Otra idea» checks the recipe too", () => {
 const gluten = readMenuProfile({allergies: ["gluten"]});
 const request = {day: "Lunes", meal: "lunch", currentDish: "Lentejas estofadas", otherDishes: [], rejected: []};
 for (let i = 0; i < 20; i++) {
  const idea = catalogAlternative(request, gluten);
  assert.ok(idea);
  assert.equal(blocksAutomaticProposal(checkDish({title: idea.dish, card: catalogCardForCheck(idea.dish)}, gluten, {automatic: true})), false, idea.dish);
  request.rejected.push(idea.dish);
 }
});

test("N02: milk allergy blocks lactose-free dairy; lactose intolerance accepts it", () => {
 const card = name => ({reviewStatus: "inferred", possibleAllergens: [], ingredients: [{name, optional: false}]});
 const milk = readMenuProfile({allergies: ["milk"]});
 const lactose = readMenuProfile({allergies: ["lactose"]});
 assert.equal(blocksAutomaticProposal(checkDish({title: "Ensalada de tomate", card: card("queso fresco sin lactosa")}, milk, {automatic: true})), true);
 assert.equal(checkDish({title: "Ensalada de tomate", card: card("yogur natural sin lactosa")}, lactose).findings.length, 0);
 assert.equal(checkDish({title: "Ensalada de tomate", card: card("yogur natural")}, lactose).status, "conflict");
 // Every EU allergen is an option of the profile, with lactose intolerance apart.
 const values = allergyOptions.map(o => o.value);
 for (const allergen of ["gluten", "crustaceans", "egg", "fish", "peanuts", "soy", "milk", "nuts", "celery", "mustard", "sesame", "sulphites", "lupin", "molluscs", "lactose"]) assert.ok(values.includes(allergen), allergen);
 const sesame = readMenuProfile({allergies: ["sesame"]});
 assert.equal(checkDish({title: "Salteado de tofu y kale con sésamo", card: null}, sesame).status, "conflict");
});

test("N04: AESAN food groups of real catalogue titles", () => {
 const expected = [
  ["Lentejas estofadas", ["legume"]],
  ["Garbanzos con sepia", ["seafood", "legume"]],
  ["Revuelto de tofu con verduras", ["legume"]],
  ["Tacos de lechuga con cerdo magro picante", ["red_meat"]],
  ["Lomo de cerdo salteado con zanahoria, guisantes y crema de cacahuete", ["red_meat"]],
  ["Bocadillo de lomo de ternera con vegetales", ["red_meat"]],
  ["Lomo de merluza con sopa hortelana", ["white_fish"]],
  ["Hamburguesas de atún fresco", ["blue_fish"]],
  ["Hamburguesas de pollo caseras", ["poultry"]],
  ["Albóndigas de berenjena y alubias al horno", ["legume"]],
  ["Albóndigas de pollo y champiñón salteado", ["poultry"]],
  ["Alcachofas con jamón", ["processed_meat"]],
  ["Salchichas con repollo en olla rápida", ["processed_meat"]],
  ["Judias verdes con patata y huevo duro", ["egg"]],
  ["Ensalada de patata, tomate y atún con huevo", ["blue_fish", "egg"]],
  ["Marmitako de bonito", ["blue_fish"]],
  ["Gallo en salsa ligera de vino blanco", ["white_fish"]],
  ["Muslos de pavo al horno con patatas", ["poultry"]],
  ["Ensalada de alubias blancas con tofu al curry y rúcula", ["legume"]],
  ["Sartén de garbanzos, soja texturizada y verduras", ["legume"]],
  ["Pollo al ras el hanout con cuscús, maíz y guisantes", ["poultry"]],
  ["Tortilla de patata", ["egg"]],
  ["Crema de brócoli", []],
  ["Pisto manchego", []],
 ];
 for (const [title, groups] of expected) assert.deepEqual(groupsOf(title).sort(), [...groups].sort(), title);
 assert.equal(mainProtein(groupsOf("Garbanzos con sepia")), "fish");
 // Every legume recipe has a group; few recipes are left without any (vegetable dishes).
 const catalog = require("../src/data/nutritionist-recipes.json").recipes;
 assert.ok(catalog.filter(r => /lenteja|garbanzo|alubia|tofu|hummus/i.test(r.name)).every(r => groupsOf(r.name).includes("legume")));
 assert.ok(catalog.filter(r => !groupsOf(r.name).length).length / catalog.length < 0.1);
});

test("N05: the weekly rules (2026-10-24) come before AESAN; processed meat, eggs and red meat keep their maximums; vegetarians keep AESAN", () => {
 const {ruleDish} = require("../src/lib/menu-generation/menu-rules.ts");
 const profile = readMenuProfile({});
 for (const styles of [["healthy_balanced"], ["mediterranean"], ["quick_simple"], ["healthy_balanced", "quick_simple"]]) {
  for (let seed = 1; seed <= 40; seed++) {
   const dishes = weekOf(week(profile, seed, styles));
   const counts = countGroups(dishes.map(groupsOf));
   const red = dishes.filter(dish => ruleDish(dish, catalogCardForCheck(dish)?.ingredients ?? null).protein === "red_meat").length;
   assert.ok(red <= 1 && counts.processedMeat === 0 && counts.egg <= 4, `${styles} ${seed}`);
  }
 }
 const vegetarian = readMenuProfile({dietaryRestrictions: ["vegetarian"]});
 let veg = 0;
 for (let seed = 1; seed <= 60; seed++) {
  const counts = countGroups(weekOf(week(vegetarian, seed)).map(groupsOf));
  if (counts.legume >= 5 && counts.egg <= 4) veg++;
 }
 assert.ok(veg / 60 >= 0.95, `vegetarian ${veg}/60`);
});

test("N05: «Otra idea» offers the same group first and never passes a maximum", () => {
 const profile = readMenuProfile({});
 const meatWeek = ["Muslos de pavo al horno con patatas", "Hamburguesas de pollo caseras", "Bocadillo de lomo de ternera con vegetales"];
 const idea = catalogAlternative({day: "Martes", meal: "lunch", currentDish: "Lentejas estofadas", otherDishes: meatWeek, rejected: []}, profile);
 assert.ok(groupsOf(idea.dish).includes("legume"), idea.dish);
 const rejected = [];
 for (let i = 0; i < 15; i++) {
  const next = catalogAlternative({day: "Martes", meal: "lunch", currentDish: "Crema de brócoli", otherDishes: meatWeek, rejected}, profile);
  const counts = countGroups([...meatWeek, next.dish].map(groupsOf));
  assert.ok(counts.meat <= 3 && counts.redMeat <= 1 && counts.processedMeat === 0, next.dish);
  rejected.push(next.dish);
 }
});

test("N06: habit goals only, and each one changes the week", () => {
 assert.equal(goalOptions.length, 8);
 for (const option of goalOptions) assert.doesNotMatch(normalizeFood(option.label), /grasa|muscul|peso|adelgaz|rendimiento/, option.label);
 assert.equal(weekQuotas({dietaryRestrictions: [], goals: ["more_plants"]}).legumeMin, 5);
 assert.equal(weekQuotas({dietaryRestrictions: [], goals: ["more_plants"]}).meatMax, 2);
 assert.equal(weekQuotas({dietaryRestrictions: [], goals: ["save_money"]}).fishMax, 3);
 const kids = readMenuProfile({goals: ["with_kids"]});
 for (let seed = 1; seed <= 60; seed++) {
  for (const dish of weekOf(week(kids, seed, ["mediterranean"]))) {
   const card = catalogCardForCheck(dish);
   assert.ok(![dish, ...(card?.ingredients ?? []).map(i => i.name)].some(t => highMercury.test(normalizeFood(t))), dish);
  }
 }
 // «Más verdura y legumbre»: within the weekly rules, more legume dishes than without the goal.
 const legumes = goals => {
  let total = 0;
  for (let seed = 1; seed <= 60; seed++) total += countGroups(weekOf(week(readMenuProfile({goals}), seed)).map(groupsOf)).legume;
  return total;
 };
 assert.ok(legumes(["more_plants"]) > legumes([]), "more_plants");
 const vegetarianPlants = readMenuProfile({dietaryRestrictions: ["vegetarian"], goals: ["more_plants"]});
 let ok = 0;
 for (let seed = 1; seed <= 60; seed++) if (countGroups(weekOf(week(vegetarianPlants, seed)).map(groupsOf)).legume >= 5) ok++;
 assert.ok(ok / 60 >= 0.95, `more_plants ${ok}/60`);
});

// --- Phase 2 ---------------------------------------------------------------------------------

test("N07: catalog-tags.json is up to date and every recipe has its main tags", () => {
 const {catalogTags} = require("../scripts/build-catalog-tags.cjs");
 const file = JSON.parse(fs.readFileSync(path.join(root, "src/data/recipe-cards/catalog-recipes.json"), "utf8"));
 const stored = JSON.parse(fs.readFileSync(path.join(root, "src/data/recipe-cards/catalog-tags.json"), "utf8"));
 assert.deepEqual(stored, catalogTags(file), "run node scripts/build-catalog-tags.cjs");
 assert.equal(stored.status, "pending_review");
 for (const [title, tags] of Object.entries(stored.recipes)) {
  assert.ok(Array.isArray(tags.groups) && Number.isFinite(tags.vegGrams) && [1, 2, 3].includes(tags.cost), title);
 }
 const {catalogTags: tagsOf} = require("../src/lib/recipes/catalogTags.ts");
 assert.equal(tagsOf("Lentejas estofadas").groups.includes("legume"), true);
 assert.equal(tagsOf("Emperador a la siciliana con tomate cherry, aceitunas y alcaparras").mercury, true);
 assert.equal(tagsOf("Plato que no existe"), null);
});

test("N12: plate suggestions only for what the recipe lacks", () => {
 const {plateSuggestions} = require("../src/lib/menu-generation/recipe-tags.ts");
 const full = {groups: ["legume"], vegGrams: 200, starch: "wholegrain", fruit: true};
 assert.deepEqual(plateSuggestions(full), []);
 const bare = {groups: ["white_fish"], vegGrams: 40, starch: null, fruit: false};
 assert.equal(plateSuggestions(bare).length, 3);
 assert.match(plateSuggestions({...full, starch: "refined"})[0], /integral/);
});

test("N14: at most one dish with ultra-processed ingredients a week, also «Rápido y sencillo»", () => {
 const {catalogTags: tagsOf} = require("../src/lib/recipes/catalogTags.ts");
 const profile = readMenuProfile({});
 for (let seed = 1; seed <= 60; seed++) {
  const upf = weekOf(week(profile, seed, ["quick_simple"], "simple")).filter(dish => tagsOf(dish)?.upf).length;
  assert.ok(upf <= 1, `seed ${seed}: ${upf}`);
 }
});

test("N10: the week summary is positive, cites its source and suggests what is missing", () => {
 const {weekSummary: summaryOf} = require("../src/lib/menu-generation/week-summary.ts");
 const {catalogTags: tagsLookup} = require("../src/lib/recipes/catalogTags.ts");
 const weekSummary = (dishes, profile) => summaryOf(dishes, profile, tagsLookup);
 const profile = readMenuProfile({});
 const good = weekSummary(weekOf(week(profile, 3)), profile);
 assert.ok(good.highlights.some(text => /legumbre/.test(text)));
 // The weekly rules (2026-10-24) ask for more meat and fish than AESAN: no AESAN suggestion.
 assert.deepEqual(good.suggestions, []);
 for (const reason of good.reasons) assert.ok(reason.source.length > 3, reason.topic);
 assert.ok(good.reasons.some(reason => /plan nutricional/.test(reason.source)));
 const meatyWeek = ["Muslos de pavo al horno con patatas", "Hamburguesas de pollo caseras", "Bocadillo de lomo de ternera con vegetales", "Pollo al ras el hanout con cuscús, maíz y guisantes", "Alcachofas con jamón", "Tortilla de patata", "Crema de brócoli"];
 const meaty = weekSummary(meatyWeek, profile);
 assert.ok(meaty.suggestions.some(text => /procesada/.test(text)));
 // Vegetarian and vegan profiles keep the AESAN frequencies, and their suggestions.
 const vegetarian = readMenuProfile({dietaryRestrictions: ["vegetarian"]});
 const fewLegumes = weekSummary(["Tortilla de patata", "Crema de brócoli", "Pisto manchego", "Ensalada de tomate", "Espaguetis al pesto", "Crema de calabaza", "Pizza margarita"], vegetarian);
 assert.ok(fewLegumes.suggestions.some(text => /legumbre/.test(text)));
 const text = normalizeFood(JSON.stringify([good, meaty, fewLegumes]));
 assert.doesNotMatch(text, /malo|prohibid|culpa|engorda|caloria/);
 assert.equal(weekSummary(["Lentejas estofadas"], profile), null, "too few dishes to say anything");
});

test("N09: optional breakfasts and snacks: fruit every day but once, nuts 3+ days, scaled and safe", () => {
 const {dailyExtras} = require("../src/lib/menu-generation/daily-extras.ts");
 const {checkDish, blocksAutomaticProposal} = require("../src/lib/recipes/restriction-check.ts");
 const two = dailyExtras(readMenuProfile({}), 2);
 assert.equal(two.days.length, 7);
 for (const day of two.days) {
  const texts = day.meals.map(m => m.text);
  assert.equal(texts.join(" + ").split("pieza de fruta").length - 1, 1, `${day.dayName}: ${texts.join(" | ")}`);
  for (const food of [/pan integral/, /yogur/, /tortitas/, /nueces|almendras/]) assert.ok(texts.filter(t => food.test(t)).length <= 1, `${day.dayName}: ${food}`);
 }
 assert.ok(two.days.filter(day => /nueces|almendras/.test(day.meals.map(m => m.text).join(" "))).length >= 3);
 const one = dailyExtras(readMenuProfile({}), 1);
 assert.equal(two.items.find(i => i.name === "fruta").quantity, one.items.find(i => i.name === "fruta").quantity * 2);
 for (const allergies of [["milk"], ["nuts"], ["gluten", "milk", "nuts"], ["egg", "gluten"]]) {
  const profile = readMenuProfile({allergies});
  const extras = dailyExtras(profile, 1);
  assert.ok(extras, allergies.join());
  for (const day of extras.days) for (const meal of day.meals) assert.equal(blocksAutomaticProposal(checkDish({title: meal.text, card: null}, profile, {automatic: true})), false, `${allergies}: ${meal.text}`);
 }
});

// --- Phase 3 ---------------------------------------------------------------------------------

test("N16: with the month, dishes with a seasonal vegetable are in season far more often", () => {
 const {catalogTags: tagsOf} = require("../src/lib/recipes/catalogTags.ts");
 const profile = readMenuProfile({});
 // target: the month the dishes are checked against; month: the one the week is created for.
 const share = (month, target) => {
  let seasonal = 0, inSeason = 0;
  for (let seed = 1; seed <= 30; seed++) {
   for (const dish of weekOf(catalogMenu({profile, styles: ["healthy_balanced"], seed, month}))) {
    const season = tagsOf(dish)?.season ?? [];
    if (!season.length) continue;
    seasonal++;
    if (season.includes(target)) inSeason++;
   }
  }
  return inSeason / seasonal;
 };
 for (const month of [1, 4, 7, 10]) {
  const withMonth = share(month, month);
  const without = share(undefined, month);
  // The marked recipes (2026-10-22) have few spring vegetables (April: 12 of 102 in season), so
  // the bar is most of them, or at least three times the share without the month.
  assert.ok(withMonth >= Math.min(0.6, 3 * without) && withMonth >= without, `month ${month}: ${withMonth} (without: ${without})`);
 }
});

test("N19: «Ahorrar tiempo» keeps weekdays within 30 minutes; «Gastar menos» lowers the cost", () => {
 const {catalogTags: tagsOf} = require("../src/lib/recipes/catalogTags.ts");
 const quick = readMenuProfile({goals: ["save_time"]});
 for (let seed = 1; seed <= 40; seed++) {
  const menu = week(quick, seed);
  for (const day of menu.days.slice(0, 5)) for (const dish of [day.lunch.dishName, day.dinner.dishName]) assert.ok((tagsOf(dish)?.minutes ?? 99) <= 30, dish);
 }
 const cost = profile => {
  let total = 0, n = 0;
  for (let seed = 1; seed <= 40; seed++) for (const dish of weekOf(week(profile, seed))) { total += tagsOf(dish)?.cost ?? 2; n++; }
  return total / n;
 };
 assert.ok(cost(readMenuProfile({goals: ["save_money"]})) < cost(readMenuProfile({})));
});

test("N20: the same species at most twice a week and never on consecutive days", () => {
 const {catalogTags: tagsOf} = require("../src/lib/recipes/catalogTags.ts");
 const profile = readMenuProfile({});
 let weeks = 0, clean = 0;
 for (let seed = 1; seed <= 100; seed++) {
  const menu = week(profile, seed);
  const days = new Map();
  menu.days.forEach((day, index) => {
   for (const dish of [day.lunch.dishName, day.dinner.dishName]) {
    const species = tagsOf(dish)?.species;
    if (species) days.set(species, [...(days.get(species) ?? []), index]);
   }
  });
  weeks++;
  if ([...days.values()].every(list => list.length <= 2 && list.every((d, i) => i === 0 || d - list[i - 1] > 1))) clean++;
 }
 // The marked recipes (2026-10-22) have few legumes other than chickpeas (2 of lentils, 3 of
 // beans) and 44 of chicken: the weekly legume minimum repeats chickpeas in some weeks.
 assert.ok(clean / weeks >= 0.8, `${clean}/${weeks}`);
});

test("N18: recipes that use pantry products come first («usa lo que tienes»)", () => {
 const profile = readMenuProfile({});
 const uses = dishes => dishes.filter(dish => (catalogCardForCheck(dish)?.ingredients ?? []).some(i => !i.optional && / garbanzos /.test(` ${normalizeFood(i.name)} `))).length;
 let withPantry = 0, without = 0;
 for (let seed = 1; seed <= 30; seed++) {
  withPantry += uses(weekOf(catalogMenu({profile, styles: ["healthy_balanced"], seed, pantry: ["garbanzos", "sal"]})));
  without += uses(weekOf(catalogMenu({profile, styles: ["healthy_balanced"], seed})));
 }
 assert.ok(withPantry > without, `${withPantry} vs ${without}`);
});

test("N17: «Cocinar una vez para dos comidas»: stews eaten again the next day; bought once, double", () => {
 const {parseLeftover} = require("../src/lib/menu-generation/leftovers.ts");
 const build = require("../src/lib/shopping/build.ts");
 // The weekly rules (2026-10-24) want meat or fish at every lunch, and leftovers are meatless
 // stews: with them a leftover comes only when it breaks no more rules (rare). Vegetarian weeks
 // keep AESAN and their leftovers.
 const profile = readMenuProfile({dietaryRestrictions: ["vegetarian"]});
 const {ruleDish, ruleViolations, defaultMenuRules} = require("../src/lib/menu-generation/menu-rules.ts");
 const rulesOf = menu => ({lunch: menu.days.map(d => ruleDish(d.lunch.dishName, catalogCardForCheck(d.lunch.dishName)?.ingredients ?? null)), dinner: menu.days.map(d => {
  const title = parseLeftover(d.dinner.dishName)?.base ?? d.dinner.dishName;
  return ruleDish(title, catalogCardForCheck(title)?.ingredients ?? null);
 })});
 const omnivore = readMenuProfile({trainingWeekdays: [1, 3, 5], weeklyTrainingDays: 3});
 for (let seed = 1; seed <= 40; seed++) {
  const plain = catalogMenu({profile: omnivore, styles: ["healthy_balanced"], seed});
  const batch = catalogMenu({profile: omnivore, styles: ["healthy_balanced"], seed, batch: true});
  assert.ok(ruleViolations(defaultMenuRules, rulesOf(batch), [1, 3, 5]) <= ruleViolations(defaultMenuRules, rulesOf(plain), [1, 3, 5]), `seed ${seed}`);
 }
 let total = 0;
 for (let seed = 1; seed <= 30; seed++) {
  const menu = catalogMenu({profile, styles: ["healthy_balanced"], seed, batch: true});
  menu.days.forEach((day, index) => {
   const leftover = parseLeftover(day.dinner.dishName);
   if (!leftover) return;
   total++;
   assert.equal(menu.days[index - 1].lunch.dishName, leftover.base);
   assert.ok(!groupsOf(leftover.base).some(g => /meat|fish|seafood|poultry/.test(g)), leftover.base);
  });
 }
 assert.ok(total >= 30, `${total} leftovers in 30 weeks`);
 const days = [
  {day: "Lunes", date: "", lunch: "Lentejas estofadas", dinner: "Tortilla de patata"},
  {day: "Martes", date: "", lunch: "Pisto manchego", dinner: "Lentejas estofadas (sobras del lunes)"},
 ];
 const dishes = build.plannedDishes(days);
 assert.deepEqual(dishes.map(d => [d.title, d.portions ?? 1, d.leftoverOf ?? null]), [["Lentejas estofadas", 2, null], ["Tortilla de patata", 1, null], ["Pisto manchego", 1, null], ["Lentejas estofadas (sobras del lunes)", 1, "lentejas estofadas"]]);
 const card = {baseServings: 2, totalMinutes: 30, steps: ["a", "b", "c"], possibleAllergens: [], ingredients: [{name: "lentejas", quantity: 200, unit: "g", category: "despensa", optional: false}]};
 const result = build.buildDesiredList({dishes, servings: 2, cards: new Map(), aiItems: new Map(), catalogCards: new Map([[build.slotKey(0, "lunch"), card]])});
 assert.equal(result.items.find(i => i.name === "lentejas").quantity, 400);
 assert.ok(!result.pending.some(d => /sobras/.test(d.title)), "the leftover is covered by its recipe");
 // Without a recipe for the dish, the leftover is a dish of its own (asked like any other).
 const noRecipe = build.buildDesiredList({dishes, servings: 2, cards: new Map(), aiItems: new Map(), catalogCards: new Map()});
 assert.ok(noRecipe.pending.some(d => /sobras/.test(d.title)));
 // The week keeps its frequencies and the protein rule with leftovers.
 const {mainProtein: proteinOf} = require("../src/lib/menu-generation/food-groups.ts");
 let ok = 0;
 for (let seed = 1; seed <= 100; seed++) {
  const menu = catalogMenu({profile, styles: ["healthy_balanced"], seed, batch: true});
  const titles = weekOf(menu).map(t => parseLeftover(t)?.base ?? t);
  if (meetsQuotas(countGroups(titles.map(groupsOf)), weekQuotas(profile))) ok++;
  menu.days.forEach(day => {
   const leftover = parseLeftover(day.dinner.dishName);
   if (leftover) assert.notEqual(proteinOf(groupsOf(leftover.base)), proteinOf(groupsOf(day.lunch.dishName)), day.dayName);
  });
 }
 assert.ok(ok >= 95, `${ok}/100`);
});
