// C1 (roadmap step 16, audit H6): the food context comes from the account, not the browser, and
// each week keeps the one it was planned with (servings + restrictions version).
const {test, beforeEach, afterEach} = require("node:test");
const assert = require("node:assert/strict");
const {installFakeBackends, aiRequest, foodContextFor, validToken} = require("./helpers/fake-backends.cjs");

const selection = {
 lunches: ["Pollo asado con batata", "Lentejas estofadas", "Arroz meloso de sepia", "Espaguetis con setas", "Garbanzos con espinacas", "Merluza al horno", "Paella de pollo"],
 dinners: ["Tortilla de patata", "Ensalada de tomate y queso fresco", "Salmón a la plancha", "Crema de calabaza", "Revuelto de champiñones", "Bacalao al pilpil", "Tosta de aguacate"],
};
const veggieSelection = {
 lunches: ["Lentejas estofadas", "Garbanzos con espinacas", "Espaguetis con setas", "Arroz con verduras", "Pisto con huevo", "Alubias con verduras", "Crema de calabaza"],
 dinners: ["Tortilla de patata", "Ensalada de tomate y queso fresco", "Revuelto de champiñones", "Tosta de aguacate", "Calabacín relleno de verduras", "Sopa de verduras", "Berenjenas asadas con tomate"],
};
// (C3) «Hummus» lleva tahini: con «sésamo» en otras alergias ya no pasa la validación del menú.
const shoppingList = {items: [{name: "lentejas", quantity: 500, unit: "g", category: "despensa"}]};

let fakes;
let lastOpenAIBody;
let menuReply;
beforeEach(() => {
 menuReply = selection;
 fakes = installFakeBackends((url, init) => {
  lastOpenAIBody = JSON.parse(init.body);
  if (url.endsWith("/responses")) {
   return Response.json({id: "resp_test", object: "response", status: "completed", model: "gpt-5.6-sol", output: [{type: "message", id: "msg_test", role: "assistant", status: "completed", content: [{type: "output_text", text: JSON.stringify(shoppingList), annotations: []}]}], usage: {input_tokens: 10, output_tokens: 10, total_tokens: 20}});
  }
  const schema = lastOpenAIBody.response_format?.json_schema?.name;
  const content = schema === "dish_substitution" ? {dish: "Garbanzos con espinacas y comino"} : menuReply;
  return Response.json({choices: [{finish_reason: "stop", message: {content: JSON.stringify(content)}}], usage: {prompt_tokens: 10, completion_tokens: 10, total_tokens: 20}});
 });
});
afterEach(() => fakes.restore());

const menuPrompt = () => JSON.parse(lastOpenAIBody.messages[1].content);

test("generate-menu: restrictions come from the saved profile, never from the request body", async () => {
 const {POST} = require("../src/app/api/generate-menu/route.ts");
 fakes.foodContext = foodContextFor({householdSize: 3, dietaryRestrictions: ["vegetarian"], allergies: ["nuts"], otherAllergies: "sésamo", dislikedFoods: ["Coliflor"]});
 menuReply = veggieSelection;
 // The browser sends an empty (or stale) profile: it must not remove the account's allergies.
 const response = await POST(aiRequest("generate-menu", {peopleCount: 3, freeTextPrompt: "algo de cuchara", profile: {allergies: [], dietaryRestrictions: []}}));
 assert.equal(response.status, 200);
 const prompt = menuPrompt();
 assert.deepEqual(prompt.mandatory.allergies, ["nuts"]);
 assert.deepEqual(prompt.mandatory.dietaryRestrictions, ["vegetarian"]);
 assert.equal(prompt.mandatory.otherAllergies, "sésamo");
 assert.deepEqual(prompt.preferences.dislikedFoods, ["coliflor"]);
 assert.equal(prompt.peopleCount, 3);
 const call = fakes.contextCalls.find((entry) => entry.rpc === "current_food_context");
 assert.ok(call, "profile read on the server");
 assert.equal(call.authorization, `Bearer ${validToken}`, "read with the caller's own session (RLS), not the service key");
});

test("generate-menu: a forged vegan profile in the body does not change the prompt", async () => {
 const {POST} = require("../src/app/api/generate-menu/route.ts");
 const response = await POST(aiRequest("generate-menu", {peopleCount: 2, freeTextPrompt: "algo de cuchara", profile: {dietaryRestrictions: ["vegan"], allergies: ["gluten"]}}));
 assert.equal(response.status, 200);
 assert.deepEqual(menuPrompt().mandatory.dietaryRestrictions, []);
 assert.deepEqual(menuPrompt().mandatory.allergies, []);
});

test("generate-menu: the verified context is added to the response (same menu shape)", async () => {
 const {POST} = require("../src/app/api/generate-menu/route.ts");
 fakes.foodContext = foodContextFor({householdSize: 2, allergies: ["nuts"]});
 const response = await POST(aiRequest("generate-menu", {peopleCount: 4, freeTextPrompt: "algo de cuchara"}));
 const data = await response.json();
 assert.equal(response.status, 200);
 assert.ok(Array.isArray(data.days) && data.days.length === 7, "menu shape unchanged");
 assert.ok(data.openaiTelemetry);
 assert.deepEqual(data.foodContext, {
  servings: 4, dietaryRestrictions: [], allergies: ["nuts"], otherAllergies: "", dislikedFoods: [],
  version: fakes.foodContext.version,
 });
});

test("generate-menu: the catalogue week also follows the saved profile, never the body", async () => {
 const {POST} = require("../src/app/api/generate-menu/route.ts");
 const {visibleFoodConflict} = require("../src/lib/menu-generation/validation.ts");
 const {readMenuProfile} = require("../src/lib/menu-generation/prompt.ts");
 fakes.foodContext = foodContextFor({householdSize: 2, dietaryRestrictions: ["vegetarian"], allergies: ["gluten"]});
 const response = await POST(aiRequest("generate-menu", {peopleCount: 2, profile: {dietaryRestrictions: [], allergies: []}}));
 const data = await response.json();
 assert.equal(response.status, 200);
 assert.equal(fakes.openAICalls, 0, "no AI without a weekly request");
 assert.equal(data.openaiTelemetry.modelUsed, "catalog");
 const saved = readMenuProfile({dietaryRestrictions: ["vegetarian"], allergies: ["gluten"]});
 for (const day of data.days) for (const meal of [day.lunch, day.dinner]) assert.equal(visibleFoodConflict(meal.dishName, saved), false, meal.dishName);
 assert.deepEqual(data.foodContext.allergies, ["gluten"]);
});

test("generate-menu: no saved profile -> 409 before quota or OpenAI; profile unreadable -> 503", async () => {
 const {POST} = require("../src/app/api/generate-menu/route.ts");
 fakes.foodContext = foodContextFor(null);
 const missing = await POST(aiRequest("generate-menu", {peopleCount: 2, profile: {allergies: []}}));
 assert.equal(missing.status, 409);
 const body = await missing.json();
 assert.equal(body.reason, "profile_required");
 assert.match(body.error, /perfil/);
 fakes.contextMode = "down";
 assert.equal((await POST(aiRequest("generate-menu", {peopleCount: 2}))).status, 503);
 assert.equal(fakes.begin.length, 0);
 assert.equal(fakes.openAICalls, 0);
});

test("substitute-dish: catalogue and AI ideas use the saved profile, not the body", async () => {
 const {POST} = require("../src/app/api/substitute-dish/route.ts");
 const catalog = require("../src/data/nutritionist-recipes.json");
 const {visibleFoodConflict} = require("../src/lib/menu-generation/validation.ts");
 const {readMenuProfile} = require("../src/lib/menu-generation/prompt.ts");
 fakes.foodContext = foodContextFor({dietaryRestrictions: ["vegan"]});
 const vegan = readMenuProfile({dietaryRestrictions: ["vegan"]});
 const otherDishes = catalog.recipes.filter((recipe) => !visibleFoodConflict(recipe.name, vegan)).map((recipe) => recipe.name).slice(0, 13);
 // Body claims no restrictions: the AI must still be told «vegan».
 const response = await POST(aiRequest("substitute-dish", {profile: null, day: "Lunes", meal: "lunch", currentDish: "Crema de calabaza", otherDishes}));
 assert.equal(response.status, 200);
 const data = await response.json();
 if (data.source === "ai") assert.deepEqual(menuPrompt().mandatory.dietaryRestrictions, ["vegan"]);
 assert.ok(!visibleFoodConflict(data.dish, vegan), data.dish);
 assert.equal(data.foodContext.version, fakes.foodContext.version);
 assert.deepEqual(data.foodContext.dietaryRestrictions, ["vegan"]);
});

test("substitute-dish: no saved profile -> 409 without ideas", async () => {
 const {POST} = require("../src/app/api/substitute-dish/route.ts");
 fakes.foodContext = foodContextFor(null);
 const response = await POST(aiRequest("substitute-dish", {day: "Martes", meal: "lunch", currentDish: "Lentejas estofadas", otherDishes: []}));
 assert.equal(response.status, 409);
 assert.equal(fakes.openAICalls, 0);
});

const shoppingDay = {day: "Lunes", date: "5 oct", lunch: "Lentejas", dinner: "LIBRE"};

test("generate-shopping-list: servings and restrictions come from the week's frozen context", async () => {
 const {POST} = require("../src/app/api/generate-shopping-list/route.ts");
 const frozenRestrictions = {dietaryRestrictions: ["vegetarian"], allergies: ["nuts"], otherAllergies: "", dislikedFoods: []};
 fakes.weekContext = {week: true, frozen: {servings: 4, servingsSource: "generation", householdSize: 3, restrictions: frozenRestrictions, version: "fc1:frozen", frozenAt: "2026-10-05T10:00:00Z"},
  current: foodContextFor({}), restrictionsChanged: true, householdChanged: false};
 const response = await POST(aiRequest("generate-shopping-list", {week: [shoppingDay], isoWeek: "2026-W41"}));
 assert.equal(response.status, 200);
 const call = fakes.contextCalls.find((entry) => entry.rpc === "week_food_context_status");
 assert.deepEqual(call.body, {p_iso_year: 2026, p_iso_week: 41});
 assert.equal(call.authorization, `Bearer ${validToken}`);
 assert.match(lastOpenAIBody.instructions, /4 personas/);
 assert.doesNotMatch(lastOpenAIBody.instructions, /2 personas/);
 assert.match(lastOpenAIBody.input, /"nuts"/);
 assert.match(lastOpenAIBody.input, /"vegetarian"/);
 const data = await response.json();
 assert.deepEqual(data.items, shoppingList.items);
 assert.deepEqual(data.foodContext, {servings: 4, version: "fc1:frozen", source: "week"});
});

test("generate-shopping-list: a week without frozen context keeps 2 servings but the profile's allergies", async () => {
 const {POST} = require("../src/app/api/generate-shopping-list/route.ts");
 fakes.foodContext = foodContextFor({householdSize: 5, allergies: ["shellfish"]});
 const response = await POST(aiRequest("generate-shopping-list", {week: [shoppingDay], isoWeek: "2026-W41"}));
 assert.equal(response.status, 200);
 assert.match(lastOpenAIBody.instructions, /2 personas/);
 assert.match(lastOpenAIBody.input, /"shellfish"/);
 assert.equal((await response.json()).foodContext.source, "legacy");
 // Without isoWeek (previous client still open): same legacy behaviour, never a 400.
 assert.equal((await POST(aiRequest("generate-shopping-list", {week: [shoppingDay]}))).status, 200);
 assert.equal((await POST(aiRequest("generate-shopping-list", {week: [shoppingDay], isoWeek: "2025-W53"}))).status, 400);
});

test("week notice: only when the profile changed after freezing; it never claims compatibility", () => {
 const {foodContextChangeNotice, parseWeekFoodContextStatus} = require("../src/lib/menu-generation/food-context.ts");
 const current = foodContextFor({householdSize: 3, allergies: ["nuts"]});
 const frozen = {servings: 2, servingsSource: "generation", householdSize: 2, restrictions: current.restrictions, version: current.version, frozenAt: "2026-10-05T10:00:00Z"};
 const status = (patch) => parseWeekFoodContextStatus({week: true, frozen, current, restrictionsChanged: false, householdChanged: false, ...patch});
 assert.equal(foodContextChangeNotice(status({})), null, "nothing changed");
 assert.equal(foodContextChangeNotice(parseWeekFoodContextStatus({week: true, frozen: null, current, restrictionsChanged: false, householdChanged: false})), null, "week from before C1: no claim either way");
 assert.equal(foodContextChangeNotice(null), null, "guest or account unreachable");
 const restrictions = foodContextChangeNotice(status({restrictionsChanged: true}));
 assert.match(restrictions.title, /perfil cambió/);
 assert.match(restrictions.lines[0], /alergias/);
 const household = foodContextChangeNotice(status({householdChanged: true}));
 assert.match(household.lines[0], /3 personas.*2 personas/);
 for (const line of [...restrictions.lines, ...household.lines]) assert.doesNotMatch(line, /compatible|segur|apto/i);
 assert.throws(() => parseWeekFoodContextStatus({week: true, frozen: {servings: "2"}}));
});
