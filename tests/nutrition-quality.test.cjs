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
const {countGroups, meetsQuotas, weekQuotas, withinMaximums} = require("../src/lib/menu-generation/quotas.ts");
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
const week = (profile, seed, styles = ["healthy_balanced"], elaboration = "balanced") => catalogMenu({profile, styles, elaboration, seed});

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
  for (const dish of weekOf(week(vegan, seed))) {
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

test("N05: ≥95 % of weeks keep the AESAN frequencies; the meat maximum never gives way", () => {
 const profile = readMenuProfile({});
 const quotas = weekQuotas(profile);
 let ok = 0;
 const weeks = 200;
 for (let seed = 1; seed <= weeks; seed++) {
  const counts = countGroups(weekOf(week(profile, seed)).map(groupsOf));
  if (meetsQuotas(counts, quotas)) ok++;
  assert.ok(withinMaximums(counts, quotas), `seed ${seed}`);
 }
 assert.ok(ok / weeks >= 0.95, `${ok}/${weeks}`);
 for (const styles of [["mediterranean"], ["quick_simple"], ["healthy_balanced", "quick_simple"]]) {
  for (let seed = 1; seed <= 40; seed++) {
   const counts = countGroups(weekOf(week(profile, seed, styles, "simple")).map(groupsOf));
   assert.ok(counts.meat <= 3 && counts.redMeat <= 1 && counts.processedMeat === 0 && counts.egg <= 4, `${styles} ${seed}`);
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
 const plants = readMenuProfile({goals: ["more_plants"]});
 let ok = 0;
 for (let seed = 1; seed <= 60; seed++) if (countGroups(weekOf(week(plants, seed)).map(groupsOf)).legume >= 5) ok++;
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
 const {weekSummary} = require("../src/lib/menu-generation/week-summary.ts");
 const profile = readMenuProfile({});
 const good = weekSummary(weekOf(week(profile, 3)), profile);
 assert.ok(good.highlights.some(text => /legumbre/.test(text)));
 assert.deepEqual(good.suggestions, []);
 for (const reason of good.reasons) assert.ok(reason.source.length > 3, reason.topic);
 const meaty = weekSummary(["Muslos de pavo al horno con patatas", "Hamburguesas de pollo caseras", "Bocadillo de lomo de ternera con vegetales", "Pollo al ras el hanout con cuscús, maíz y guisantes", "Alcachofas con jamón", "Tortilla de patata", "Crema de brócoli"], profile);
 assert.ok(meaty.suggestions.some(text => /legumbre/.test(text)));
 const text = normalizeFood(JSON.stringify([good, meaty]));
 assert.doesNotMatch(text, /malo|prohibid|culpa|engorda|caloria/);
 assert.equal(weekSummary(["Lentejas estofadas"], profile), null, "too few dishes to say anything");
});

test("N09: optional breakfasts and snacks: fruit at least twice a day, nuts 3+ days, scaled and safe", () => {
 const {dailyExtras} = require("../src/lib/menu-generation/daily-extras.ts");
 const {checkDish, blocksAutomaticProposal} = require("../src/lib/recipes/restriction-check.ts");
 const two = dailyExtras(readMenuProfile({}), 2);
 assert.equal(two.days.length, 7);
 for (const day of two.days) assert.ok(day.meals.map(m => m.text).join(" + ").split("pieza de fruta").length - 1 >= 2, day.dayName);
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
