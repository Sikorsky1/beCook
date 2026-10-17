const {test, beforeEach, afterEach} = require("node:test");
const assert = require("node:assert/strict");

// B6: shopping list tied to its week (step 12) and stable signature (step 14). The real data layer
// runs against an in-memory account with the semantics of save_shopping_list and
// set_shopping_items_checked (current list = newest of the week); the AI route is stubbed. No network.
// C4: this account has no reconcile_shopping_list and the stubbed route answers whole-week items only
// (no breakdown per dish), so these tests also prove the fallback to the B6 behaviour (a dish change
// makes a new list). The C4 behaviour is in tests/shopping-recipes.test.cjs.
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "synthetic-anon-key";
const {createDevice, useDevice} = require("./helpers/fake-browser.cjs");
const {supabase} = require("../src/lib/supabase/client.ts");
const repos = require("../src/lib/data/repositories.ts");
const shopping = require("../src/lib/data/shopping.ts");
const {getShoppingSignature, matchesShoppingSignature, shoppingListContext} = require("../src/lib/shoppingListStorage.ts");
const {withWeekDates} = require("../src/lib/weekStorage.ts");

const A = "00000000-0000-4000-8000-00000000000a";
const asA = {scope: "u_" + A, userId: A};
const guest = {scope: "guest", userId: null};
const W41 = {isoYear: 2026, isoWeek: 41};
const W40 = {isoYear: 2026, isoWeek: 40};
const menu = (dish = "Lentejas") => withWeekDates([
 {day: "Lunes", date: "", lunch: dish, dinner: "Tortilla"},
 {day: "Miércoles", date: "", lunch: "Merluza", dinner: "LIBRE"},
], W41);
const generatedItems = [
 {name: "lentejas", quantity: 500, unit: "g", category: "despensa"},
 {name: "tomate", quantity: 4, unit: "ud", category: "frutería"},
 {name: "guisantes", quantity: 300, unit: "g", category: "congelados"},
 {name: "merluza", quantity: 400, unit: "g", category: "pescadería"},
];
const key = w => `${w.isoYear}-W${w.isoWeek}`;

// In-memory account: weeks (days, version, updated_at) and lists with their items.
function createAccount() {
 const st = {weeks: new Map(), lists: [], down: false, seq: 0, calls: {fetch: 0, save: 0, setChecked: 0}, hold: null};
 const tick = () => ++st.seq;
 const current = k => st.lists.filter(l => l.week === k).sort((x, y) => y.at - x.at)[0] ?? null;
 const asList = l => ({id: l.id, weekId: l.week, generatedAt: String(l.at).padStart(6, "0"), weekSignature: l.signature,
  items: l.items.map(i => ({...i}))});
 const offline = () => { if (st.down) throw new TypeError("fetch failed"); };
 const remote = (userId, isoWeek) => {
  const k = key(isoWeek);
  return {
   async fetch() {
    st.calls.fetch++; offline();
    const week = st.weeks.get(k);
    if (!week) return {week: null, list: null};
    const list = current(k);
    return {week: {days: structuredClone(week.days), version: week.version, updatedAt: String(week.updatedAt).padStart(6, "0"),
     ...(week.foodContext !== undefined ? {foodContext: week.foodContext} : {})}, list: list && asList(list)};
   },
   async save({signature, items, expectedWeekVersion}) {
    st.calls.save++;
    if (st.hold) await st.hold;
    offline();
    const week = st.weeks.get(k);
    if (!week) return {status: "no_week"};
    if (expectedWeekVersion !== null && expectedWeekVersion !== week.version) return {status: "week_changed", weekVersion: week.version};
    const now = current(k);
    if (now && now.signature === signature) return {status: "existing", list: asList(now), weekVersion: week.version};
    const list = {id: "list-" + tick(), week: k, at: tick(), signature, items: items.map(i => ({...i, id: "row-" + tick(), checked: false}))};
    st.lists.push(list);
    return {status: "created", list: asList(list), weekVersion: week.version};
   },
   async setChecked(ids, checked) {
    st.calls.setChecked++; offline();
    const list = st.lists.find(l => l.items.some(i => ids.includes(i.id)));
    if (!list || !ids.every(id => list.items.some(i => i.id === id))) return {status: "missing"};
    if (current(list.week) !== list) return {status: "stale"};
    for (const item of list.items) if (ids.includes(item.id)) item.checked = checked;
    return {status: "applied"};
   },
  };
 };
 // A write of the week by any client: version and updated_at always move, even with the same dishes.
 // foodContext (C1): the context frozen with this write (undefined: a week applied before C1).
 const writeWeek = (isoWeek, days, foodContext) => {
  const previous = st.weeks.get(key(isoWeek));
  st.weeks.set(key(isoWeek), {days: structuredClone(days), version: (previous?.version ?? 0) + 1, updatedAt: tick(), foodContext});
 };
 const noEntity = {fetch: async () => ({data: null, version: null}), push: async () => ({version: null})};
 return {st, writeWeek, listsOf: w => st.lists.filter(l => l.week === key(w)),
  remotes: {profile: () => noEntity, pantry: () => noEntity, week: () => noEntity, shopping: remote}};
}

let account, ai, restoreDevice, originalFetch, originalGetSession;
const devices = [];
function onDevice(device) { restoreDevice?.(); restoreDevice = useDevice(device); }
function newDevice() { const device = createDevice(); devices.push(device); onDevice(device); return device; }

beforeEach(() => {
 account = createAccount();
 repos.configureRemotes(account.remotes);
 ai = {calls: 0, gate: null, bodies: []};
 originalFetch = global.fetch;
 global.fetch = async (url, init) => {
  assert.equal(String(url), "/api/generate-shopping-list");
  ai.calls++;
  ai.bodies.push(JSON.parse(init.body));
  if (ai.gate) await ai.gate;
  return Response.json({items: generatedItems});
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

async function openShopping(identity = asA, isoWeek = W41, days = menu()) {
 return shopping.ensureShoppingList(identity, isoWeek, days);
}

test("signature: week, dishes, servings, restrictions and ingredient source; never dates, capitals or spacing", () => {
 const base = getShoppingSignature(W41, menu());
 assert.equal(getShoppingSignature(W41, withWeekDates(menu(), W40)), base, "presented dates are not part of it");
 assert.equal(getShoppingSignature(W41, menu("  LENTEJAS ")), base, "capitals and spacing are presentation");
 assert.equal(getShoppingSignature(W41, [...menu(), {day: "Viernes", date: "", lunch: "LIBRE", dinner: "LIBRE"}]), base,
  "a fully free day adds nothing to buy");
 assert.equal(getShoppingSignature(W41, [...menu()].reverse()), base, "day order in the array does not matter");
 assert.notEqual(getShoppingSignature(W41, menu("Garbanzos")), base);
 assert.notEqual(getShoppingSignature(W40, menu()), base, "another week has its own list");
 assert.notEqual(getShoppingSignature(W41, menu().map(d => d.day === "Lunes" ? {...d, day: "Martes"} : d)), base);
 const parsed = JSON.parse(base.slice(base.indexOf(":") + 1));
 assert.equal(parsed.week, "2026-W41");
 assert.equal(parsed.servings, shoppingListContext.servings);
 assert.ok("restrictions" in parsed && parsed.ingredientSource === "dish-titles-v1");
 assert.doesNotMatch(base, /oct|version/);
 // Device caches from B3 (dishes only) and before B3 (with dates) are still accepted.
 const days = menu();
 assert.ok(matchesShoppingSignature(JSON.stringify(days.map(d => [d.day, d.lunch, d.dinner])), W41, days));
 assert.ok(matchesShoppingSignature(JSON.stringify(days), W41, days));
 assert.equal(matchesShoppingSignature(getShoppingSignature(W40, days), W41, days), false);
});

test("first open generates once and stores one list for the week; reopening reuses it without AI", async () => {
 account.writeWeek(W41, menu());
 const first = await openShopping();
 assert.equal(first.status, "ready");
 assert.equal(ai.calls, 1);
 assert.equal(account.listsOf(W41).length, 1);
 assert.equal(first.view.source, "remote");
 assert.ok(first.view.items.some(item => item.id === "otros-guisantes-g"), "frozen food shown under «otros»");
 const again = await openShopping();
 assert.equal(ai.calls, 1);
 assert.deepEqual(again.view.items, first.view.items);
 assert.equal(account.listsOf(W41).length, 1);
});

test("N11: a week of catalogue dishes gets its list from the catalogue recipes, without AI", async () => {
 const days = withWeekDates([{day: "Lunes", date: "", lunch: "Lentejas estofadas", dinner: "Tortilla de patata"}], W41);
 account.writeWeek(W41, days);
 const result = await openShopping(asA, W41, days);
 assert.equal(result.status, "ready");
 assert.equal(ai.calls, 0);
 assert.ok(result.view.items.some(item => /lenteja/.test(item.name)));
});

test("marking writes only that item: no new list, no AI, the other items untouched", async () => {
 account.writeWeek(W41, menu());
 const {view} = await openShopping();
 const [tomato, lentils] = ["frutería-tomate-ud", "despensa-lentejas-g"];
 assert.equal((await shopping.setShoppingItemChecked(asA, W41, tomato, true)).status, "synced");
 assert.equal((await shopping.setShoppingItemChecked(asA, W41, lentils, true)).status, "synced");
 assert.equal((await shopping.setShoppingItemChecked(asA, W41, lentils, false)).status, "synced");
 const [list] = account.listsOf(W41);
 assert.equal(account.listsOf(W41).length, 1);
 assert.equal(ai.calls, 1);
 assert.deepEqual(list.items.filter(i => i.checked).map(i => i.name), ["tomate"]);
 assert.equal(view.items.length, list.items.length);
});

test("a second device, and a device with an older copy, read the account list and its marks first", async () => {
 account.writeWeek(W41, menu());
 const phone = devices[0];
 await openShopping();
 newDevice();
 await openShopping();
 onDevice(phone);
 await shopping.setShoppingItemChecked(asA, W41, "frutería-tomate-ud", true);
 const laptop = devices[1];
 onDevice(laptop);
 const seen = await openShopping();
 assert.equal(ai.calls, 1);
 assert.deepEqual(seen.view.checkedItemIds, ["frutería-tomate-ud"]);
 newDevice();
 const fresh = await openShopping();
 assert.deepEqual(fresh.view.checkedItemIds, ["frutería-tomate-ud"]);
 assert.equal(ai.calls, 1);
});

test("applying the same dishes again (new week version) keeps the list and its marks", async () => {
 account.writeWeek(W41, menu());
 await openShopping();
 await shopping.setShoppingItemChecked(asA, W41, "frutería-tomate-ud", true);
 account.writeWeek(W41, menu(" lentejas"));
 const after = await openShopping();
 assert.equal(ai.calls, 1);
 assert.equal(account.listsOf(W41).length, 1);
 assert.deepEqual(after.view.checkedItemIds, ["frutería-tomate-ud"]);
});

test("changing a dish without in-place update (server or database before C4) makes a new list; the previous one is kept", async () => {
 account.writeWeek(W41, menu());
 await openShopping();
 account.writeWeek(W41, menu("Garbanzos"));
 const after = await openShopping(asA, W41, menu("Garbanzos"));
 assert.equal(after.status, "ready");
 assert.equal(ai.calls, 2);
 assert.equal(account.listsOf(W41).length, 2);
});

test("marking in a past week changes only that week's list and creates no list anywhere", async () => {
 account.writeWeek(W40, menu());
 account.writeWeek(W41, menu());
 await openShopping(asA, W40);
 await openShopping(asA, W41);
 const before = JSON.stringify(account.listsOf(W41));
 await shopping.setShoppingItemChecked(asA, W40, "frutería-tomate-ud", true);
 assert.equal(JSON.stringify(account.listsOf(W41)), before);
 assert.equal(account.listsOf(W40).length, 1);
 assert.equal(account.listsOf(W41).length, 1);
 assert.equal(account.listsOf(W40)[0].items.find(i => i.name === "tomate").checked, true);
});

test("a mark on a list replaced elsewhere is refused (stale) and the device then shows the account list", async () => {
 account.writeWeek(W41, menu());
 await openShopping();
 const phone = devices[0];
 newDevice();
 account.writeWeek(W41, menu("Garbanzos"));
 await openShopping(asA, W41, menu("Garbanzos"));
 onDevice(phone);
 const result = await shopping.setShoppingItemChecked(asA, W41, "frutería-tomate-ud", true);
 assert.equal(result.status, "stale");
 assert.ok(account.st.lists.every(list => list.items.every(item => !item.checked)), "nothing written");
 const reloaded = await shopping.loadShoppingList(asA, W41, menu("Garbanzos"));
 assert.equal(reloaded.view.checkedItemIds.length, 0);
 assert.equal(reloaded.view.pending, false);
});

test("a mark made offline stays pending on the device and is sent on the next load", async () => {
 account.writeWeek(W41, menu());
 await openShopping();
 account.st.down = true;
 assert.equal((await shopping.setShoppingItemChecked(asA, W41, "frutería-tomate-ud", true)).status, "pending");
 const offline = await shopping.loadShoppingList(asA, W41, menu());
 assert.equal(offline.view.offline, true);
 assert.equal(offline.view.pending, true);
 assert.deepEqual(offline.view.checkedItemIds, ["frutería-tomate-ud"]);
 account.st.down = false;
 const back = await shopping.loadShoppingList(asA, W41, menu());
 assert.equal(back.view.pending, false);
 assert.equal(account.listsOf(W41)[0].items.find(i => i.name === "tomate").checked, true);
});

test("a list generated while the account was unreachable is saved later without calling the AI again", async () => {
 account.writeWeek(W41, menu());
 account.st.hold = Promise.resolve().then(() => { account.st.down = true; });
 const generated = await shopping.generateShoppingList(asA, W41, menu());
 account.st.hold = null;
 assert.equal(generated.view.pending, true);
 assert.equal(account.listsOf(W41).length, 0);
 await shopping.setShoppingItemChecked(asA, W41, "despensa-lentejas-g", true);
 account.st.down = false;
 const saved = await openShopping();
 assert.equal(ai.calls, 1);
 assert.equal(saved.view.pending, false);
 assert.equal(account.listsOf(W41).length, 1);
 assert.equal(account.listsOf(W41)[0].items.find(i => i.name === "lentejas").checked, true);
});

test("without reaching the account and without a copy, nothing is generated", async () => {
 account.writeWeek(W41, menu());
 account.st.down = true;
 const result = await openShopping();
 assert.deepEqual(result, {status: "missing", offline: true});
 assert.equal(ai.calls, 0);
});

test("one generation per week content: a second caller (page mounted again) waits for the same request", async () => {
 account.writeWeek(W41, menu());
 let release;
 ai.gate = new Promise(resolve => { release = resolve; });
 const first = shopping.generateShoppingList(asA, W41, menu());
 const second = shopping.generateShoppingList(asA, W41, menu());
 release();
 const [one, two] = await Promise.all([first, second]);
 assert.equal(ai.calls, 1);
 assert.equal(account.listsOf(W41).length, 1);
 assert.deepEqual(one, two);
});

test("two devices generating at once end with one list: the second save returns the existing one", async () => {
 account.writeWeek(W41, menu());
 const phone = devices[0];
 const one = await shopping.generateShoppingList(asA, W41, menu());
 newDevice();
 const two = await shopping.generateShoppingList(asA, W41, menu());
 assert.equal(account.listsOf(W41).length, 1);
 assert.equal(account.st.calls.save, 2);
 assert.deepEqual(two.view.items, one.view.items);
 onDevice(phone);
});

test("the week changed while generating: same dishes → saved on the new version; other dishes → not saved", async () => {
 account.writeWeek(W41, menu());
 // The device last saw version 1; the account moves on before the list is saved.
 const {writeScoped} = require("../src/lib/storage/scoped-storage.ts");
 writeScoped(asA.scope, "week", menu(), {week: "2026-W41", remoteVersion: "1"});
 account.writeWeek(W41, menu());
 const same = await shopping.generateShoppingList(asA, W41, menu());
 assert.equal(same.status, "ready");
 assert.equal(account.listsOf(W41).length, 1);
 writeScoped(asA.scope, "week", menu("Pollo"), {week: "2026-W41", remoteVersion: "2"});
 account.writeWeek(W41, menu("Garbanzos"));
 const other = await shopping.generateShoppingList(asA, W41, menu("Pollo"));
 assert.deepEqual(other, {status: "missing", offline: false});
 assert.equal(account.listsOf(W41).length, 1, "a list for other dishes is not stored");
});

test("lists saved before B6 (no signature) are reused only if generated after the week's last change (fallback without C4)", async () => {
 account.writeWeek(W41, menu());
 const legacyItems = generatedItems.map((item, n) => ({...item, id: "old-" + n, checked: n === 1}));
 account.st.lists.push({id: "legacy", week: "2026-W41", at: account.st.seq + 1, signature: null, items: legacyItems});
 account.st.seq++;
 const reused = await openShopping();
 assert.equal(ai.calls, 0);
 assert.deepEqual(reused.view.checkedItemIds, ["frutería-tomate-ud"]);
 account.writeWeek(W41, menu());
 newDevice();
 await openShopping();
 assert.equal(ai.calls, 1, "older than the last week change: generated again, the old list kept");
 assert.equal(account.listsOf(W41).length, 2);
});

test("guests keep their device list (also caches from B3) and never reach the account", async () => {
 const days = menu();
 repos.writeShoppingCache(guest, W41, {weekSignature: JSON.stringify(days.map(d => [d.day, d.lunch, d.dinner])), items: generatedItems, checkedItemIds: []});
 const loaded = await shopping.loadShoppingList(guest, W41, days);
 assert.equal(loaded.view.source, "local");
 assert.equal((await shopping.setShoppingItemChecked(guest, W41, "frutería-tomate-ud", true)).status, "local");
 assert.deepEqual((await shopping.loadShoppingList(guest, W41, days)).view.checkedItemIds, ["frutería-tomate-ud"]);
 assert.equal(account.st.calls.fetch + account.st.calls.save + account.st.calls.setChecked, 0);
 assert.equal(ai.calls, 0);
});

test("fast repeated marks of one item reach the account in order: the last one wins", async () => {
 account.writeWeek(W41, menu());
 await openShopping();
 await Promise.all([true, false, true, false, true].map(value =>
  shopping.setShoppingItemChecked(asA, W41, "frutería-tomate-ud", value)));
 assert.equal(account.listsOf(W41)[0].items.find(i => i.name === "tomate").checked, true);
 assert.deepEqual(repos.readShoppingCache(asA, W41).pendingChecks, {});
});

// --- C1: the week's frozen food context is part of the signature -----------------------------------

test("C1 signature: legacy weeks keep the B6 signature; servings and restrictions version change it", () => {
 const days = menu();
 const legacy = getShoppingSignature(W41, days);
 assert.equal(getShoppingSignature(W41, days, null), legacy, "no frozen context = signature of lists made before C1");
 assert.ok(legacy.includes('"servings":2') && legacy.includes('"restrictions":null'));
 const frozen = getShoppingSignature(W41, days, {servings: 2, version: "fc1:aaa"});
 assert.notEqual(frozen, legacy, "a list made without restrictions is not valid for a week that has them");
 assert.notEqual(getShoppingSignature(W41, days, {servings: 4, version: "fc1:aaa"}), frozen);
 assert.notEqual(getShoppingSignature(W41, days, {servings: 2, version: "fc1:bbb"}), frozen);
 assert.equal(getShoppingSignature(W41, withWeekDates(days, W40), {servings: 2, version: "fc1:aaa"}), frozen, "dates are still presentation");
 // Context unknown (account unreachable): the device list is matched by week and dishes only.
 assert.equal(matchesShoppingSignature(frozen, W41, days), true);
 assert.equal(matchesShoppingSignature(frozen, W41, days, null), false);
 assert.equal(matchesShoppingSignature(frozen, W41, menu("Pollo")), false);
});

test("C1: the list is signed with the week's context and the request names the week (servings read on the server)", async () => {
 account.writeWeek(W41, menu(), {servings: 4, version: "fc1:vegan"});
 const load = await openShopping();
 assert.equal(load.status, "ready");
 assert.equal(ai.calls, 1);
 assert.equal(ai.bodies[0].isoWeek, "2026-W41");
 assert.equal(ai.bodies[0].profile, undefined, "nothing about the profile is sent");
 assert.equal(account.listsOf(W41)[0].signature, getShoppingSignature(W41, menu(), {servings: 4, version: "fc1:vegan"}));
 // Reload: same list, no AI.
 assert.equal((await openShopping()).status, "ready");
 assert.equal(ai.calls, 1);
});

test("C1: a legacy week keeps its list; applying the menu again with a frozen context makes a new one (fallback without C4)", async () => {
 account.writeWeek(W41, menu());
 await openShopping();
 assert.equal(ai.calls, 1);
 account.writeWeek(W41, menu());
 await openShopping();
 assert.equal(ai.calls, 1, "same dishes, no context: the list is still valid");
 account.writeWeek(W41, menu(), {servings: 3, version: "fc1:nuts"});
 await openShopping();
 assert.equal(ai.calls, 2, "same dishes for 3 people and new restrictions: new list");
 assert.equal(account.listsOf(W41).length, 2, "the previous list stays as history");
});

test("C1: a direct generation signs with the account's context (two calls -> one AI request)", async () => {
 account.writeWeek(W41, menu(), {servings: 3, version: "fc1:x"});
 const [one, two] = await Promise.all([shopping.generateShoppingList(asA, W41, menu()), shopping.generateShoppingList(asA, W41, menu())]);
 assert.equal(one.status, "ready");
 assert.equal(two.status, "ready");
 assert.equal(ai.calls, 1);
 assert.equal(account.listsOf(W41)[0].signature, getShoppingSignature(W41, menu(), {servings: 3, version: "fc1:x"}));
});
