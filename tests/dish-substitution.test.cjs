const {test, beforeEach, afterEach} = require("node:test");
const assert = require("node:assert/strict");
const catalog = require("../src/data/nutritionist-recipes.json");
const {culinaryIssue} = require("../src/lib/menu-generation/culinary-rules.ts");
const {readMenuProfile} = require("../src/lib/menu-generation/prompt.ts");
const {selectionToMenu} = require("../src/lib/menu-generation/validation.ts");
const {catalogAlternative, checkReplacement, replaceSlot, substitutionRequestFor, validateSubstitutedWeek, readSubstitutionRequest} = require("../src/lib/menu-generation/substitution.ts");
const {nextCatalogIdea} = require("../src/lib/dishSubstitution.ts");
const {installFakeBackends, aiRequest, foodContextFor} = require("./helpers/fake-backends.cjs");

// Synthetic data only: no real Supabase project or OpenAI key is contacted.
const anyone = readMenuProfile(null);
const vegan = {dietaryRestrictions: ["vegan"]};
// Every vegan-compatible catalogue recipe, so the catalogue has nothing left for a vegan week.
const veganCatalog = ["Lentejas estofadas", "Espaguetis con brócoli", "Escalibada", "Espárragos, berenjena, calabacín y zanahoria plancha"];
const selection = {
 lunches: ["Pollo asado con batata", "Lentejas estofadas", "Arroz meloso de sepia", "Espaguetis con setas", "Garbanzos con espinacas", "Merluza al horno", "Paella de pollo"],
 dinners: ["Tortilla de patata", "Ensalada de tomate y queso fresco", "Salmón a la plancha", "Crema de calabaza", "Revuelto de champiñones", "Bacalao al pilpil", "Tosta de aguacate"],
};
const week = selection.lunches.map((lunch, i) => ({day: ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"][i], date: `${12 + i} oct`, lunch, dinner: selection.dinners[i]}));

test("culinary rules reject indeterminate sauces and dressings", () => {
 for (const dish of ["Pollo con salsa especial", "Merluza en salsa", "Pasta con salsa de la casa", "Ensalada con aliño especial", "Solomillo con salsa secreta", "Pollo con salsa casera", "Costillas con salsa al gusto", "Lubina con guarnición a elegir", "Hamburguesa con salsa del chef", "Tacos con ingrediente secreto", "Pollo asado con su salsa", "Pavo con salsas variadas", "Salmón con marinada sorpresa"]) {
  assert.ok(culinaryIssue(dish), dish);
 }
});

test("culinary rules accept concrete sauces and traditional names", () => {
 for (const dish of ["Pollo con salsa de tomate", "Merluza en salsa verde", "Albóndigas en salsa", "Patatas con salsa brava", "Salmón con salsa de yogur y eneldo", "Espaguetis al pesto", "Bacalao a la vizcaína", "Bacalao al pil pil", "Pollo con salsa teriyaki y arroz", "Albóndigas con salsa de tomate casera", "Pollo en salsa de almendras", "Coliflor con salsa bechamel", "Ensalada de garbanzos con aliño de limón", "Tortilla de patata", "Escalibada"]) {
  assert.equal(culinaryIssue(dish), null, dish);
 }
 for (const recipe of catalog.recipes) assert.equal(culinaryIssue(recipe.name), null, recipe.name);
});

test("pesto counts as dairy (cheese) for vegan and lactose profiles", () => {
 const {visibleFoodConflict} = require("../src/lib/menu-generation/validation.ts");
 assert.ok(visibleFoodConflict("Espaguetis al pesto", readMenuProfile(vegan)));
 assert.ok(visibleFoodConflict("Espaguetis al pesto", readMenuProfile({allergies: ["lactose"]})));
});

test("generated menus with an indeterminate dish are rejected", () => {
 assert.throws(() => selectionToMenu({...selection, dinners: ["Pollo con salsa especial", ...selection.dinners.slice(1)]}, anyone), /ambiguous_dish/);
 assert.doesNotThrow(() => selectionToMenu({...selection, dinners: ["Merluza en salsa verde", ...selection.dinners.slice(1)]}, anyone));
});

test("catalogue idea is compatible, new for the week and never a discarded one", () => {
 const slot = {day: "Martes", meal: "lunch"};
 const request = substitutionRequestFor(week, slot, []);
 assert.equal(request.currentDish, "Lentejas estofadas");
 assert.equal(request.otherDishes.length, 13);
 const first = catalogAlternative(request, anyone);
 assert.ok(first);
 assert.equal(checkReplacement(first.dish, request, anyone), null);
 assert.equal(catalog.recipes.find(r => r.id === first.recipeId).slot, "lunch", "same meal first");
 const second = catalogAlternative(substitutionRequestFor(week, slot, [first.dish]), anyone);
 assert.notEqual(second.dish, first.dish);
 // Restrictions and free-text constraints are applied to every catalogue idea.
 const vegetarian = readMenuProfile({dietaryRestrictions: ["vegetarian"], allergies: ["gluten"], dislikedFoods: ["brócoli"], otherAllergies: "berenjena"});
 const seen = [];
 for (let idea; (idea = catalogAlternative(substitutionRequestFor(week, slot, seen), vegetarian)); ) seen.push(idea.dish);
 assert.ok(seen.length > 0);
 for (const dish of seen) assert.doesNotMatch(dish, /pollo|pavo|cordero|jamón|salmón|bacalao|merluza|pulpo|anchoas|ventresca|gambas|espaguetis|tosta|brócoli|berenjena/i, dish);
 // Exhausted: nothing compatible is left.
 const veganWeek = replaceSlot(week, {day: "Lunes", meal: "lunch"}, "Crema de calabaza").map((day, i) => ({...day, dinner: i < veganCatalog.length ? veganCatalog[i] : day.dinner}));
 assert.equal(catalogAlternative(substitutionRequestFor(veganWeek, {day: "Lunes", meal: "lunch"}, []), readMenuProfile(vegan)), null);
 assert.deepEqual(nextCatalogIdea(veganWeek, {day: "Lunes", meal: "lunch"}, [], vegan), {status: "catalog_exhausted"});
 assert.equal(nextCatalogIdea(week, slot, [], {allergies: "nuts"}).status, "error", "malformed safety constraints are never ignored");
});

test("«Otra idea» del catálogo no repite descartes aunque haya más de diez (ola 4, D-3)", () => {
 // The page (Crear menú and Semana) passes every dish shown and discarded in this slot.
 const slot = {day: "Martes", meal: "lunch"};
 const rejected = [];
 for (let round = 0; round < catalog.recipes.length + 2; round++) {
  const idea = nextCatalogIdea(week, slot, rejected, null);
  if (idea.status === "catalog_exhausted") break;
  assert.equal(idea.status, "found");
  assert.ok(!rejected.includes(idea.dish), `ronda ${round + 1}: «${idea.dish}» ya se había descartado`);
  rejected.push(idea.dish);
 }
 assert.ok(rejected.length > substitutionLimitsMaxRejected(), "more ideas than the API body keeps");
 assert.deepEqual(nextCatalogIdea(week, slot, rejected, null), {status: "catalog_exhausted"});
 // The API body still carries only the latest ten.
 assert.equal(substitutionRequestFor(week, slot, rejected).rejected.length, substitutionLimitsMaxRejected());
});

function substitutionLimitsMaxRejected() {
 return require("../src/lib/menu-generation/substitution.ts").substitutionLimits.maxRejected;
}

test("replacement checks: same, duplicate, discarded, conflict, disliked, generic, ambiguous", () => {
 const request = substitutionRequestFor(week, {day: "Martes", meal: "lunch"}, ["Pollo al limón"]);
 const profile = readMenuProfile({allergies: ["nuts"], dislikedFoods: ["coliflor"]});
 const cases = [["", "invalid_dish"], ["Lentejas estofadas", "same_dish"], [" TORTILLA DE PATATA ", "duplicate_dish"], ["Pollo al limón", "already_rejected"], ["Espaguetis al pesto", "restriction_conflict"], ["Coliflor gratinada", "disliked_food"], ["Pescado con verduras", "generic_dish"], ["Pollo con salsa especial", "ambiguous_dish"], ["Garbanzos con espinacas y comino", null]];
 for (const [dish, issue] of cases) assert.equal(checkReplacement(dish, request, profile), issue, dish);
});

test("substitution keeps the other thirteen dishes and revalidates the whole menu", () => {
 const slot = {day: "Jueves", meal: "dinner"};
 const after = replaceSlot(week, slot, "Merluza en salsa verde con patata");
 assert.equal(after.filter((day, i) => day.lunch !== week[i].lunch || day.dinner !== week[i].dinner).length, 1);
 assert.equal(after[3].dinner, "Merluza en salsa verde con patata");
 assert.equal(validateSubstitutedWeek(week, after, slot, anyone), null);
 const touchedOther = replaceSlot(after, {day: "Lunes", meal: "lunch"}, "Pollo al limón");
 assert.equal(validateSubstitutedWeek(week, touchedOther, slot, anyone), "other_slots_changed");
 assert.equal(validateSubstitutedWeek(week, replaceSlot(week, slot, "Salmón a la plancha"), slot, anyone), "duplicate_dish");
});

test("request parsing bounds every field", () => {
 assert.deepEqual(readSubstitutionRequest({day: "Lunes", meal: "dinner", currentDish: "LIBRE", otherDishes: ["LIBRE", " Escalibada "]}), {day: "Lunes", meal: "dinner", currentDish: "", otherDishes: ["Escalibada"], rejected: []});
 for (const body of [{day: "lunes", meal: "lunch"}, {day: "Lunes", meal: "brunch"}, {day: "Lunes", meal: "lunch", otherDishes: Array(14).fill("x")}, {day: "Lunes", meal: "lunch", rejected: Array(11).fill("x")}, {day: "Lunes", meal: "lunch", currentDish: "x".repeat(111)}, {day: "Lunes", meal: "lunch", otherDishes: [1]}]) {
  assert.throws(() => readSubstitutionRequest(body), /invalid_substitution/, JSON.stringify(body).slice(0, 60));
 }
});

let fakes;
let aiReply;
let logs;
const originalInfo = console.info;
beforeEach(() => {
 aiReply = () => Response.json({choices: [{finish_reason: "stop", message: {content: JSON.stringify({dish: "Garbanzos con espinacas y comino"})}}], usage: {prompt_tokens: 400, completion_tokens: 20, total_tokens: 420}});
 fakes = installFakeBackends((url, init) => { fakes.lastBody = JSON.parse(init.body); return aiReply(); });
 // C1: the route reads the saved profile (vegan here); the profile in the body is ignored.
 fakes.foodContext = foodContextFor(vegan);
 logs = [];
 console.info = (...args) => logs.push(JSON.stringify(args));
});
afterEach(() => { fakes.restore(); console.info = originalInfo; });

const {POST} = require("../src/app/api/substitute-dish/route.ts");
const veganBody = {profile: null, day: "Lunes", meal: "lunch", currentDish: "Crema de calabaza", otherDishes: veganCatalog, rejected: []};

test("route: a compatible catalogue recipe is returned without AI, quota or cost", async () => {
 const response = await POST(aiRequest("substitute-dish", {profile: null, day: "Martes", meal: "lunch", currentDish: "Lentejas estofadas", otherDishes: []}));
 assert.equal(response.status, 200);
 const data = await response.json();
 assert.equal(data.source, "catalog");
 assert.ok(catalog.recipes.some(r => r.name === data.dish));
 assert.equal(fakes.openAICalls, 0);
 assert.equal(fakes.begin.length, 0);
});

test("route: catalogue exhausted -> one bounded AI attempt, billed as a menu", async () => {
 const response = await POST(aiRequest("substitute-dish", veganBody));
 assert.equal(response.status, 200);
 const {foodContext, ...idea} = await response.json();
 assert.deepEqual(idea, {dish: "Garbanzos con espinacas y comino", source: "ai"});
 assert.deepEqual(foodContext.dietaryRestrictions, ["vegan"]);
 assert.ok(response.headers.get("X-Request-Id"));
 assert.equal(fakes.openAICalls, 1);
 assert.equal(fakes.lastBody.max_completion_tokens, 120);
 assert.equal(fakes.lastBody.response_format.json_schema.name, "dish_substitution");
 const prompt = JSON.parse(fakes.lastBody.messages[1].content);
 assert.deepEqual(prompt.otherDishesThisWeek, veganCatalog);
 assert.deepEqual(prompt.mandatory.dietaryRestrictions, ["vegan"]);
 assert.equal(fakes.begin.length, 1);
 assert.equal(fakes.begin[0].p_flow, "menu");
 assert.equal(fakes.finish.length, 1);
 assert.equal(fakes.finish[0].p_status, "succeeded");
 assert.ok(fakes.finish[0].p_cost_usd > 0, "cost recorded");
 assert.ok(!logs.join("").includes("Garbanzos"), "no dishes in logs");
});

test("route: invalid AI output -> 422 without retry or repair, failure recorded", async () => {
 for (const [dish, issue] of [["Garbanzos con salsa especial", "ambiguous_dish"], ["Pollo al ajillo con patatas", "restriction_conflict"], ["Escalibada", "duplicate_dish"], ["Crema de calabaza", "same_dish"]]) {
  fakes.openAICalls = 0; fakes.finish.length = 0;
  aiReply = () => Response.json({choices: [{finish_reason: "stop", message: {content: JSON.stringify({dish})}}], usage: {prompt_tokens: 400, completion_tokens: 20, total_tokens: 420}});
  const response = await POST(aiRequest("substitute-dish", veganBody));
  assert.equal(response.status, 422, dish);
  assert.equal((await response.json()).reason, issue);
  assert.equal(fakes.openAICalls, 1, "exactly one attempt");
  assert.equal(fakes.finish[0].p_status, "failed");
  assert.equal(fakes.finish[0].p_reason, `invalid_output:${issue}`);
 }
});

test("route: OpenAI 503 -> 502 after a single attempt (no fallback model)", async () => {
 aiReply = () => Response.json({error: {message: "synthetic", code: "test"}}, {status: 503});
 const response = await POST(aiRequest("substitute-dish", veganBody));
 assert.equal(response.status, 502);
 assert.equal(fakes.openAICalls, 1);
 assert.equal(fakes.finish[0].p_reason, "openai_503");
});

test("route: menu quota reached -> 429 before OpenAI; invalid input -> 400 before billing", async () => {
 fakes.beginResult = {allowed: false, id: "10000000-0000-4000-8000-000000000009", reason: "daily_quota", retry_after_seconds: 3600};
 const limited = await POST(aiRequest("substitute-dish", veganBody));
 assert.equal(limited.status, 429);
 assert.match((await limited.json()).error, /menús/);
 assert.equal(fakes.openAICalls, 0);
 assert.equal((await POST(aiRequest("substitute-dish", {...veganBody, meal: "brunch"}))).status, 400);
 assert.equal(fakes.begin.length, 1);
});
