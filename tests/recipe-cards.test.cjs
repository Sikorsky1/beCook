const {test, beforeEach, afterEach} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// C2 (roadmap step 17): dish cards. Synthetic data only: no Supabase project or OpenAI is contacted.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "synthetic-anon-key";
const root = path.join(__dirname, "..");
const catalog = require("../src/data/nutritionist-recipes.json");
const draft = require("../src/data/recipe-cards/catalog-v1.json");
const card = require("../src/lib/recipes/card.ts");
const {weekToApplyWeekDays} = require("../src/lib/supabase/weeks.ts");
const {supabaseWeekToWeekDays, weekDaysToSupabaseWeek, withMealRecipe, mealRecipeLink} = require("../src/lib/weekStorage.ts");
const {linkCatalogRecipes} = require("../src/lib/applyWeek.ts");
const repos = require("../src/lib/data/repositories.ts");
const flow = require("../src/lib/recipes/dishCardFlow.ts");
const {createDevice, useDevice} = require("./helpers/fake-browser.cjs");
const {installFakeBackends, aiRequest, validToken} = require("./helpers/fake-backends.cjs");

const V1 = "10000000-0000-4000-8000-0000000000c1";
const V2 = "10000000-0000-4000-8000-0000000000c2";
const validContent = {
 baseServings: 2, totalMinutes: 40,
 ingredients: [{name: "patatas", quantity: 500, unit: "g", category: "frutería", optional: false}, {name: "sal", quantity: null, unit: null, category: "despensa", optional: false}],
 steps: ["Pelar y cortar.", "Cuajar."], possibleAllergens: ["eggs"],
};

test("card schema: valid content is canonicalised; every invalid shape is rejected with its reason, never repaired", () => {
 const ok = card.validateRecipeCardContent({...validContent, possibleAllergens: ["milk", "eggs"], steps: [" Pelar ", "Cuajar"]});
 assert.equal(ok.ok, true);
 assert.deepEqual(ok.card.possibleAllergens, ["eggs", "milk"], "canonical EU-14 order");
 assert.deepEqual(ok.card.steps, ["Pelar", "Cuajar"]);
 const bad = [
  [null, "not_object"], [{...validContent, extra: 1}, "unknown_key"], [{...validContent, baseServings: 0}, "servings"], [{...validContent, baseServings: 13}, "servings"],
  [{...validContent, totalMinutes: 1.5}, "minutes"], [{...validContent, ingredients: []}, "ingredients"],
  [{...validContent, ingredients: Array(41).fill(validContent.ingredients[0])}, "ingredients"],
  [{...validContent, ingredients: [{...validContent.ingredients[0], category: "carne"}]}, "ingredient"],
  [{...validContent, ingredients: [{...validContent.ingredients[0], quantity: -1}]}, "ingredient"],
  [{...validContent, ingredients: [{name: "x", quantity: 1, unit: "g", category: "despensa"}]}, "ingredient"],
  [{...validContent, steps: []}, "steps"], [{...validContent, steps: Array(21).fill("x")}, "steps"], [{...validContent, steps: ["x".repeat(401)]}, "step"],
  [{...validContent, possibleAllergens: ["chocolate"]}, "allergens"],
 ];
 for (const [value, reason] of bad) assert.deepEqual(card.validateRecipeCardContent(value), {ok: false, reason}, JSON.stringify(value)?.slice(0, 60));
});

test("title key and catalogue identity: exact title only (case and spacing aside), accents and plurals matter", () => {
 assert.equal(card.recipeTitleKey("  Tortilla   de PATATA "), "tortilla de patata");
 assert.equal(card.findCatalogRecipeIdentity(" tortilla  de Patata").catalogKey, "nutri-e41");
 assert.equal(card.findCatalogRecipeIdentity("Tortilla de patatas"), null);
 assert.equal(card.findCatalogRecipeIdentity("Salmon a la plancha"), null);
 assert.equal(card.findCatalogRecipeIdentity("LIBRE"), null);
});

test("migration inserts exactly the 27 catalogue identities, without any reviewed version", () => {
 const sql = fs.readFileSync(path.join(root, "supabase/migrations/20261012090000_recipe_cards.sql"), "utf8");
 const rows = [...sql.matchAll(/\('(nutri-[a-z0-9]+)', '((?:[^']|'')+)', 'catalog'\)/g)].map(([, key, title]) => [key, title.replace(/''/g, "'")]);
 assert.deepEqual(rows, catalog.recipes.map(recipe => [recipe.id, recipe.name]));
 // The only version insert is save_inferred_recipe's, always «inferred»: no reviewed card is invented.
 const inserts = sql.split("INSERT INTO public.recipe_versions").slice(1);
 assert.equal(inserts.length, 1);
 assert.ok(inserts[0].slice(0, 400).includes("'inferred'"));
 assert.match(sql, /SET LOCAL lock_timeout = '5s';/);
 assert.match(sql, /SET LOCAL statement_timeout = '120s';/);
});

test("catalogue draft (catalog-v1.json) is explicitly unreviewed, complete and valid, and the app never loads it", () => {
 assert.equal(draft.status, "draft_unreviewed");
 assert.match(draft.notice, /SIN REVISAR/);
 assert.deepEqual(draft.recipes.map(recipe => [recipe.catalogKey, recipe.title]), catalog.recipes.map(recipe => [recipe.id, recipe.name]));
 for (const recipe of draft.recipes) {
  assert.equal(recipe.reviewStatus, undefined, "no review status is claimed per recipe");
  const result = card.validateRecipeCardContent(recipe.card);
  assert.equal(result.ok, true, recipe.title + ": " + result.reason);
 }
 const sources = [];
 const walk = dir => {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
   if (entry.isDirectory()) walk(path.join(dir, entry.name));
   else sources.push(path.join(dir, entry.name));
  }
 };
 walk(path.join(root, "src"));
 for (const file of sources.filter(f => /\.(ts|tsx)$/.test(f))) assert.doesNotMatch(fs.readFileSync(file, "utf8"), /catalog-v1/, file);
});

test("week mapping: planned meals keep their card link, free meals never have one, unknown links are not sent", () => {
 const isoWeek = {isoYear: 2026, isoWeek: 41};
 const remote = {days: [
  {dayName: "Lunes", lunch: {status: "planned", dishName: "Tortilla de patata", recipeVersionId: V1}, dinner: {status: "free", dishName: "", recipeVersionId: null}},
  {dayName: "Martes", lunch: {status: "planned", dishName: "Pisto", recipeVersionId: null}, dinner: {status: "planned", dishName: "Sopa", recipeVersionId: null}},
 ]};
 const days = supabaseWeekToWeekDays(remote, isoWeek);
 assert.deepEqual(days[0].lunchRecipe, {versionId: V1});
 assert.equal("dinnerRecipe" in days[0], false);
 assert.equal("lunchRecipe" in days[1], false, "history: only the title");
 const rows = weekToApplyWeekDays(weekDaysToSupabaseWeek(days));
 assert.equal(rows[0].lunch_recipe_version_id, V1);
 assert.equal(rows[0].dinner_recipe_version_id, null);
 assert.equal("lunch_recipe_version_id" in rows[1], false, "a planned meal without a link sends no key: the account keeps its card");
 assert.equal(rows[1].dinner_recipe_version_id, undefined);
 // A caller that knows nothing about cards sends no key: apply_week keeps the slot link.
 const legacy = weekToApplyWeekDays({days: [{dayName: "Lunes", lunch: {status: "planned", dishName: "Pisto"}, dinner: {status: "free", dishName: ""}}]});
 assert.equal("lunch_recipe_version_id" in legacy[0], false);
 // A free meal never carries a link, whatever the device copy says.
 assert.equal(mealRecipeLink({day: "Lunes", date: "", lunch: "LIBRE", dinner: "LIBRE", lunchRecipe: {versionId: V1}}, "lunch"), null);
 assert.deepEqual(withMealRecipe(days, "Martes", "dinner", {versionId: V2})[1].dinnerRecipe, {versionId: V2});
 assert.equal("lunchRecipe" in withMealRecipe(days, "Lunes", "lunch", null)[0], false);
});

test("applying a menu links only exact catalogue titles that have a reviewed card; existing links stay", () => {
 const week = [
  {day: "Lunes", date: "", lunch: "tortilla de patata", dinner: "Tortilla de patatas"},
  {day: "Martes", date: "", lunch: "Lentejas estofadas", dinner: "LIBRE", lunchRecipe: {versionId: V2}},
 ];
 assert.equal(linkCatalogRecipes(week, new Map()), week, "no reviewed catalogue card: nothing changes");
 const index = new Map([["tortilla de patata", {versionId: V1}], ["lentejas estofadas", {versionId: V1}]]);
 const linked = linkCatalogRecipes(week, index);
 assert.deepEqual(linked[0].lunchRecipe, {versionId: V1});
 assert.equal(linked[0].dinnerRecipe, undefined, "a plural is another dish");
 assert.deepEqual(linked[1].lunchRecipe, {versionId: V2});
});

// --- Repositories and the dish card flow, with in-memory account adapters ---------------------
const A = "00000000-0000-4000-8000-00000000000a";
const asA = {scope: "u_" + A, userId: A};
const guest = {scope: "guest", userId: null};
const week41 = {isoYear: 2026, isoWeek: 41};
let account, restoreDevice;

function inMemoryAccount() {
 const state = {days: null, version: 0, pushes: [], cards: {}, catalog: new Map()};
 const unused = () => { throw new Error("not used"); };
 repos.configureRemotes({
  profile: unused, pantry: unused, shopping: unused,
  week: (_userId, _isoWeek, options = {}) => ({
   checksVersion: true,
   sameData: repos.sameWeekDays,
   fetch: async () => ({data: state.days, version: state.days ? String(state.version) : null}),
   push: async (days, context) => {
    state.pushes.push({days, options, context});
    state.days = days;
    state.version++;
    return {version: String(state.version)};
   },
  }),
  recipeCard: async versionId => state.cards[versionId] ?? null,
  catalogRecipes: async () => state.catalog,
 });
 return state;
}

const cardFor = (title, versionId = V1, reviewStatus = "inferred") => ({...validContent, possibleAllergens: ["eggs"], versionId, recipeId: V2, version: 1, title, origin: reviewStatus === "reviewed" ? "catalog" : "ai", reviewStatus});

beforeEach(() => {
 account = inMemoryAccount();
 restoreDevice = useDevice(createDevice());
});
afterEach(() => {
 repos.configureRemotes(null);
 restoreDevice();
});

test("dish edit: the card stays only for the same title; another title drops it; an exact reviewed catalogue title gets its card", async () => {
 const start = [{day: "Lunes", date: "", lunch: "Tortilla de patata", dinner: "LIBRE", lunchRecipe: {versionId: V2}}];
 await repos.saveWeek(asA, week41, start, {overwrite: true});
 const same = await repos.saveWeekSlot(asA, week41, [{...start[0], lunch: "tortilla  de patata"}], {day: "Lunes", meal: "lunch"});
 assert.equal(same.status, "synced");
 assert.deepEqual(account.pushes.at(-1).days[0].lunchRecipe, {versionId: V2});
 assert.deepEqual(account.pushes.at(-1).options.slot, {day: "Lunes", meal: "lunch"});
 await repos.saveWeekSlot(asA, week41, [{...start[0], lunch: "Pisto"}], {day: "Lunes", meal: "lunch"});
 assert.equal(account.pushes.at(-1).days[0].lunchRecipe, undefined, "the card was for the previous dish");
 account.catalog = new Map([["tortilla de patata", {versionId: V1}]]);
 repos.configureRemotes(null); // reset the per-load catalogue read
 account = Object.assign(inMemoryAccount(), {days: account.days, version: account.version, catalog: account.catalog});
 await repos.saveWeekSlot(asA, week41, [{day: "Lunes", date: "", lunch: "Tortilla de patata", dinner: "LIBRE"}], {day: "Lunes", meal: "lunch"});
 assert.deepEqual(account.pushes.at(-1).days[0].lunchRecipe, {versionId: V1}, "«Otra idea» from the catalogue keeps its card");
});

test("linking a card writes only that link (signed in) or this device (guest)", async () => {
 const start = [{day: "Lunes", date: "", lunch: "Tortilla de patata", dinner: "Sopa"}];
 await repos.saveWeek(asA, week41, start, {overwrite: true});
 const result = await repos.saveWeekRecipe(asA, week41, start, {day: "Lunes", meal: "lunch"}, {versionId: V1});
 assert.equal(result.status, "synced");
 const push = account.pushes.at(-1);
 assert.deepEqual(push.options.recipe, {day: "Lunes", meal: "lunch"});
 assert.deepEqual(push.days[0].lunchRecipe, {versionId: V1});
 assert.equal(push.days[0].dinnerRecipe, undefined);
 assert.equal(push.context.baseVersion, "1", "checked against the week version of this copy");
 const guestResult = await flow.linkCatalogCard(guest, week41, start, {day: "Lunes", meal: "lunch"}, V1);
 assert.equal(guestResult.status, "linked");
 assert.deepEqual(repos.readCachedWeek(guest, week41)[0].lunchRecipe, {versionId: V1});
});

test("dish card view: a card is shown only for its dish; history says «only the title»; catalogue cards are pending review", async () => {
 account.cards[V1] = cardFor("Tortilla de patata");
 const linked = {day: "Lunes", date: "", lunch: "Tortilla de patata", dinner: "Pisto", lunchRecipe: {versionId: V1}, dinnerRecipe: {versionId: V1}};
 const shown = await flow.loadDishCardView(linked, "lunch");
 assert.equal(shown.kind, "card");
 assert.equal(shown.card.reviewStatus, "inferred");
 const stale = await flow.loadDishCardView(linked, "dinner");
 assert.deepEqual(stale, {kind: "title_only", catalog: null, unreadableLink: false}, "a stale device link never shows another dish's card");
 const historic = await flow.loadDishCardView({day: "Lunes", date: "", lunch: "Tortilla de patata", dinner: "LIBRE"}, "lunch");
 assert.equal(historic.kind, "title_only");
 assert.equal(historic.catalog.catalogKey, "nutri-e41");
 assert.equal(historic.catalog.reviewedVersionId, null, "no reviewed catalogue card yet: «Ficha pendiente de revisión»");
 account.catalog = new Map([["tortilla de patata", {versionId: V2}]]);
 repos.configureRemotes(null);
 account = Object.assign(inMemoryAccount(), {catalog: account.catalog});
 const reviewed = await flow.loadDishCardView({day: "Lunes", date: "", lunch: "Tortilla de patata", dinner: "LIBRE"}, "lunch");
 assert.equal(reviewed.catalog.reviewedVersionId, V2, "«Usar receta del catálogo», without AI");
 const unreadable = await flow.loadDishCardView({day: "Lunes", date: "", lunch: "Pisto", dinner: "LIBRE", lunchRecipe: {versionId: V2}}, "lunch");
 assert.deepEqual(unreadable, {kind: "title_only", catalog: null, unreadableLink: true});
});

test("the card just obtained is shown only for exactly that meal, dish and link («Pollo» is not «Pollo al limón»)", () => {
 const pollo = cardFor("Pollo", V1);
 const slot = {day: "Lunes", meal: "lunch"};
 const shown = {key: flow.dishCardSlotKey(slot, "Pollo"), card: pollo};
 const viewCard = cardFor("Pollo al limón", V2);
 assert.equal(flow.cardToShow(shown, flow.dishCardSlotKey(slot, "Pollo"), "Pollo", null, null), pollo, "before the week is read again");
 assert.equal(flow.cardToShow(shown, flow.dishCardSlotKey(slot, "Pollo"), "Pollo", V1, null), pollo);
 assert.equal(flow.cardToShow(shown, flow.dishCardSlotKey(slot, "Pollo al limón"), "Pollo al limón", V2, viewCard), viewCard);
 assert.equal(flow.cardToShow(shown, flow.dishCardSlotKey(slot, "Pollo al limón"), "Pollo al limón", null, null), null);
 assert.equal(flow.cardToShow(shown, flow.dishCardSlotKey(slot, "Pollo"), "Pollo", V2, null), null, "the slot points to another version");
 assert.equal(flow.cardToShow(shown, flow.dishCardSlotKey({day: "Martes", meal: "lunch"}, "Pollo"), "Pollo", null, null), null, "another day");
});

test("estimated card: guests never call the API; an unknown week version is not guessed", async () => {
 let calls = 0;
 const savedFetch = global.fetch;
 global.fetch = async () => { calls++; return Response.json({}); };
 try {
  assert.deepEqual(await flow.requestEstimatedCard(guest, week41, {day: "Lunes", meal: "lunch"}, "Pisto", V1), {status: "login_required"});
  const unknown = await flow.requestEstimatedCard(asA, week41, {day: "Lunes", meal: "lunch"}, "Pisto", V1);
  assert.equal(unknown.status, "error");
  assert.equal(unknown.message, flow.dishCardMessages.versionUnknown);
  assert.equal(calls, 0);
 } finally {
  global.fetch = savedFetch;
 }
});

// --- /api/dish-card ------------------------------------------------------------------------------
let fakes, aiReply, logs;
const originalInfo = console.info;
const body = {isoWeek: "2026-W41", day: "Lunes", meal: "lunch", dish: "Lentejas estofadas", expectedVersion: 3, requestKey: "50000000-0000-4000-8000-000000000002"};
const aiResponse = content => Response.json({id: "resp_test", object: "response", status: "completed", model: "gpt-5.6-sol",
 output: [{type: "message", id: "msg_test", role: "assistant", status: "completed", content: [{type: "output_text", text: JSON.stringify(content), annotations: []}]}],
 usage: {input_tokens: 300, output_tokens: 400, total_tokens: 700}});

function routeSetup() {
 aiReply = () => aiResponse({...validContent, possibleAllergens: []});
 fakes = installFakeBackends((url, init) => { fakes.lastBody = JSON.parse(init.body); return aiReply(); });
 logs = [];
 console.info = (...args) => logs.push(JSON.stringify(args));
}
function routeTeardown() { fakes.restore(); console.info = originalInfo; }
const {POST} = require("../src/app/api/dish-card/route.ts");
const recipeCall = name => fakes.recipeCalls.filter(call => call.name === name);

test("route: the meal changed (another version or another title) -> 409 before AI or quota", async () => {
 routeSetup();
 try {
  fakes.dishWeek.version = 4;
  const moved = await POST(aiRequest("dish-card", body));
  assert.equal(moved.status, 409);
  assert.equal((await moved.json()).reason, "week_changed");
  fakes.dishWeek.version = 3;
  assert.equal((await POST(aiRequest("dish-card", {...body, dish: "Pisto"}))).status, 409);
  assert.equal(fakes.openAICalls, 0);
  assert.equal(fakes.begin.length, 0);
 } finally { routeTeardown(); }
});

test("route: a card the user already has for this title is reused and linked, without AI, quota or cost", async () => {
 routeSetup();
 try {
  fakes.ownCards = [{id: V1, version: 2, base_servings: 2, total_minutes: 40, ingredients: validContent.ingredients, steps: validContent.steps, possible_allergens: [], review_status: "inferred", recipes: {id: V2, title: "Lentejas estofadas", origin: "ai"}}];
  const response = await POST(aiRequest("dish-card", body));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.source, "existing");
  assert.equal(data.versionId, V1);
  assert.equal(data.link, "applied");
  assert.equal(fakes.openAICalls, 0);
  assert.equal(fakes.begin.length, 0);
  const link = recipeCall("update_week_slot_recipe")[0];
  assert.equal(link.body.p_recipe_version_id, V1);
  assert.equal(link.body.p_expected_version, 3);
 } finally { routeTeardown(); }
});

test("route: one AI attempt (shopping quota), saved as the user's inferred card with their session, then linked", async () => {
 routeSetup();
 try {
  const response = await POST(aiRequest("dish-card", body));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.source, "ai");
  assert.equal(data.card.reviewStatus, "inferred");
  assert.equal(data.card.title, "Lentejas estofadas");
  assert.equal(data.link, "applied");
  assert.ok(response.headers.get("X-Request-Id"));
  assert.equal(fakes.openAICalls, 1);
  assert.equal(fakes.lastBody.text.format.name, "dish_card");
  assert.match(fakes.lastBody.input, /"Lentejas estofadas"/);
  assert.equal(fakes.begin.length, 1);
  assert.equal(fakes.begin[0].p_flow, "shopping");
  const save = recipeCall("save_inferred_recipe")[0];
  assert.equal(save.authorization, `Bearer ${validToken}`, "written with the user's JWT, never the service key");
  assert.equal(save.body.p_title, "Lentejas estofadas");
  assert.equal(save.body.p_request_key, body.requestKey);
  assert.equal(save.body.p_card.model, "gpt-5.6-sol");
  assert.equal(recipeCall("update_week_slot_recipe")[0].authorization, `Bearer ${validToken}`);
  assert.equal(fakes.finish[0].p_status, "succeeded");
  assert.ok(fakes.finish[0].p_cost_usd > 0);
  assert.ok(!logs.join("").includes("Lentejas"), "no dish titles in logs");
 } finally { routeTeardown(); }
});

test("route: card saved but the week changed meanwhile -> 200 with link conflict (nothing else written)", async () => {
 routeSetup();
 try {
  fakes.linkResult = {status: "conflict", week_id: "40000000-0000-4000-8000-000000000001", version: 5, updated_at: null};
  const data = await (await POST(aiRequest("dish-card", body))).json();
  assert.equal(data.link, "conflict");
  assert.equal(data.card.reviewStatus, "inferred");
 } finally { routeTeardown(); }
});

test("route: invalid AI card -> 422 without retry or repair; OpenAI 503 -> 502 after one attempt; quota -> 429 before OpenAI", async () => {
 routeSetup();
 try {
  for (const [content, reason] of [[{...validContent, possibleAllergens: ["chocolate"]}, "allergens"], [{...validContent, steps: []}, "steps"], [{...validContent, baseServings: 40}, "servings"]]) {
   fakes.openAICalls = 0; fakes.finish.length = 0; fakes.recipeCalls.length = 0;
   aiReply = () => aiResponse(content);
   const response = await POST(aiRequest("dish-card", body));
   assert.equal(response.status, 422, reason);
   assert.equal((await response.json()).reason, reason);
   assert.equal(fakes.openAICalls, 1, "exactly one attempt");
   assert.equal(fakes.finish[0].p_reason, `invalid_output:${reason}`);
   assert.equal(recipeCall("save_inferred_recipe").length, 0, "nothing saved");
  }
  fakes.openAICalls = 0; fakes.finish.length = 0;
  aiReply = () => Response.json({error: {message: "synthetic", code: "test"}}, {status: 503});
  const failed = await POST(aiRequest("dish-card", body));
  assert.equal(failed.status, 502);
  assert.equal(fakes.openAICalls, 1);
  assert.equal(fakes.finish[0].p_reason, "openai_503");
  fakes.openAICalls = 0;
  fakes.beginResult = {allowed: false, id: "10000000-0000-4000-8000-000000000009", reason: "daily_quota", retry_after_seconds: 3600};
  const limited = await POST(aiRequest("dish-card", body));
  assert.equal(limited.status, 429);
  assert.equal(fakes.openAICalls, 0);
  assert.equal((await POST(aiRequest("dish-card", {...body, requestKey: "no"}))).status, 400);
 } finally { routeTeardown(); }
});
