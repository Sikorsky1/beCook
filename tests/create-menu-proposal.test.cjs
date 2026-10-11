const {test, beforeEach, afterEach} = require("node:test");
const assert = require("node:assert/strict");

// D3 (roadmap steps 26, 27 and 28): applying a proposal with the page's own confirmation and a
// short «Deshacer», a generation that can be cancelled and survives leaving the page, and
// «Otra idea» per dish in the preview. The real data layer runs against an in-memory account with
// the semantics of apply_week (version, request keys); no network, no AI.
const path = require("node:path");
const {createDevice, useDevice} = require("./helpers/fake-browser.cjs");
const repos = require("../src/lib/data/repositories.ts");
const {RemoteConflictError} = require("../src/lib/data/sync.ts");
const {readEnvelope} = require("../src/lib/storage/scoped-storage.ts");
const {applyMenuToWeek, resolveApplyWeekAttempt, undoAppliedMenu, undoMessages} = require("../src/lib/applyWeek.ts");
const {replaceProposalDish, requestProposalIdea} = require("../src/lib/dishSubstitution.ts");
const {readMenuProfile} = require("../src/lib/menu-generation/prompt.ts");
const {checkReplacement, substitutionRequestFor} = require("../src/lib/menu-generation/substitution.ts");

const A = "00000000-0000-4000-8000-00000000000a";
const asA = {scope: "u_" + A, userId: A};
const guest = {scope: "guest", userId: null};
const W41 = {isoYear: 2026, isoWeek: 41};
const days = (lunch, dinner = "Tortilla") => [
 {day: "Lunes", date: "5 oct", lunch, dinner},
 {day: "Miércoles", date: "7 oct", lunch: "Merluza", dinner: "LIBRE"},
];
const dishes = weekDays => weekDays.map(day => [day.day, day.lunch, day.dinner].join("|"));

// The account: weeks with version and the request keys already applied (like apply_week).
function createAccount() {
 const st = {weeks: new Map(), down: false, loseNextAnswer: false, pushes: 0};
 const offline = () => { if (st.down) throw new TypeError("fetch failed"); };
 const week = (userId, isoWeek, options = {}) => {
  const k = `${userId}:${isoWeek.isoYear}-W${isoWeek.isoWeek}`;
  return {
   checksVersion: true,
   sameData: repos.sameWeekDays,
   async fetch() {
    offline();
    const row = st.weeks.get(k);
    return {data: row ? structuredClone(row.days) : null, version: row ? String(row.version) : null};
   },
   async push(data, {baseVersion, overwrite}) {
    st.pushes++; offline();
    const row = st.weeks.get(k);
    const key = options.requestKey ?? "random-" + Math.random();
    if (row?.keys.includes(key)) return {version: String(row.version), duplicate: true};
    const current = row ? String(row.version) : null;
    if (!overwrite && current !== baseVersion) throw new RemoteConflictError();
    const next = {days: structuredClone(data), version: (row?.version ?? 0) + 1, keys: [...(row?.keys ?? []), key]};
    st.weeks.set(k, next);
    if (st.loseNextAnswer) { st.loseNextAnswer = false; throw new TypeError("fetch failed"); }
    return {version: String(next.version)};
   },
  };
 };
 const unused = () => { throw new Error("not used"); };
 return {
  st,
  remotes: {week, profile: unused, pantry: unused, shopping: unused},
  row: (userId, isoWeek) => st.weeks.get(`${userId}:${isoWeek.isoYear}-W${isoWeek.isoWeek}`),
  seed: (userId, isoWeek, weekDays, version = 1) =>
   st.weeks.set(`${userId}:${isoWeek.isoYear}-W${isoWeek.isoWeek}`, {days: weekDays, version, keys: []}),
 };
}

let account, restoreDevice;
beforeEach(() => {
 account = createAccount();
 repos.configureRemotes(account.remotes);
 restoreDevice = useDevice(createDevice());
});
afterEach(() => {
 repos.configureRemotes(null);
 restoreDevice();
});

let keyCount = 0;
const newKey = () => "key-" + (++keyCount);

function apply(identity, weekDays, extra = {}) {
 const attempt = extra.attempt ?? resolveApplyWeekAttempt(null, weekDays, "2026-W41", newKey);
 return applyMenuToWeek({
  identity, isoWeek: W41, weekDays, attempt,
  confirmReplace: async () => true,
  prepareShopping: async () => ({status: "ready"}),
  ...extra,
 });
}

// --- Step 26: own confirmation -------------------------------------------------------------

test("replacing asks once with the menu that is replaced; «Mantener» writes nothing; an empty week is not asked", async () => {
 account.seed(A, W41, days("Lentejas"));
 const asked = [];
 const kept = await apply(asA, days("Garbanzos"), {confirmReplace: async current => { asked.push(current); return false; }});
 assert.equal(kept.outcome.menu, "cancelled");
 assert.equal(kept.replaced, null);
 assert.equal(asked.length, 1);
 assert.deepEqual(dishes(asked[0]), dishes(days("Lentejas")), "the dialog receives the account's current menu");
 assert.equal(account.row(A, W41).days[0].lunch, "Lentejas");
 assert.equal(account.st.pushes, 0);

 const W42 = {isoYear: 2026, isoWeek: 42};
 let askedEmpty = false;
 const attempt = resolveApplyWeekAttempt(null, "m", "2026-W42", newKey);
 const empty = await applyMenuToWeek({
  identity: asA, isoWeek: W42, weekDays: days("Garbanzos"), attempt,
  confirmReplace: () => { askedEmpty = true; return true; },
  prepareShopping: async () => ({status: "ready"}),
 });
 assert.equal(askedEmpty, false);
 assert.equal(empty.outcome.menu, "account");
 assert.equal(empty.replaced, null, "no earlier menu: nothing to undo");
});

test("a confirmed replacement returns the replaced menu; a retry of the same attempt does not ask again", async () => {
 account.seed(A, W41, days("Lentejas"));
 let asks = 0;
 const attempt = resolveApplyWeekAttempt(null, "m", "2026-W41", newKey);
 account.st.loseNextAnswer = true;
 const first = await apply(asA, days("Garbanzos"), {attempt, confirmReplace: async () => { asks++; return true; }});
 assert.equal(first.outcome.menu, "pending");
 const again = await apply(asA, days("Garbanzos"), {attempt, confirmReplace: async () => { asks++; return true; }});
 assert.equal(asks, 1);
 assert.equal(again.outcome.menu, "account");
 assert.deepEqual(dishes(again.replaced), dishes(days("Lentejas")), "still known for «Deshacer» on the retry");
 assert.equal(account.row(A, W41).version, 2, "written once");
});

test("guest: replacing the menu on this device is confirmed too", async () => {
 await apply(guest, days("Lentejas"));
 const asked = [];
 const kept = await apply(guest, days("Garbanzos"), {confirmReplace: current => { asked.push(current); return false; }});
 assert.equal(kept.outcome.menu, "cancelled");
 assert.deepEqual(dishes(asked[0]), dishes(days("Lentejas")));
 assert.equal(repos.readCachedWeek(guest, W41)[0].lunch, "Lentejas");

 const replaced = await apply(guest, days("Garbanzos"));
 assert.equal(replaced.outcome.menu, "device");
 assert.deepEqual(dishes(replaced.replaced), dishes(days("Lentejas")));
 assert.equal(repos.readCachedWeek(guest, W41)[0].lunch, "Garbanzos");
});

// --- Step 26: «Deshacer» ---------------------------------------------------------------------

test("while it can be undone the shopping list is not prepared; undoing skips it, closing the window prepares it", async () => {
 account.seed(A, W41, days("Lentejas"));
 let calls = 0;
 let release;
 const holdShopping = new Promise(resolve => { release = resolve; });
 const {shopping} = await apply(asA, days("Garbanzos"), {holdShopping, prepareShopping: async () => { calls++; return {status: "ready"}; }});
 await new Promise(resolve => setTimeout(resolve, 20));
 assert.equal(calls, 0, "the current list is left alone while «Deshacer» is offered");
 release(false);
 assert.equal(await shopping, "skipped");
 assert.equal(calls, 0);

 let release2;
 const hold2 = new Promise(resolve => { release2 = resolve; });
 const second = await apply(asA, days("Alubias"), {holdShopping: hold2, prepareShopping: async () => { calls++; return {status: "ready"}; }});
 release2(true);
 assert.equal(await second.shopping, "ready");
 assert.equal(calls, 1);
});

test("undo restores every day of the replaced menu, checked against the version the replacement produced", async () => {
 account.seed(A, W41, days("Lentejas", "Crema de calabaza"));
 const {replaced} = await apply(asA, [{day: "Martes", date: "6 oct", lunch: "Garbanzos", dinner: "Sopa"}]);
 assert.equal(account.row(A, W41).version, 2);
 const result = await undoAppliedMenu(asA, W41, {previous: replaced, requestKey: newKey()});
 assert.equal(result.status, "restored");
 assert.equal(result.message, undoMessages.restored);
 assert.deepEqual(dishes(account.row(A, W41).days), dishes(days("Lentejas", "Crema de calabaza")));
 assert.equal(account.row(A, W41).version, 3);
 assert.equal(readEnvelope(asA.scope, "week", "2026-W41").pending, false);
});

test("undo after another device changed the week writes nothing and says so", async () => {
 account.seed(A, W41, days("Lentejas"));
 const {replaced} = await apply(asA, days("Garbanzos"));
 account.seed(A, W41, days("Del móvil"), 7);
 const result = await undoAppliedMenu(asA, W41, {previous: replaced, requestKey: newKey()});
 assert.equal(result.status, "conflict");
 assert.equal(result.message, undoMessages.conflict);
 assert.equal(account.row(A, W41).days[0].lunch, "Del móvil");
 assert.equal(account.row(A, W41).version, 7);
});

test("undo whose answer is lost is retried with the same key and applied once", async () => {
 account.seed(A, W41, days("Lentejas"));
 const {replaced} = await apply(asA, days("Garbanzos"));
 const undo = {previous: replaced, requestKey: newKey()};
 account.st.loseNextAnswer = true;
 const first = await undoAppliedMenu(asA, W41, undo);
 assert.equal(first.status, "pending");
 const second = await undoAppliedMenu(asA, W41, undo);
 assert.equal(second.status, "restored");
 assert.equal(account.row(A, W41).version, 3, "one restore");
 assert.equal(account.row(A, W41).days[0].lunch, "Lentejas");
});

test("guest undo restores the device menu", async () => {
 await apply(guest, days("Lentejas"));
 const {replaced} = await apply(guest, days("Garbanzos"));
 const result = await undoAppliedMenu(guest, W41, {previous: replaced, requestKey: newKey()});
 assert.equal(result.status, "restored");
 assert.equal(result.message, undoMessages.device);
 assert.equal(repos.readCachedWeek(guest, W41)[0].lunch, "Lentejas");
});

// --- Step 27: a run that can be cancelled and outlives the page ------------------------------

function freshDraftModule() {
 const file = path.resolve(__dirname, "../src/lib/createMenuDraft.ts");
 delete require.cache[file];
 return require(file);
}

const form = {mode: "generate", menuText: "", freeTextPrompt: "cenas ligeras", peopleCount: 3, menuStyles: ["mediterranean"], elaborationLevel: 2};

test("a running generation is found again by the same identity and week only, with its form; finishing clears it", async () => {
 const draft = freshDraftModule();
 const {run, finish} = draft.startGenerationRun({scope: asA.scope, week: "2026-W41", mode: "generate", startedAt: 1000}, form);
 assert.equal(draft.activeGenerationRun(asA.scope, "2026-W41"), run);
 assert.deepEqual(run.draft, form);
 assert.equal(draft.activeGenerationRun(asA.scope, "2026-W42"), null);
 assert.equal(draft.activeGenerationRun("guest", "2026-W41"), null);
 assert.equal(draft.consumeInterruptedGeneration(asA.scope, "2026-W41"), null, "still running in this tab: not interrupted");

 run.controller.abort();
 finish({status: "cancelled"});
 assert.deepEqual(await run.done, {status: "cancelled"});
 assert.equal(draft.activeGenerationRun(asA.scope, "2026-W41"), null);
 assert.equal(draft.consumeInterruptedGeneration(asA.scope, "2026-W41"), null, "a finished run is not reported as interrupted");
});

test("a reload during a generation returns its form once and says it was interrupted", () => {
 freshDraftModule().startGenerationRun({scope: asA.scope, week: "2026-W41", mode: "generate", startedAt: 1000}, form);
 const afterReload = freshDraftModule();
 assert.equal(afterReload.consumeInterruptedGeneration("guest", "2026-W41"), null, "another identity does not get it");
 assert.deepEqual(afterReload.consumeInterruptedGeneration(asA.scope, "2026-W41"), form);
 assert.equal(afterReload.consumeInterruptedGeneration(asA.scope, "2026-W41"), null, "said once");
 assert.equal(afterReload.consumeCreateMenuDraft(), null, "the form is not restored a second time");
});

// --- Step 28: «Otra idea» in the preview ----------------------------------------------------

const proposal = {
 week: "",
 openaiTelemetry: {modelUsed: "test"},
 days: [
  {dayName: "Lunes", lunch: {status: "planned", dishName: "Lentejas estofadas"}, dinner: {status: "planned", dishName: "Tortilla de patatas"}},
  {dayName: "Martes", lunch: {status: "planned", dishName: "Merluza al horno"}, dinner: {status: "free", dishName: ""}},
 ],
};

test("replacing one dish of the proposal keeps every other day, meal and field; a free meal is never filled", () => {
 const next = replaceProposalDish(proposal, {day: "Lunes", meal: "dinner"}, "Crema de calabaza");
 assert.equal(next.days[0].dinner.dishName, "Crema de calabaza");
 assert.deepEqual(next.days[0].lunch, proposal.days[0].lunch);
 assert.deepEqual(next.days[1], proposal.days[1]);
 assert.equal(next.openaiTelemetry, proposal.openaiTelemetry);
 assert.equal(proposal.days[0].dinner.dishName, "Tortilla de patatas", "the original proposal is not mutated");
 assert.equal(replaceProposalDish(proposal, {day: "Martes", meal: "dinner"}, "Sopa").days[1].dinner.status, "free");
});

const weekDays = [
 {day: "Lunes", date: "5 oct", lunch: "Lentejas estofadas", dinner: "Tortilla de patatas"},
 {day: "Martes", date: "6 oct", lunch: "Merluza al horno", dinner: "LIBRE"},
];

test("a preview idea comes from the reviewed catalogue, fits the profile and the rest of the week, and skips discarded ones", () => {
 const profile = {dietaryRestrictions: ["vegetarian"], allergies: ["lactose"], dislikedFoods: ["brócoli"]};
 const slot = {day: "Lunes", meal: "dinner"};
 const rejected = ["Tortilla de patatas"];
 const seen = [];
 for (let i = 0; i < 3; i++) {
  const idea = requestProposalIdea(weekDays, slot, [...rejected, ...seen], profile, "catalog", true);
  if (idea.status !== "found") break;
  assert.equal(idea.source, "catalog");
  assert.equal(checkReplacement(idea.dish, substitutionRequestFor(weekDays, slot, [...rejected, ...seen]), readMenuProfile(profile)), null);
  assert.ok(!seen.includes(idea.dish));
  seen.push(idea.dish);
 }
 assert.ok(seen.length >= 1);
});

test("catalogue exhausted: signed in → offer AI; guest → login, and the AI is never called without a session", async () => {
 const vegan = {dietaryRestrictions: ["vegan"]};
 const veganWeek = [
  {day: "Lunes", date: "", lunch: "Lentejas estofadas", dinner: "Espaguetis con brócoli"},
  {day: "Martes", date: "", lunch: "Escalibada", dinner: "Espárragos, berenjena, calabacín y zanahoria plancha"},
 ];
 const slot = {day: "Lunes", meal: "lunch"};
 assert.deepEqual(requestProposalIdea(veganWeek, slot, [], vegan, "catalog", true), {status: "catalog_exhausted"});
 assert.deepEqual(requestProposalIdea(veganWeek, slot, [], vegan, "catalog", false), {status: "login_required"});

 const originalFetch = global.fetch;
 let fetched = false;
 global.fetch = async () => { fetched = true; throw new Error("no network in tests"); };
 try {
  assert.deepEqual(await requestProposalIdea(veganWeek, slot, [], vegan, "ai", false), {status: "login_required"});
  assert.equal(fetched, false);
 } finally {
  global.fetch = originalFetch;
 }
});

test("a malformed profile never gets an idea (its allergies could be skipped)", () => {
 const idea = requestProposalIdea(weekDays, {day: "Lunes", meal: "lunch"}, [], {allergies: "nuts"}, "catalog", true);
 assert.equal(idea.status, "error");
});

// Integration of C1 and D3: the proposal carries the context /api/generate-menu used.
const {parseVerifiedFoodContext} = require("../src/lib/menu-generation/food-context.ts");
const {proposalIdeaProfile, requestAiIdea} = require("../src/lib/dishSubstitution.ts");
const serverContext = {servings: 3, dietaryRestrictions: ["vegetarian"], allergies: ["nuts"], otherAllergies: "", dislikedFoods: ["rábano"], version: "fc1:abc"};

test("the verified food context of a response is read as is, and a malformed or absent one is ignored", () => {
 assert.deepEqual(parseVerifiedFoodContext(serverContext), serverContext);
 assert.deepEqual(parseVerifiedFoodContext({...serverContext, servings: null}), {...serverContext, servings: null});
 assert.equal(parseVerifiedFoodContext(undefined), null);
 assert.equal(parseVerifiedFoodContext({...serverContext, allergies: "nuts"}), null);
 assert.equal(parseVerifiedFoodContext({...serverContext, version: undefined}), null);
});

test("preview ideas honour the server context even without (or against) the profile on this device", () => {
 const slot = {day: "Lunes", meal: "lunch"};
 const serverProfile = readMenuProfile(serverContext);
 for (const local of [null, {dietaryRestrictions: [], allergies: [], dislikedFoods: []}]) {
  const profile = proposalIdeaProfile(serverContext, local);
  const idea = requestProposalIdea(weekDays, slot, [], profile, "catalog", true);
  assert.equal(idea.status, "found");
  assert.equal(checkReplacement(idea.dish, substitutionRequestFor(weekDays, slot, []), serverProfile), null);
 }
 // A restriction added on this device after generating also counts.
 const both = readMenuProfile(proposalIdeaProfile(serverContext, {allergies: ["lactose"], otherAllergies: "sésamo"}));
 assert.deepEqual(both.allergies.sort(), ["lactose", "nuts"]);
 assert.deepEqual(both.dietaryRestrictions, ["vegetarian"]);
 assert.match(both.otherAllergies, /sésamo/);
 // Imported menus have no server context: the page's profile, unchanged.
 const local = {dietaryRestrictions: ["vegan"]};
 assert.equal(proposalIdeaProfile(null, local), local);
});

test("an AI idea is asked without the profile in the body and rejected if it breaks the context the server used", async () => {
 const auth = require("../src/lib/supabase/auth.ts");
 const originalToken = auth.getAccessToken;
 const originalFetch = global.fetch;
 const bodies = [];
 auth.getAccessToken = async () => "token";
 global.fetch = async (_url, init) => {
  bodies.push(JSON.parse(init.body));
  return new Response(JSON.stringify({dish: "Pollo al horno con patatas", source: "ai", foodContext: serverContext}), {status: 200});
 };
 try {
  const idea = await requestAiIdea(weekDays, {day: "Lunes", meal: "lunch"}, [], {}, undefined);
  assert.equal(idea.status, "error");
  assert.equal(bodies.length, 1);
  assert.equal("profile" in bodies[0], false);
  assert.equal(bodies[0].currentDish, "Lentejas estofadas");
 } finally {
  auth.getAccessToken = originalToken;
  global.fetch = originalFetch;
 }
});
