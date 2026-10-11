const {test, beforeEach, afterEach} = require("node:test");
const assert = require("node:assert/strict");

// C4 (roadmap steps 19 and 20): the shopping list comes from the dish cards (scaled to the week's
// servings; AI only for dishes without a card, one call broken down per dish), and a change of
// dishes updates the current list in place without losing what was bought. Pure modules first
// (units, build, reconcile), then the real data layer against an in-memory account with the
// semantics of reconcile_shopping_list (tests/helpers/fake-shopping.cjs), then the AI route.
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "synthetic-anon-key";
const {createDevice, useDevice} = require("./helpers/fake-browser.cjs");
const {createShoppingAccount} = require("./helpers/fake-shopping.cjs");
const {supabase} = require("../src/lib/supabase/client.ts");
const repos = require("../src/lib/data/repositories.ts");
const shopping = require("../src/lib/data/shopping.ts");
const units = require("../src/lib/shopping/units.ts");
const build = require("../src/lib/shopping/build.ts");
const reconcile = require("../src/lib/shopping/reconcile.ts");
const {getShoppingSignature} = require("../src/lib/shoppingListStorage.ts");
const {withWeekDates} = require("../src/lib/weekStorage.ts");

const A = "00000000-0000-4000-8000-00000000000a";
const asA = {scope: "u_" + A, userId: A};
const W41 = {isoYear: 2026, isoWeek: 41};
const LENTEJAS_V = "11111111-1111-4111-8111-111111111111";
const POLLO_V = "22222222-2222-4222-8222-222222222222";

const card = (versionId, title, ingredients, baseServings = 2, reviewStatus = "inferred") => ({
 versionId, recipeId: versionId.replace(/^./, "9"), version: 1, title, origin: "ai", reviewStatus, baseServings, totalMinutes: 30,
 ingredients: ingredients.map(([name, quantity, unit, category, optional = false]) => ({name, quantity, unit, category, optional})),
 steps: ["Cocinar."], possibleAllergens: [],
});
const lentejasCard = card(LENTEJAS_V, "Lentejas estofadas", [
 ["lentejas", 200, "g", "despensa"], ["zanahoria", 2, "unidades", "frutería"], ["ajo", 2, "dientes", "frutería"],
 ["pimentón", null, null, "despensa"], ["chorizo", 100, "g", "carnicería", true],
]);
const polloCard = card(POLLO_V, "Pollo al horno", [["pollo", 600, "g", "carnicería"], ["zanahoria", 1, "ud", "frutería"]], 4, "reviewed");

// AI ingredients per dish title (for the requested servings, as the route answers).
const aiDishes = {
 Merluza: [{name: "merluza", quantity: 400, unit: "g", category: "pescadería"}, {name: "limón", quantity: 1, unit: "ud", category: "frutería"}],
 Tortilla: [{name: "huevos", quantity: 6, unit: "ud", category: "lácteos"}, {name: "patata", quantity: 500, unit: "g", category: "frutería"}],
 Garbanzos: [{name: "garbanzos", quantity: 400, unit: "g", category: "despensa"}, {name: "limón", quantity: 2, unit: "ud", category: "frutería"}],
 Pisto: [{name: "calabacín", quantity: 2, unit: "ud", category: "frutería"}, {name: "tomate", quantity: 1, unit: "kg", category: "frutería"}],
};

const day = (name, lunch, dinner = "LIBRE", links = {}) => ({day: name, date: "", lunch, dinner, ...links});

// --- units ------------------------------------------------------------------------------------

test("units: mass in g, volume in ml, counts in ud; spoons and cloves grouped by name; never volume ↔ mass", () => {
 assert.deepEqual(units.normalizeAmount(1.5, "kg"), {dimension: "mass", quantity: 1500, unit: "g"});
 for (const unit of ["g", "gr", "gramos", "GR."]) assert.equal(units.normalizeAmount(250, unit).dimension, "mass");
 assert.deepEqual(units.normalizeAmount(2, "litros"), {dimension: "volume", quantity: 2000, unit: "ml"});
 assert.equal(units.normalizeAmount(5, "cl").quantity, 50);
 for (const unit of ["ud", "uds", "unidad", "unidades", null, ""]) assert.deepEqual(units.normalizeAmount(3, unit), {dimension: "count", quantity: 3, unit: "ud"});
 assert.deepEqual(units.normalizeAmount(2, "cucharadas"), {dimension: "unit:cucharada", quantity: 2, unit: "cucharada"});
 assert.equal(units.normalizeAmount(1, "diente").dimension, units.normalizeAmount(3, "dientes").dimension);
 assert.equal(units.normalizeAmount(1, "pizca").dimension, "unit:pizca");
 assert.notEqual(units.normalizeAmount(100, "ml").dimension, units.normalizeAmount(100, "g").dimension);
 assert.deepEqual(units.normalizeAmount(null, "g"), {dimension: "taste", quantity: null, unit: "al gusto"});
 assert.deepEqual(units.normalizeAmount(null, null), {dimension: "taste", quantity: null, unit: "al gusto"});
});

test("units: amounts are shown in kg / l from 1000, spoons in plural, «al gusto» without a number", () => {
 assert.equal(units.formatShoppingAmount(1200, "g"), "1,2 kg");
 assert.equal(units.formatShoppingAmount(999, "g"), "999 g");
 assert.equal(units.formatShoppingAmount(1500, "ml"), "1,5 l");
 assert.equal(units.formatShoppingAmount(4, "ud"), "4 ud");
 assert.equal(units.formatShoppingAmount(2, "diente"), "2 dientes");
 assert.equal(units.formatShoppingAmount(1, "cucharada"), "1 cucharada");
 assert.equal(units.formatShoppingAmount(null, "al gusto"), "al gusto");
 assert.equal(units.formatShoppingAmount(1, "kg"), "1 kg", "rows made before C4 keep their unit");
});

test("units: one key per category, name (no case, accents or simple plurals) and kind of amount", () => {
 assert.equal(units.shoppingNameKey("Tomates"), "tomate");
 assert.equal(units.shoppingNameKey("  Limones "), "limon");
 assert.equal(units.shoppingNameKey("nueces"), "nuez");
 assert.equal(units.shoppingNameKey("Judías verdes"), "judia verde");
 assert.equal(units.shoppingNameKey("pan"), "pan");
 assert.equal(units.shoppingNameKey("hojaldres"), "hojaldre");
 assert.equal(units.shoppingNameKey("flores de sal"), "flor de sal");
 assert.equal(units.shoppingItemKey("frutería", "Tomates", "count"), "frutería|tomate|count");
 assert.equal(units.storedItemKey({name: "Lentejas", quantity: 1, unit: "kg", category: "despensa"}), "despensa|lenteja|mass");
 assert.equal(units.storedItemKey({name: "x", quantity: 1, unit: "g", category: "otros", itemKey: "otros|stored|mass"}), "otros|stored|mass");
 assert.equal(units.roundShoppingQuantity("count", 1.5), 2);
 assert.equal(units.roundShoppingQuantity("unit:cucharada", 1.2), 1.5);
 assert.equal(units.roundShoppingQuantity("mass", 300.0000001), 300);
});

// --- build ------------------------------------------------------------------------------------

test("build: card ingredients scaled to the week's servings; optional ones left out and reported; «al gusto» kept", () => {
 const days = [day("Lunes", "Lentejas estofadas", "LIBRE", {lunchRecipe: {versionId: LENTEJAS_V}})];
 const result = build.buildDesiredList({dishes: build.plannedDishes(days), servings: 3, cards: new Map([[LENTEJAS_V, lentejasCard]]), aiItems: new Map()});
 const byName = Object.fromEntries(result.items.map((item) => [item.name, item]));
 assert.equal(byName.lentejas.quantity, 300);
 assert.equal(byName.lentejas.unit, "g");
 assert.equal(byName.zanahoria.quantity, 3);
 assert.equal(byName.ajo.unit, "diente");
 assert.equal(byName.ajo.quantity, 3);
 assert.equal(byName["pimentón"].quantity, null);
 assert.equal(byName["pimentón"].unit, "al gusto");
 assert.equal(byName.chorizo, undefined);
 assert.deepEqual(result.excludedOptional, [{dish: "Lentejas estofadas", name: "chorizo"}]);
 assert.deepEqual(result.pending, []);
 assert.deepEqual(byName.lentejas.origins, [{day: 0, meal: "lunch", dish: "lentejas estofadas", kind: "card_inferred", versionId: LENTEJAS_V, quantity: 300}]);
});

test("build: the same ingredient of several dishes is one line (cards and AI added up); a dish with neither is pending", () => {
 const days = [
  day("Lunes", "Lentejas estofadas", "Merluza", {lunchRecipe: {versionId: LENTEJAS_V}}),
  day("Martes", "Pollo al horno", "Garbanzos", {lunchRecipe: {versionId: POLLO_V}}),
  day("Miércoles", "Pisto"),
 ];
 const dishes = build.plannedDishes(days);
 const aiItems = new Map([[build.slotKey(0, "dinner"), aiDishes.Merluza], [build.slotKey(1, "dinner"), aiDishes.Garbanzos]]);
 const result = build.buildDesiredList({dishes, servings: 2, cards: new Map([[LENTEJAS_V, lentejasCard], [POLLO_V, polloCard]]), aiItems});
 const zanahoria = result.items.find((item) => item.name === "zanahoria");
 assert.equal(zanahoria.quantity, 3, "2 (lentejas) + 0.5 (pollo, 2 of its 4 servings) → 3 whole units");
 assert.equal(zanahoria.origins.length, 2);
 const limon = result.items.find((item) => item.itemKey === "frutería|limon|count");
 assert.equal(limon.quantity, 3);
 assert.deepEqual(limon.origins.map((origin) => origin.kind), ["ai_title", "ai_title"]);
 assert.equal(result.items.find((item) => item.name === "pollo").origins[0].kind, "card_reviewed");
 assert.deepEqual(result.pending.map((dish) => dish.title), ["Pisto"]);
 assert.deepEqual(result.items.map((item) => item.category), [...result.items.map((item) => item.category)].sort((x, y) =>
  ["frutería", "carnicería", "pescadería", "lácteos", "despensa", "congelados", "otros"].indexOf(x) - ["frutería", "carnicería", "pescadería", "lácteos", "despensa", "congelados", "otros"].indexOf(y)));
});

test("build: AI ingredients are reused from the list's origins (same meal, or the same dish moved to another day)", () => {
 const items = [
  {name: "merluza", quantity: 400, unit: "g", category: "pescadería", itemKey: "pescadería|merluza|mass", origins: [{day: 0, meal: "dinner", dish: "merluza", kind: "ai_title", quantity: 400}]},
  {name: "limón", quantity: 1, unit: "ud", category: "frutería", itemKey: "frutería|limon|count", origins: [{day: 0, meal: "dinner", dish: "merluza", kind: "ai_title", quantity: 1}]},
 ];
 const moved = build.aiItemsFromList(items, build.plannedDishes([day("Jueves", "LIBRE", "merluza ")]));
 assert.deepEqual(moved.get(build.slotKey(3, "dinner")).map((item) => [item.name, item.quantity]), [["merluza", 400], ["limón", 1]]);
 assert.equal(build.aiItemsFromList(items, build.plannedDishes([day("Lunes", "LIBRE", "Garbanzos")])).size, 0);
 assert.deepEqual(build.pendingDishesOf(items, build.plannedDishes([day("Lunes", "Pisto", "Merluza")])).map((dish) => dish.title), ["Pisto"]);
});

test("pantry: items are classified when painted (nothing subtracted): to buy, usually at home, bought, no longer needed, review", () => {
 const item = (name, extra = {}) => ({id: name, name, quantity: 1, unit: "ud", category: "frutería", origins: [], needsReview: false, removed: false, ...extra});
 const groups = build.classifyShoppingView(
  [item("Tomates"), item("aceite de oliva"), item("pan"), item("limón", {removed: true}), item("pollo", {needsReview: true}), item("cebolla")],
  ["pan", "limón", "pollo"],
  ["Tomate", "Aceite de Oliva"],
 );
 assert.deepEqual(Object.fromEntries(Object.entries(groups).map(([status, list]) => [status, list.map((entry) => entry.name)])), {
  review: ["pollo"], to_buy: ["cebolla"], pantry: ["Tomates", "aceite de oliva"], bought: ["pan"], bought_unneeded: ["limón"],
 });
 assert.equal(build.shoppingLineLabels.pantry, "Ya lo tienes habitualmente");
 assert.equal(build.shoppingLineLabels.to_buy, "Te falta comprar");
 assert.equal(build.shoppingLineLabels.bought_unneeded, "Comprado, ya no hace falta");
});

// --- reconcile (pure diff) --------------------------------------------------------------------

const existing = (id, name, quantity, unit, category, extra = {}) => ({id, name, quantity, unit, category, checked: false, itemKey: null, origins: null, removedAt: null, ...extra});
const desired = (name, quantity, unit, category, origins = []) => {
 const amount = units.normalizeAmount(quantity, unit);
 return {itemKey: units.shoppingItemKey(category, name, amount.dimension), name, quantity: amount.quantity, unit: amount.unit, category, origins};
};

test("reconcile: delta by item key; old rows without key get it computed; unchanged rows produce no operation", () => {
 const rows = [
  existing("r1", "Lentejas", 1, "kg", "despensa", {checked: true}),
  existing("r2", "tomate", 4, "ud", "frutería"),
  existing("r3", "merluza", 400, "g", "pescadería"),
  existing("r4", "pan", 1, "ud", "despensa", {checked: true}),
 ];
 const ops = reconcile.diffShoppingList(rows, [desired("lentejas", 1500, "g", "despensa"), desired("Tomates", 4, "ud", "frutería"), desired("cebolla", 2, "ud", "frutería")]);
 assert.deepEqual(ops.add.map((item) => item.item_key), ["frutería|cebolla|count"]);
 assert.deepEqual(ops.update.map((item) => [item.id, item.item_key, item.quantity, item.unit]), [["r1", "despensa|lenteja|mass", 1500, "g"], ["r2", "frutería|tomate|count", 4, "ud"]]);
 assert.deepEqual(ops.remove.map((item) => item.id).sort(), ["r3", "r4"], "the database keeps the bought one (r4) as no longer needed");
 const keyed = rows.map((row) => ({...row, itemKey: units.storedItemKey(row)}));
 const same = desired("merluza", 400, "g", "pescadería");
 assert.equal(reconcile.isEmptyOps(reconcile.diffShoppingList([{...keyed[2], origins: []}], [same])), true);
});

test("reconcile: a bought item no longer needed comes back when a dish needs it again; duplicates of an old list end as one line", () => {
 const back = reconcile.diffShoppingList(
  [existing("r1", "limón", 1, "ud", "frutería", {checked: true, removedAt: "2026-10-12", itemKey: "frutería|limon|count"})],
  [desired("limón", 2, "ud", "frutería")],
 );
 assert.deepEqual(back.update.map((op) => op.id), ["r1"]);
 assert.deepEqual(back.add, []);
 const dupes = reconcile.diffShoppingList(
  [existing("a", "tomate", 2, "ud", "frutería"), existing("b", "Tomates", 3, "ud", "frutería", {checked: true})],
  [desired("tomate", 5, "ud", "frutería")],
 );
 assert.deepEqual(dupes.update.map((op) => op.id), ["b"], "the bought row keeps the line");
 assert.deepEqual(dupes.remove.map((op) => op.id), ["a"]);
 const gone = reconcile.diffShoppingList([existing("c", "pan", 1, "ud", "despensa", {checked: false, removedAt: "x", itemKey: "despensa|pan|count"})], []);
 assert.deepEqual(gone.remove.map((op) => op.id), ["c"], "no longer needed and unmarked afterwards: it goes");
 assert.equal(reconcile.describeReconcileSummary({added: 2, removed: 1, keptBought: 1, changed: 0, review: 1}),
  "2 añadidos · 1 quitado · 1 comprado que ya no hace falta · 1 comprado para revisar");
});

test("signature: weeks without cards keep the B6/C1 signature; a card link adds its version and «mixed-v1»", () => {
 const plain = [day("Lunes", "Lentejas estofadas")];
 const linked = [day("Lunes", "Lentejas estofadas", "LIBRE", {lunchRecipe: {versionId: LENTEJAS_V}})];
 const legacy = getShoppingSignature(W41, plain);
 assert.equal(legacy, 'shop1:{"week":"2026-W41","days":[[0,"lentejas estofadas",null]],"servings":2,"restrictions":null,"ingredientSource":"dish-titles-v1"}');
 const mixed = getShoppingSignature(W41, linked);
 assert.notEqual(mixed, legacy);
 assert.match(mixed, /"ingredientSource":"mixed-v1","cards":\[\[0,"11111111-1111-4111-8111-111111111111",null\]\]/);
 assert.equal(getShoppingSignature(W41, [day("Lunes", "LIBRE", "LIBRE", {lunchRecipe: {versionId: LENTEJAS_V}})]), getShoppingSignature(W41, []), "a free meal never has a card");
});

// --- data layer -------------------------------------------------------------------------------

let account, ai, restoreDevice, originalFetch, originalGetSession;
const devices = [];
function onDevice(device) { restoreDevice?.(); restoreDevice = useDevice(device); }
function newDevice() { const device = createDevice(); devices.push(device); onDevice(device); return device; }

beforeEach(() => {
 account = createShoppingAccount();
 account.st.cards.set(LENTEJAS_V, lentejasCard);
 account.st.cards.set(POLLO_V, polloCard);
 repos.configureRemotes(account.remotes);
 shopping.forgetShoppingUpdateFailures();
 ai = {calls: 0, bodies: [], fail: null};
 originalFetch = global.fetch;
 global.fetch = async (url, init) => {
  assert.equal(String(url), "/api/generate-shopping-list");
  ai.calls++;
  const body = JSON.parse(init.body);
  ai.bodies.push(body);
  if (ai.fail) return Response.json({error: ai.fail}, {status: 429});
  const dishes = body.week.flatMap((d) => ["lunch", "dinner"].filter((meal) => d[meal] !== "LIBRE")
   .map((meal) => ({day: d.day, meal, items: aiDishes[d[meal]] ?? [{name: d[meal].toLowerCase(), quantity: 1, unit: "ud", category: "otros"}]})));
  return Response.json({items: dishes.flatMap((d) => d.items), dishes});
 };
 originalGetSession = supabase.auth.getSession;
 supabase.auth.getSession = async () => ({data: {session: {access_token: "synthetic"}}, error: null});
 devices.length = 0;
 newDevice();
});

afterEach(() => {
 repos.configureRemotes(null);
 global.fetch = originalFetch;
 supabase.auth.getSession = originalGetSession;
 restoreDevice?.();
 restoreDevice = null;
});

const week = (lunchMonday = "Lentejas estofadas", dinnerMonday = "Merluza", tuesday = "Tortilla") => withWeekDates([
 day("Lunes", lunchMonday, dinnerMonday, lunchMonday === "Lentejas estofadas" ? {lunchRecipe: {versionId: LENTEJAS_V}} : {}),
 day("Martes", tuesday),
], W41);
const open = (days = week()) => shopping.ensureShoppingList(asA, W41, days);
const rows = () => account.listsOf(W41).at(-1).items;
const rowNamed = (name) => rows().find((item) => item.name === name);
const mark = (name, value = true) => shopping.setShoppingItemChecked(asA, W41, `${rowNamed(name).category === "congelados" ? "otros" : rowNamed(name).category}-${require("../src/lib/shoppingList.ts").normalizeIngredientName(name)}-${rowNamed(name).unit}`, value);

test("C4 defect: a dish with a card takes its ingredients from the card (scaled), never from the AI", async () => {
 account.writeWeek(W41, [day("Lunes", "Lentejas estofadas", "LIBRE", {lunchRecipe: {versionId: LENTEJAS_V}})], {servings: 4, version: "fc1:x"});
 const loaded = await open([day("Lunes", "Lentejas estofadas", "LIBRE", {lunchRecipe: {versionId: LENTEJAS_V}})]);
 assert.equal(loaded.status, "ready");
 assert.equal(ai.calls, 0, "every dish has a card: no AI call, no quota");
 assert.equal(rowNamed("lentejas").quantity, 400, "200 g for 2 → 400 g for the week's 4 servings");
 assert.equal(rowNamed("zanahoria").quantity, 4);
 assert.equal(rowNamed("chorizo"), undefined, "optional ingredient left out");
 assert.equal(account.listsOf(W41)[0].basis, "mixed-v1");
 assert.equal(loaded.view.fromCards, true);
 assert.deepEqual(loaded.view.pendingDishes, []);
});

test("mixed week: one AI call broken down per dish, only for the dishes without a card", async () => {
 account.writeWeek(W41, week());
 const loaded = await open();
 assert.equal(loaded.status, "ready");
 assert.equal(ai.calls, 1);
 assert.equal(ai.bodies[0].breakdown, true);
 assert.deepEqual(ai.bodies[0].week.map((d) => [d.day, d.lunch, d.dinner]), [["Lunes", "LIBRE", "Merluza"], ["Martes", "Tortilla", "LIBRE"]]);
 assert.ok(rowNamed("lentejas") && rowNamed("merluza") && rowNamed("huevos"));
 assert.deepEqual(rowNamed("merluza").origins, [{day: 0, meal: "dinner", dish: "merluza", kind: "ai_title", quantity: 400}]);
 assert.equal((await open()).status, "ready");
 assert.equal(ai.calls, 1, "reopening reuses the list");
});

test("C4 defect: changing one dish updates the same list, keeps the marks and calls the AI only for the new dish", async () => {
 account.writeWeek(W41, week());
 await open();
 const listId = account.listsOf(W41)[0].id;
 assert.equal((await mark("huevos")).status, "synced");
 assert.equal((await mark("lentejas")).status, "synced");
 account.writeWeek(W41, week("Lentejas estofadas", "Merluza", "Garbanzos"));
 const after = await open(week("Lentejas estofadas", "Merluza", "Garbanzos"));
 assert.equal(after.status, "ready");
 assert.equal(account.listsOf(W41).length, 1, "no new list");
 assert.equal(account.listsOf(W41)[0].id, listId);
 assert.equal(ai.calls, 2);
 assert.deepEqual(ai.bodies[1].week.map((d) => [d.day, d.lunch, d.dinner]), [["Martes", "Garbanzos", "LIBRE"]], "only the new dish");
 assert.equal(rowNamed("lentejas").checked, true, "a card dish that did not change keeps its mark");
 assert.equal(rowNamed("huevos").checked, true, "bought for the removed dish: kept");
 assert.ok(rowNamed("huevos").removedAt, "…as «Comprado, ya no hace falta»");
 assert.equal(rowNamed("patata"), undefined, "not bought and no longer needed: removed");
 assert.ok(rowNamed("garbanzos"));
 assert.equal(rowNamed("limón").quantity, 3, "1 (merluza) + 2 (garbanzos)");
 assert.deepEqual(after.view.change, {added: 1, removed: 1, keptBought: 1, changed: 1, review: 0});
 const huevos = after.view.items.find((item) => item.name === "huevos");
 assert.equal(huevos.removed, true);
 assert.ok(after.view.checkedItemIds.includes(huevos.id));
});

test("a bought item that now needs more stays marked and is to review; marking it again settles it", async () => {
 account.writeWeek(W41, week("Lentejas estofadas", "Merluza", "Pisto"));
 await open(week("Lentejas estofadas", "Merluza", "Pisto"));
 await mark("limón");
 account.writeWeek(W41, week("Lentejas estofadas", "Merluza", "Garbanzos"));
 const after = await open(week("Lentejas estofadas", "Merluza", "Garbanzos"));
 assert.equal(rowNamed("limón").checked, true);
 assert.equal(rowNamed("limón").needsReview, true, "1 bought, 3 needed now");
 assert.equal(after.view.change.review, 1);
 assert.equal(after.view.items.find((item) => item.name === "limón").needsReview, true);
 await mark("limón", false);
 await mark("limón", true);
 assert.equal(rowNamed("limón").needsReview, false);
 assert.equal(rowNamed("limón").checkedQuantity, 3);
});

test("changing a dish to one with a card costs no AI call", async () => {
 account.writeWeek(W41, week("Garbanzos", "Merluza", "Tortilla"));
 await open(week("Garbanzos", "Merluza", "Tortilla"));
 assert.equal(ai.calls, 1);
 account.writeWeek(W41, week());
 const after = await open();
 assert.equal(after.status, "ready");
 assert.equal(ai.calls, 1, "Merluza and Tortilla reused from the list, Lentejas from its card");
 assert.ok(rowNamed("zanahoria"));
 assert.equal(rowNamed("garbanzos"), undefined);
});

test("the AI fails while updating: what is known is applied, the dish stays pending, «Calcular (IA)» completes it", async () => {
 account.writeWeek(W41, week());
 await open();
 await mark("huevos");
 account.writeWeek(W41, week("Lentejas estofadas", "Merluza", "Garbanzos"));
 ai.fail = "Has alcanzado el límite de listas de la compra por hoy.";
 const after = await open(week("Lentejas estofadas", "Merluza", "Garbanzos"));
 assert.equal(after.status, "ready");
 assert.deepEqual(after.view.pendingDishes, [{day: 1, meal: "lunch", title: "Garbanzos"}]);
 assert.equal(after.view.aiError, "Has alcanzado el límite de listas de la compra por hoy.");
 assert.equal(rowNamed("huevos").checked, true);
 assert.equal(rowNamed("garbanzos"), undefined);
 // Reload: still pending (the list is current, the dish has no ingredients), no automatic AI.
 const calls = ai.calls;
 const reloaded = await shopping.loadShoppingList(asA, W41, week("Lentejas estofadas", "Merluza", "Garbanzos"));
 assert.deepEqual(reloaded.view.pendingDishes.map((dish) => dish.title), ["Garbanzos"]);
 assert.equal(ai.calls, calls);
 ai.fail = null;
 const calculated = await shopping.reconcileShoppingList(asA, W41, week("Lentejas estofadas", "Merluza", "Garbanzos"), {retryPending: true});
 assert.equal(ai.calls, calls + 1);
 assert.deepEqual(ai.bodies.at(-1).week.map((d) => [d.day, d.lunch, d.dinner]), [["Martes", "Garbanzos", "LIBRE"]]);
 assert.deepEqual(calculated.view.pendingDishes, []);
 assert.ok(rowNamed("garbanzos"));
 assert.equal(account.listsOf(W41).length, 1);
});

const legacyList = () => {
 account.writeWeek(W41, [day("Lunes", "Garbanzos", "Merluza")]);
 const signature = getShoppingSignature(W41, [day("Lunes", "Garbanzos", "Merluza")]);
 account.st.lists.push({id: "legacy", week: "2026-W41", at: ++account.st.seq, signature, basis: null, items: [
  {id: "old-1", name: "garbanzos", quantity: 0.4, unit: "kg", category: "despensa", checked: true, itemKey: null, origins: null, checkedQuantity: null, needsReview: false, removedAt: null},
  {id: "old-2", name: "merluza", quantity: 400, unit: "g", category: "pescadería", checked: false, itemKey: null, origins: null, checkedQuantity: null, needsReview: false, removedAt: null},
 ]});
 account.writeWeek(W41, [day("Lunes", "Garbanzos", "Tortilla")]);
};

test("a list made before C4 + AI failure: the existing list is shown as it is, with the reason; reopening does not pay again", async () => {
 legacyList();
 ai.fail = "Sin cuota";
 const failed = await open([day("Lunes", "Garbanzos", "Tortilla")]);
 assert.equal(failed.status, "ready", "never an error instead of the list");
 assert.equal(failed.view.notUpdated, true);
 assert.equal(failed.view.aiError, "Sin cuota");
 assert.deepEqual(failed.view.items.map((item) => item.name).sort(), ["garbanzos", "merluza"]);
 assert.equal(rows().length, 2, "the old list is left as it is");
 assert.equal(ai.calls, 1);
 const again = await open([day("Lunes", "Garbanzos", "Tortilla")]);
 assert.equal(again.view.notUpdated, true);
 assert.equal(ai.calls, 1, "the same failure is not paid again on reopening");
 ai.fail = null;
 const asked = await shopping.reconcileShoppingList(asA, W41, [day("Lunes", "Garbanzos", "Tortilla")], {retryPending: true});
 assert.equal(ai.calls, 2, "«Actualizar lista (IA)» asks again");
 assert.equal(asked.view.notUpdated, false);
});

test("a list made before C4 is updated in place keeping its marks (one AI call for every dish without a card)", async () => {
 legacyList();
 const after = await open([day("Lunes", "Garbanzos", "Tortilla")]);
 assert.equal(after.status, "ready");
 assert.equal(account.listsOf(W41).length, 1);
 assert.deepEqual(ai.bodies.at(-1).week.map((d) => [d.lunch, d.dinner]), [["Garbanzos", "Tortilla"]], "no origins: every dish without a card once");
 const garbanzos = rows().find((item) => item.id === "old-1");
 assert.equal(garbanzos.checked, true, "same row, still bought");
 assert.equal(garbanzos.itemKey, "despensa|garbanzo|mass");
 assert.equal(garbanzos.needsReview, false, "0.4 kg bought, 400 g needed");
 assert.equal(garbanzos.checkedQuantity, 400, "what was bought is kept for the next update");
 assert.equal(after.view.change.changed, 0, "0.4 kg → 400 g is not a change");
 assert.equal(rows().find((item) => item.id === "old-2"), undefined);
 assert.ok(rowNamed("huevos"));
});

test("origins for other servings + AI failure: nothing is removed, the list is shown as it is", async () => {
 account.writeWeek(W41, week(), {servings: 2, version: "fc1:a"});
 await open();
 const before = JSON.stringify(rows());
 account.writeWeek(W41, week(), {servings: 4, version: "fc1:a"});
 ai.fail = "Sin cuota";
 const after = await open();
 assert.equal(after.status, "ready");
 assert.equal(after.view.notUpdated, true);
 assert.equal(JSON.stringify(rows()), before, "no AI row removed");
});

test("a list that moves while updating: the AI is asked once; after three attempts the list is shown, never «outdated»", async () => {
 account.writeWeek(W41, week());
 await open();
 account.writeWeek(W41, week("Lentejas estofadas", "Merluza", "Garbanzos"));
 account.st.forceStale = 1;
 const retried = await open(week("Lentejas estofadas", "Merluza", "Garbanzos"));
 assert.equal(retried.status, "ready");
 assert.equal(retried.view.notUpdated, false);
 assert.equal(ai.calls, 2, "one call for Garbanzos, reused in the second attempt");
 account.writeWeek(W41, week("Lentejas estofadas", "Merluza", "Pisto"));
 account.st.forceStale = 5;
 const exhausted = await open(week("Lentejas estofadas", "Merluza", "Pisto"));
 assert.equal(exhausted.status, "ready");
 assert.equal(exhausted.view.notUpdated, true);
 assert.match(exhausted.view.aiError, /ha cambiado/);
 assert.equal(ai.calls, 3);
});

test("adapter: only a missing reconcile_shopping_list is «unavailable»; any other error is an error", async () => {
 const {reconcileShoppingListInSupabase} = require("../src/lib/supabase/shopping-lists.ts");
 const realRpc = supabase.rpc;
 const input = {isoYear: 2026, isoWeek: 41, listId: "x", fromSignature: null, toSignature: "s", ops: {add: [], update: [], remove: []}, expectedWeekVersion: null};
 try {
  supabase.rpc = async () => ({data: null, error: {code: "PGRST202", message: "Could not find the function public.reconcile_shopping_list"}});
  assert.equal((await reconcileShoppingListInSupabase(input)).status, "unavailable");
  supabase.rpc = async () => ({data: null, error: {code: "42883", message: "function public.reconcile_shopping_list(integer) does not exist"}});
  assert.equal((await reconcileShoppingListInSupabase(input)).status, "unavailable");
  supabase.rpc = async () => ({data: null, error: {code: "42883", message: "function public.shopping_items_discard_unbought(uuid, uuid[]) does not exist"}});
  await assert.rejects(reconcileShoppingListInSupabase(input), /Could not update shopping list/);
 } finally {
  supabase.rpc = realRpc;
 }
});

test("new servings or restrictions: the AI ingredients of the list are not reused", async () => {
 account.writeWeek(W41, week(), {servings: 2, version: "fc1:a"});
 await open();
 assert.equal(ai.calls, 1);
 assert.equal(rowNamed("lentejas").quantity, 200);
 account.writeWeek(W41, week(), {servings: 4, version: "fc1:a"});
 await open();
 assert.equal(ai.calls, 2);
 assert.equal(account.listsOf(W41).length, 1);
 assert.equal(rowNamed("lentejas").quantity, 400, "card scaled to 4");
 account.writeWeek(W41, week(), {servings: 4, version: "fc1:b"});
 await open();
 assert.equal(ai.calls, 3, "other restrictions: the AI dishes are computed again");
});

test("a device showing the list before an update: a mark on an item that is gone is refused (stale), nothing written", async () => {
 account.writeWeek(W41, week());
 await open();
 const phone = devices[0];
 newDevice();
 account.writeWeek(W41, week("Lentejas estofadas", "Merluza", "Garbanzos"));
 await open(week("Lentejas estofadas", "Merluza", "Garbanzos"));
 onDevice(phone);
 const result = await shopping.setShoppingItemChecked(asA, W41, "frutería-patata-g", true);
 assert.equal(result.status, "stale");
 const still = await shopping.setShoppingItemChecked(asA, W41, "pescadería-merluza-g", true);
 assert.equal(still.status, "synced", "an item still in the list can be marked");
});

// --- the AI route with breakdown ----------------------------------------------------------------

test("route: breakdown answers per planned meal and the whole-week items; a non-boolean breakdown is refused", async () => {
 const {installFakeBackends, aiRequest} = require("./helpers/fake-backends.cjs");
 const reply = {dishes: [
  {day: "Lunes", meal: "dinner", items: [{name: "merluza", quantity: 400, unit: "g", category: "pescadería"}, {name: "limón", quantity: 1, unit: "ud", category: "frutería"}]},
  {day: "Martes", meal: "lunch", items: [{name: "limón", quantity: 2, unit: "ud", category: "frutería"}]},
  {day: "Lunes", meal: "lunch", items: [{name: "invented", quantity: 1, unit: "ud", category: "otros"}]},
 ]};
 let body;
 const fakes = installFakeBackends((url, init) => {
  body = JSON.parse(init.body);
  return Response.json({id: "resp", object: "response", status: "completed", model: "gpt-5.6-sol",
   output: [{type: "message", id: "m", role: "assistant", status: "completed", content: [{type: "output_text", text: JSON.stringify(reply), annotations: []}]}],
   usage: {input_tokens: 10, output_tokens: 10, total_tokens: 20}});
 });
 try {
  const {POST} = require("../src/app/api/generate-shopping-list/route.ts");
  const weekBody = [{day: "Lunes", date: "", lunch: "LIBRE", dinner: "Merluza"}, {day: "Martes", date: "", lunch: "Garbanzos", dinner: "LIBRE"}];
  const response = await POST(aiRequest("generate-shopping-list", {week: weekBody, breakdown: true}));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(body.text.format.name, "shopping_list_by_dish");
  assert.equal(body.max_output_tokens, 16000, "a breakdown has an output cap");
  assert.match(body.instructions, /Desglose por comida/);
  assert.deepEqual(data.dishes.map((dish) => `${dish.day}|${dish.meal}`), ["Lunes|dinner", "Martes|lunch"], "a meal not asked for is dropped");
  assert.deepEqual(data.items.find((item) => item.name === "limón"), {name: "limón", quantity: 3, unit: "ud", category: "frutería"});
  assert.equal((await POST(aiRequest("generate-shopping-list", {week: weekBody, breakdown: "yes"}))).status, 400);
  const legacy = await POST(aiRequest("generate-shopping-list", {week: weekBody}));
  assert.equal(body.text.format.name, "shopping_list", "the previous client still gets the whole-week list");
  assert.equal(body.max_output_tokens, undefined);
  assert.equal(legacy.status, 502, "(this fake answers per dish, which the whole-week schema rejects)");
 } finally {
  fakes.restore();
 }
});
