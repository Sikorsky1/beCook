const {test} = require("node:test");
const assert = require("node:assert/strict");
const OpenAI = require("openai").default;
const {readMenuProfile, buildMenuInput} = require("../src/lib/menu-generation/prompt.ts");
const {selectionToMenu, visibleFoodConflict, dayNames} = require("../src/lib/menu-generation/validation.ts");
const {createMenuCompletion} = require("../src/lib/menu-generation/runtime.ts");
const {isImportedMenuResponse, importedMenuToWeekDays} = require("../src/lib/importMenu.ts");
const {weekDaysToSupabaseWeek, withWeekDates} = require("../src/lib/weekStorage.ts");
const {estimateOpenAICostUsd} = require("../src/lib/openai/cost.ts");
const {installFakeBackends, aiRequest, foodContextFor} = require("./helpers/fake-backends.cjs");
const profile = readMenuProfile(null);
const selection = {
 lunches: ["Pollo asado con batata", "Lentejas estofadas", "Arroz meloso de sepia", "Espaguetis con setas", "Garbanzos con espinacas", "Merluza al horno", "Paella de pollo"],
 dinners: ["Tortilla de patata", "Ensalada de tomate y queso fresco", "Salmón a la plancha", "Crema de calabaza", "Revuelto de champiñones", "Bacalao al pilpil", "Tosta de aguacate"],
};
test("maps exactly seven ordered days and planned slots into existing storage contract", () => {
 const menu = selectionToMenu(selection, profile);
 assert.ok(isImportedMenuResponse(menu));
 assert.deepEqual(menu.days.map(d => d.dayName), dayNames);
 assert.equal(weekDaysToSupabaseWeek(withWeekDates(importedMenuToWeekDays(menu.days, {isoYear:2026,isoWeek:38}), {isoYear:2026,isoWeek:38})).days.length, 7);
 assert.equal(menu.days[6].dinner.status, "planned");
});
test("rejects incomplete, blank, duplicate and generic output", () => {
 for(const value of [null, {lunches:[],dinners:[]}, {...selection,lunches:["",...selection.lunches.slice(1)]}, {...selection,lunches:[selection.dinners[0],...selection.lunches.slice(1)]}, {...selection,lunches:["Pescado con verduras",...selection.lunches.slice(1)]}]) assert.throws(() => selectionToMenu(value,profile));
 assert.throws(() => selectionToMenu({...selection,lunches:[" SALMÓN A LA PLANCHA ",...selection.lunches.slice(1)]},profile), /duplicate/);
});
test("blocks visible dietary/allergen conflicts including accents and compound dishes", () => {
 for (const [key, restriction, dish] of [["allergies","nuts","Espaguetis al pesto"],["allergies","shellfish","Arroz de gambas"],["allergies","egg","Tortilla de patata"],["allergies","lactose","Ensalada con feta"],["allergies","gluten","Tosta de tomate"],["dietaryRestrictions","vegan","Crema con nata"],["dietaryRestrictions","vegetarian","Espaguetis a la boloñesa"],["dietaryRestrictions","pescatarian","Pollo al limón"],["dietaryRestrictions","no_pork","Alcachofas con jamón"],["dietaryRestrictions","no_alcohol","Pollo al vino"],["dietaryRestrictions","no_pork","Espaguetis carbonara"],["dietaryRestrictions","no_pork","Fabada asturiana"],["dietaryRestrictions","vegan","Yogur con miel"],["allergies","nuts","Pollo con salsa satay"]]) assert.ok(visibleFoodConflict(dish, readMenuProfile({[key]:[restriction]})),dish);
 assert.equal(visibleFoodConflict("Garbanzos con espinacas",readMenuProfile({dietaryRestrictions:["vegan"]})), false);
 // C3: «otras alergias» also block generated dishes; nutmeg and coconut milk are not nuts or dairy.
 assert.ok(visibleFoodConflict("Pollo al sésamo",readMenuProfile({allergies:["other"],otherAllergies:"sésamo"})));
 assert.equal(visibleFoodConflict("Crema de calabaza con nuez moscada",readMenuProfile({allergies:["nuts"]})), false);
 assert.equal(visibleFoodConflict("Curry de garbanzos con leche de coco",readMenuProfile({allergies:["lactose"]})), false);
 assert.throws(() => selectionToMenu(selection,readMenuProfile({dietaryRestrictions:["vegetarian"]})), /restriction/);
});
test("keeps weekly requests and safety constraints distinct; filters examples without claiming ingredient safety", () => {
 const input = buildMenuInput({peopleCount:2,freeTextPrompt:"Quiero pasta con setas",profile:{id:"private-id",allergies:[]}},readMenuProfile({id:"private-id",birthDate:"1990-01-01",dislikedFoods:["pasta"],allergies:["nuts"],otherAllergies:"sésamo"}));
 const data = JSON.parse(input.userPrompt);
 assert.equal(data.weeklyRequest,"Quiero pasta con setas");
 assert.deepEqual(data.preferences.dislikedFoods,["pasta"]);
 assert.equal(data.mandatory.otherAllergies,"sésamo");
 assert.ok(data.nutritionistExamples.every(n => !/pesto/.test(n)));
 assert.ok(!input.userPrompt.includes("private-id"));
 assert.throws(() => readMenuProfile({allergies:"nuts"}));
 assert.throws(() => readMenuProfile({otherAllergies:"a".repeat(1001)}));
 assert.deepEqual(data.mandatory.allergies,["nuts"], "the profile argument decides, never body.profile");
 assert.throws(() => buildMenuInput({peopleCount:7},profile));
});
test("cost includes cache reads and cache write surcharge at current standard prices", () => {
 assert.equal(estimateOpenAICostUsd({model:"gpt-5.6-sol",promptTokens:2000,cachedPromptTokens:1000,cacheWriteTokens:1000,completionTokens:100}),0.0074);
 assert.equal(estimateOpenAICostUsd({model:"unknown",promptTokens:1,completionTokens:1}),null);
});
test("transport: one call normally, one fallback on 503, none on 429/400; SDK retries disabled", async () => {
 for(const statuses of [[200],[503,200],[429],[400],[503,503]]) {
  let count=0; const attempts=[];
  const client = new OpenAI({apiKey:"synthetic-test-key",maxRetries:0,fetch:async (_url, options) => {
   const body=JSON.parse(options.body);
   assert.equal(body.reasoning_effort,"none");
   assert.equal(body.max_completion_tokens,1200);
   const status=statuses[count++];
   assert.ok(status,"unexpected retry");
   return new Response(JSON.stringify(status===200 ? {choices:[],usage:{}} : {error:{message:"synthetic",code:"test"}}),{status,headers:{"Content-Type":"application/json"}});
  }});
  if(statuses.at(-1)===200) await createMenuCompletion(client,"synthetic",attempts);
  else await assert.rejects(createMenuCompletion(client,"synthetic",attempts));
  assert.equal(count,statuses.length);
  assert.equal(attempts.length,statuses.length);
 }
});
test("HTTP route rejects invalid input before billing and invalid output without regeneration", async () => {
 let responseSelection = selection;
 // Synthetic verified session (A3) and usage ledger (A4): the route only bills after both accept.
 const fakes = installFakeBackends(() => Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(responseSelection)}}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}}));
 try {
  const {POST} = require("../src/app/api/generate-menu/route.ts");
  // A weekly request in words goes to the AI; without one the catalogue answers (tested below).
  const request = body => aiRequest("generate-menu", {freeTextPrompt: "algo de cuchara", ...body});
  assert.equal((await POST(request({peopleCount:8}))).status,400);
  assert.equal(fakes.openAICalls,0);
  assert.equal(fakes.begin.length,0, "invalid input never opens a usage record");
  const success = await POST(request({peopleCount:2}));
  assert.equal(success.status,200);
  assert.ok(success.headers.get("Server-Timing"));
  assert.equal((await success.json()).days.length,7);
  responseSelection = {...selection,lunches:[]};
  assert.equal((await POST(request({peopleCount:2}))).status,422);
  assert.equal(fakes.openAICalls,2);
  responseSelection = selection;
  // C1: the saved profile (read on the server) is what the menu is validated against.
  fakes.foodContext = foodContextFor({dietaryRestrictions:["vegetarian"]});
  assert.equal((await POST(request({peopleCount:2}))).status,422);
  assert.equal(fakes.openAICalls,3);
  assert.deepEqual(fakes.finish.map(f => f.p_status), ["succeeded","failed","failed"]);
 } finally {
  fakes.restore();
 }
});

const {catalogMenu, catalogRecipes, readCatalogMenuStyles} = require("../src/lib/menu-generation/catalog-menu.ts");
const {normalizeFood} = require("../src/lib/menu-generation/validation.ts");
const {dishGroups, mainProtein} = require("../src/lib/menu-generation/food-groups.ts");
const weekOf = menu => menu.days.flatMap(d => [d.lunch.dishName, d.dinner.dishName]);
// A title may be in the catalogue twice (once per meal), with its own types.
const hasStyle = (name, style) => catalogRecipes.some(r => r.name === name && r.menuStyles.includes(style));

test("catalogue week: 14 different catalogue recipes in their meal, of the chosen type", () => {
 for (const seed of [1, 2, 3, 4, 5]) {
  const menu = catalogMenu({profile, styles: ["mediterranean"], seed});
  assert.ok(isImportedMenuResponse(menu));
  const dishes = weekOf(menu);
  assert.equal(new Set(dishes.map(normalizeFood)).size, 14);
  menu.days.forEach(d => {
   assert.ok(catalogRecipes.some(r => r.name === d.lunch.dishName && r.slot === "lunch"));
   assert.ok(catalogRecipes.some(r => r.name === d.dinner.dishName && r.slot === "dinner"));
  });
  // N05: the AESAN frequencies come before the type, so a legume or a fish of another type may fill a gap.
  assert.ok(dishes.filter(n => hasStyle(n, "mediterranean")).length >= 12, "nearly every dish of the chosen type");
  const protein = n => mainProtein(dishGroups(n));
  assert.ok(menu.days.filter(d => protein(d.lunch.dishName) && protein(d.lunch.dishName) === protein(d.dinner.dishName)).length <= 1, "lunch and dinner proteins differ");
 }
 assert.notDeepEqual(weekOf(catalogMenu({profile, styles: ["quick_simple"], seed: 1})), weekOf(catalogMenu({profile, styles: ["quick_simple"], seed: 2})), "another seed, another week");
 assert.deepEqual(readCatalogMenuStyles(["quick_simple", "nope"]), ["quick_simple"]);
 // N06: the body-composition types are no longer offered; a request with them reads as the default.
 assert.deepEqual(readCatalogMenuStyles(["high_protein", "fat_loss", "muscle_gain"]), ["healthy_balanced"]);
 assert.deepEqual(readCatalogMenuStyles(undefined), ["healthy_balanced"]);
});

// 2026-10-22: beCook proposes only the recipes Sergio marked (recipe-selection.json); the full
// catalogue stays for the recipe cards of older weeks.
test("only marked recipes: Crear menú, «Otra idea» and the AI's examples", () => {
 const fs = require("node:fs");
 const path = require("node:path");
 const full = require("../src/data/nutritionist-recipes.json").recipes;
 const selection = require("../src/data/recipe-selection.json").recipes.map(r => r.id);
 const markedIds = new Set(selection);
 assert.equal(markedIds.size, selection.length);
 assert.ok(full.length > markedIds.size, "the full catalogue is kept whole");
 assert.deepEqual(new Set(catalogRecipes.map(r => r.id)), markedIds);
 const markedTitle = (name, slot) => full.some(r => markedIds.has(r.id) && r.name === name && (!slot || r.slot === slot));
 for (let seed = 1; seed <= 100; seed++) {
  const menu = catalogMenu({profile, styles: ["healthy_balanced"], seed, batch: seed % 2 === 0});
  menu.days.forEach(d => {
   assert.ok(markedTitle(d.lunch.dishName, "lunch"), d.lunch.dishName);
   // A batch dinner is the lunch of the day before, eaten again.
   const leftover = /^(.+?) \(sobras del [^)]+\)$/.exec(d.dinner.dishName);
   assert.ok(leftover ? markedTitle(leftover[1], "lunch") : markedTitle(d.dinner.dishName, "dinner"), d.dinner.dishName);
  });
 }
 const {catalogAlternative} = require("../src/lib/menu-generation/substitution.ts");
 const rejected = [];
 for (let i = 0; i < 10; i++) {
  const idea = catalogAlternative({day: "Lunes", meal: "dinner", currentDish: "Lentejas estofadas", otherDishes: [], rejected: [...rejected]}, profile);
  assert.ok(idea && markedIds.has(idea.recipeId), JSON.stringify(idea));
  rejected.push(idea.dish);
 }
 const examples = JSON.parse(buildMenuInput({peopleCount: 2, freeTextPrompt: "pescado", menuStyle: ["healthy_balanced"]}, profile).userPrompt).nutritionistExamples;
 assert.ok(examples.length && examples.every(name => markedTitle(name)), examples.filter(name => !markedTitle(name)).join(" / "));
 // One access point: no generator reads the full catalogue directly.
 for (const file of ["src/lib/menu-generation/catalog-menu.ts", "src/lib/menu-generation/substitution.ts", "src/lib/nutritionPlan.ts", "src/lib/menu-generation/plan-week.ts"]) {
  assert.ok(!fs.readFileSync(path.join(__dirname, "..", file), "utf8").includes("nutritionist-recipes.json\""), file);
 }
});

test("the level of elaboration is gone: no selector, no score; older requests that send it are ignored", async () => {
 const fs = require("node:fs");
 const path = require("node:path");
 const page = fs.readFileSync(path.join(__dirname, "../src/components/pages/CreateMenuPage.tsx"), "utf8");
 assert.ok(!/Nivel de elaboración|elaborationLevel|Sencillo|Elaborado/.test(page));
 assert.ok(catalogRecipes.every(r => !("elaboration" in r)));
 // The same week whatever an older page sends.
 const plain = weekOf(catalogMenu({profile, styles: ["mediterranean"], seed: 11}));
 assert.deepEqual(weekOf(catalogMenu({profile, styles: ["mediterranean"], seed: 11, elaboration: "simple"})), plain);
 assert.deepEqual(weekOf(catalogMenu({profile, styles: ["mediterranean"], seed: 11, elaboration: "elaborate"})), plain);
 // The AI gets no difficulty.
 const now = new Date("2026-10-22T10:00:00Z");
 const easy = buildMenuInput({peopleCount: 2, freeTextPrompt: "pescado", menuStyle: ["mediterranean"], elaborationLevel: 2}, profile, now);
 const hard = buildMenuInput({peopleCount: 2, freeTextPrompt: "pescado", menuStyle: ["mediterranean"], elaborationLevel: 6}, profile, now);
 const none = buildMenuInput({peopleCount: 2, freeTextPrompt: "pescado", menuStyle: ["mediterranean"]}, profile, now);
 assert.equal(easy.userPrompt, none.userPrompt);
 assert.equal(hard.userPrompt, none.userPrompt);
 assert.ok(!("difficulty" in JSON.parse(none.userPrompt)));
 const {menuSystemPrompt} = require("../src/lib/menu-generation/prompt.ts");
 assert.ok(!/dificultad/.test(menuSystemPrompt));
 // The route answers an older request with the level as any other.
 const fakes = installFakeBackends(() => { throw new Error("OpenAI must not be called"); });
 try {
  const {POST} = require("../src/app/api/generate-menu/route.ts");
  for (const elaborationLevel of [2, 6, "x"]) {
   const response = await POST(aiRequest("generate-menu", {peopleCount: 2, menuStyle: ["healthy_balanced"], elaborationLevel}));
   assert.equal(response.status, 200);
  }
 } finally {
  fakes.restore();
 }
});

test("catalogue week: allergies, diets, disliked foods and recent dishes leave recipes out", () => {
 for (const [key, value] of [["allergies","gluten"],["allergies","lactose"],["allergies","egg"],["allergies","nuts"],["allergies","shellfish"],["dietaryRestrictions","vegetarian"],["dietaryRestrictions","pescatarian"],["dietaryRestrictions","no_pork"]]) {
  const restricted = readMenuProfile({[key]: [value]});
  for (const seed of [7, 8]) {
   const menu = catalogMenu({profile: restricted, styles: ["healthy_balanced"], seed});
   assert.ok(menu, `${value}: the catalogue fills the week`);
   for (const dish of weekOf(menu)) assert.equal(visibleFoodConflict(dish, restricted), false, `${value}: ${dish}`);
  }
 }
 // Minced meat usually carries breadcrumbs and egg; pasta shapes and noodles carry gluten.
 const gluten = readMenuProfile({allergies: ["gluten"]});
 for (const dish of ["Albóndigas de pollo y champiñón salteado", "Noodles salteados con brócoli y pollo", "Ensalada de fusilli con mozzarella, atún y tomate cherry", "Hamburguesas de atún fresco"]) assert.ok(visibleFoodConflict(dish, gluten), dish);
 const dislikes = readMenuProfile({dislikedFoods: ["garbanzos", "salmón"]});
 assert.ok(weekOf(catalogMenu({profile: dislikes, styles: ["healthy_balanced"], seed: 3})).every(d => !/garbanzo|salm[oó]n/i.test(d)));
 const first = weekOf(catalogMenu({profile, styles: ["healthy_balanced"], seed: 9}));
 const next = weekOf(catalogMenu({profile, styles: ["healthy_balanced"], recentDishes: first, seed: 9}));
 assert.ok(next.every(d => !first.includes(d)), "recent weeks are not repeated");
 // Nothing left for a meal: no catalogue week (the AI decides). The marked recipes (2026-10-22)
 // have only four vegan lunches and dinners, so a vegan week always goes to the AI.
 const vegan = readMenuProfile({dietaryRestrictions: ["vegan"]});
 assert.equal(catalogMenu({profile: vegan, styles: ["healthy_balanced"], seed: 1}), null);
 const vegetarian = readMenuProfile({dietaryRestrictions: ["vegetarian"]});
 const vegetarianDinners = catalogRecipes.filter(r => r.slot === "dinner" && !visibleFoodConflict(r.name, vegetarian)).map(r => r.name);
 assert.equal(catalogMenu({profile: vegetarian, styles: ["healthy_balanced"], recentDishes: vegetarianDinners, seed: 1}), null);
});

test("HTTP route: without a weekly request the catalogue answers, without OpenAI, quota or cost", async () => {
 const fakes = installFakeBackends(() => { throw new Error("OpenAI must not be called"); });
 try {
  const {POST} = require("../src/app/api/generate-menu/route.ts");
  const response = await POST(aiRequest("generate-menu", {peopleCount: 2, menuStyle: ["quick_simple"], elaborationLevel: 6}));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.days.length, 7);
  assert.ok(weekOf(data).filter(n => hasStyle(n, "quick_simple")).length >= 12);
  assert.deepEqual({model: data.openaiTelemetry.modelUsed, cost: data.openaiTelemetry.estimatedCostUsd}, {model: "catalog", cost: 0});
  assert.equal(fakes.openAICalls, 0);
  assert.equal(fakes.begin.length, 0, "no usage record: the catalogue is free and outside the AI quota");
  // A weekly request in words still goes to the AI, with a short sample of the catalogue.
  const input = buildMenuInput({peopleCount: 2, freeTextPrompt: "pescado al horno", menuStyle: ["mediterranean"], elaborationLevel: 2}, profile);
  const examples = JSON.parse(input.userPrompt).nutritionistExamples;
  const own = new Set(catalogRecipes.filter(r => r.id.startsWith("nutri-")).map(r => r.name));
  const sample = examples.filter(n => !own.has(n));
  assert.ok(examples.includes("Pollo asado con batata"), "the nutritionist's recipes are always references");
  assert.ok(sample.length > 0 && sample.length <= 40);
  assert.ok(sample.every(n => hasStyle(n, "mediterranean")));
 } finally {
  fakes.restore();
 }
});
