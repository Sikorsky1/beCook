const {test, beforeEach, afterEach} = require("node:test");
const assert = require("node:assert/strict");

// B5 (roadmap steps 11 and 15, audit H9): applying a menu apart from its shopping list, truthful
// save states, and recovery of failed writes without AI. The real data layer runs against an
// in-memory account with the semantics of apply_week (version, request keys); no network.
const {createDevice, useDevice} = require("./helpers/fake-browser.cjs");
const repos = require("../src/lib/data/repositories.ts");
const {RemoteConflictError} = require("../src/lib/data/sync.ts");
const {readEnvelope, clearScope, scopeHasPendingChanges} = require("../src/lib/storage/scoped-storage.ts");
const {applyMenuToWeek, applyWeekMessages, resolveApplyWeekAttempt} = require("../src/lib/applyWeek.ts");
const {syncStatus, syncStatusLabels} = require("../src/lib/syncStatus.ts");
const {readMenuProposal, writeMenuProposal, clearMenuProposal, attemptFromProposal} = require("../src/lib/menuProposal.ts");

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const asA = {scope: "u_" + A, userId: A};
const asB = {scope: "u_" + B, userId: B};
const guest = {scope: "guest", userId: null};
const W41 = {isoYear: 2026, isoWeek: 41};
const W42 = {isoYear: 2026, isoWeek: 42};
const days = dish => [
 {day: "Lunes", date: "5 oct", lunch: dish, dinner: "Tortilla"},
 {day: "Miércoles", date: "7 oct", lunch: "Merluza", dinner: "LIBRE"},
];
const importedMenu = dish => ({week: "", days: [
 {dayName: "Lunes", lunch: {status: "planned", dishName: dish}, dinner: {status: "planned", dishName: "Tortilla"}},
 {dayName: "Miércoles", lunch: {status: "planned", dishName: "Merluza"}, dinner: {status: "free", dishName: ""}},
]});

// The account: weeks with version and the request keys already applied (like apply_week).
// down: unreachable · loseNextAnswer: the next write is applied but its answer never arrives.
function createAccount() {
 const st = {weeks: new Map(), down: false, loseNextAnswer: false, pushes: 0, fetches: 0, profiles: new Map()};
 const offline = () => { if (st.down) throw new TypeError("fetch failed"); };
 const week = (userId, isoWeek, options = {}) => {
  const k = `${userId}:${isoWeek.isoYear}-W${isoWeek.isoWeek}`;
  return {
   checksVersion: true,
   sameData: repos.sameWeekDays,
   async fetch() {
    st.fetches++; offline();
    const row = st.weeks.get(k);
    return {data: row ? structuredClone(row.days).map(day => ({...day, date: ""})) : null, version: row ? String(row.version) : null};
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
 const remotes = {
  week,
  profile: userId => ({
   async fetch() { offline(); const row = st.profiles.get(userId); return {data: row?.data ?? null, version: row?.version ?? null}; },
   async push(data) { offline(); const version = String(Date.now() + Math.random()); st.profiles.set(userId, {data, version}); return {version}; },
  }),
  pantry: () => { throw new Error("not used"); },
  shopping: () => { throw new Error("not used"); },
 };
 return {st, remotes, seed: (userId, isoWeek, weekDays, version = 1) =>
  st.weeks.set(`${userId}:${isoWeek.isoYear}-W${isoWeek.isoWeek}`, {days: weekDays, version, keys: []})};
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
const neverEnding = () => new Promise(() => {});

function apply(identity, isoWeek, weekDays, attempt, extra = {}) {
 return applyMenuToWeek({
  identity, isoWeek, weekDays, attempt,
  confirmReplace: () => true,
  prepareShopping: extra.prepareShopping ?? (async () => ({status: "ready"})),
  ...extra,
 });
}

// --- Step 11: menu result apart from the shopping list -------------------------------------

test("the menu result arrives (and the week can open) while the shopping list is still being prepared", async () => {
 let shoppingStarted = false;
 const attempt = resolveApplyWeekAttempt(null, "menu", "2026-W41", newKey);
 const result = await Promise.race([
  apply(asA, W41, days("Lentejas"), attempt, {prepareShopping: () => { shoppingStarted = true; return neverEnding(); }}),
  new Promise(resolve => setTimeout(() => resolve("timed out"), 200)),
 ]);
 assert.notEqual(result, "timed out", "applying the menu must not wait for the shopping list");
 assert.equal(result.outcome.menu, "account");
 assert.equal(result.outcome.openWeek, true);
 assert.equal(result.outcome.message, applyWeekMessages.applied);
 assert.ok(shoppingStarted, "the list is still prepared, apart");
 assert.equal(readEnvelope(asA.scope, "week", "2026-W41").pending, false);
});

test("a failed shopping list never turns a saved menu into an error", async () => {
 const attempt = resolveApplyWeekAttempt(null, "menu", "2026-W41", newKey);
 const {outcome, shopping} = await apply(asA, W41, days("Lentejas"), attempt, {prepareShopping: async () => { throw new Error("AI down"); }});
 assert.equal(outcome.status, "success");
 assert.equal(await shopping, "failed");
});

test("no account answer: the menu stays only on this device, no list is prepared and the retry resends the same write once", async () => {
 let shoppingCalls = 0;
 const prepareShopping = async () => { shoppingCalls++; return {status: "ready"}; };
 const attempt = resolveApplyWeekAttempt(null, "menu", "2026-W41", newKey);
 // The account week was read (empty); then the write's answer is lost although it was applied.
 account.st.loseNextAnswer = true;
 const first = await apply(asA, W41, days("Lentejas"), attempt, {prepareShopping});
 assert.equal(first.outcome.menu, "pending");
 assert.equal(first.outcome.openWeek, false);
 assert.equal(first.outcome.attempt, "keep");
 assert.match(first.outcome.message, /Solo en este dispositivo/);
 assert.equal(await first.shopping, "skipped");
 assert.equal(readEnvelope(asA.scope, "week", "2026-W41").pending, true, "the device copy says it is not in the account");

 // «Reintentar guardado»: same attempt → same request key → applied once, no conflict.
 const again = resolveApplyWeekAttempt(attempt, "menu", "2026-W41", newKey);
 assert.equal(again.requestKey, attempt.requestKey);
 const second = await apply(asA, W41, days("Lentejas"), again, {prepareShopping});
 assert.equal(second.outcome.menu, "account");
 assert.equal(second.outcome.message, applyWeekMessages.duplicate);
 assert.equal(await second.shopping, "ready");
 assert.equal(shoppingCalls, 1, "the list is prepared only once the account has the menu");
 assert.equal(account.st.weeks.get(`${A}:2026-W41`).version, 1, "the menu was written once");
 assert.equal(readEnvelope(asA.scope, "week", "2026-W41").pending, false);
});

test("guest: saved on this device, never «en tu cuenta», no list prepared (no AI without a session)", async () => {
 let shoppingCalls = 0;
 const attempt = resolveApplyWeekAttempt(null, "menu", "2026-W41", newKey);
 const {outcome, shopping} = await apply(guest, W41, days("Lentejas"), attempt, {prepareShopping: async () => { shoppingCalls++; return {status: "ready"}; }});
 assert.equal(outcome.menu, "device");
 assert.equal(outcome.message, applyWeekMessages.device);
 assert.doesNotMatch(outcome.message, /guardado en tu cuenta/i);
 assert.equal(await shopping, "skipped");
 assert.equal(shoppingCalls, 0);
});

test("the account week cannot be read: nothing is saved, the attempt is kept; «no reemplazar»: nothing is saved", async () => {
 account.seed(A, W41, days("De antes"));
 account.st.down = true;
 const attempt = resolveApplyWeekAttempt(null, "menu", "2026-W41", newKey);
 const unchecked = await apply(asA, W41, days("Lentejas"), attempt);
 assert.equal(unchecked.outcome.menu, "unchecked");
 assert.equal(unchecked.outcome.attempt, "keep");
 assert.equal(readEnvelope(asA.scope, "week", "2026-W41"), null);

 account.st.down = false;
 const cancelled = await apply(asA, W41, days("Lentejas"), attempt, {confirmReplace: () => false});
 assert.equal(cancelled.outcome.menu, "cancelled");
 assert.equal(cancelled.outcome.openWeek, false);
 assert.equal(account.st.weeks.get(`${A}:2026-W41`).days[0].lunch, "De antes");
});

test("a proposal not applied is kept per identity and week, with its attempt, until it is saved or the user signs out", () => {
 const menu = importedMenu("Lentejas");
 writeMenuProposal(asA, W41, {menu, generationRequestId: "req-1", attempt: {requestKey: "key-x", overwrite: true, baseVersion: "3"}});
 const restored = readMenuProposal(asA, W41);
 assert.deepEqual(restored.menu, menu);
 assert.equal(restored.generationRequestId, "req-1");
 const attempt = attemptFromProposal(restored, restored.menu, "2026-W41");
 assert.equal(resolveApplyWeekAttempt(attempt, restored.menu, "2026-W41", newKey).requestKey, "key-x", "a reload retries the same write");
 assert.equal(readMenuProposal(asA, W42), null, "another week has none");
 assert.equal(readMenuProposal(asB, W41), null, "another user never sees it");
 assert.equal(readMenuProposal(guest, W41), null);
 assert.equal(scopeHasPendingChanges(asA.scope), false, "a proposal is not account data pending");

 window.localStorage.setItem(`becook:${asA.scope}:menu-proposal:2026-W42`, JSON.stringify({v: 1, data: {menu: {week: "", days: "x"}}}));
 assert.equal(readMenuProposal(asA, W42), null, "a broken copy is ignored");

 clearMenuProposal(asA, W41);
 assert.equal(readMenuProposal(asA, W41), null);
 writeMenuProposal(asA, W41, {menu, generationRequestId: null, attempt: null});
 clearScope(asA.scope);
 assert.equal(readMenuProposal(asA, W41), null, "explicit sign-out removes it with the rest of the user's cache");
});

// --- Step 15: recovering failed writes ------------------------------------------------------

test("a pending week whose write reached the account (answer lost) is recognised, not reported as lost changes", async () => {
 account.seed(A, W41, days("Lentejas"));
 await repos.loadWeek(asA, W41);
 account.st.loseNextAnswer = true;
 const saved = await repos.saveWeek(asA, W41, days("Garbanzos"));
 assert.equal(saved.status, "pending");

 const reloaded = await repos.loadWeek(asA, W41);
 assert.equal(reloaded.discardedLocalChanges, false, "the account has exactly this change: nothing was lost");
 assert.equal(reloaded.pending, false);
 assert.equal(reloaded.data[0].lunch, "Garbanzos");
 assert.equal(account.st.weeks.get(`${A}:2026-W41`).version, 2, "not written twice");
});

test("a pending week overtaken by a different change elsewhere is still discarded (the account wins)", async () => {
 account.seed(A, W41, days("Lentejas"));
 await repos.loadWeek(asA, W41);
 account.st.down = true;
 assert.equal((await repos.saveWeek(asA, W41, days("Garbanzos"))).status, "pending");
 account.st.down = false;
 account.seed(A, W41, days("Otro dispositivo"), 5);
 const reloaded = await repos.loadWeek(asA, W41);
 assert.equal(reloaded.discardedLocalChanges, true);
 assert.equal(reloaded.data[0].lunch, "Otro dispositivo");
});

test("two reads at once (page and «Reintentar», or the connection coming back) resend a pending change once", async () => {
 account.seed(A, W41, days("Lentejas"));
 await repos.loadWeek(asA, W41);
 account.st.down = true;
 assert.equal((await repos.saveWeek(asA, W41, days("Garbanzos"))).status, "pending");
 account.st.down = false;
 account.st.pushes = 0;

 const [first, second] = await Promise.all([repos.loadWeek(asA, W41), repos.loadWeek(asA, W41)]);
 assert.equal(account.st.pushes, 1, "the pending week is sent once");
 for (const result of [first, second]) {
  assert.equal(result.discardedLocalChanges, false);
  assert.equal(result.pending, false);
  assert.equal(result.data[0].lunch, "Garbanzos");
 }
});

test("«Reintentar» while still offline keeps the change pending; with connection it is saved, without AI", async () => {
 account.seed(A, W41, days("Lentejas"));
 await repos.loadWeek(asA, W41);
 account.st.down = true;
 await repos.saveWeek(asA, W41, days("Garbanzos"));
 const stillOffline = await repos.loadWeek(asA, W41);
 assert.equal(stillOffline.offline, true);
 assert.equal(stillOffline.pending, true);
 assert.equal(stillOffline.data[0].lunch, "Garbanzos", "the change is still shown");
 account.st.down = false;
 const back = await repos.loadWeek(asA, W41);
 assert.equal(back.pending, false);
 assert.equal(account.st.weeks.get(`${A}:2026-W41`).days[0].lunch, "Garbanzos");
});

test("same dishes on the same days are the same week, whatever the dates or order", () => {
 assert.equal(repos.sameWeekDays(days("Lentejas"), [...days("Lentejas ")].reverse().map(day => ({...day, date: ""}))), true);
 assert.equal(repos.sameWeekDays(days("Lentejas"), days("Garbanzos")), false);
 assert.equal(repos.sameWeekDays(days("Lentejas"), days("Lentejas").slice(0, 1)), false);
});

test("shopping marks or a list not saved in the account count as pending for the sign-out warning", () => {
 const cache = {weekSignature: "s", items: [], checkedItemIds: ["a"], listId: "list-1", itemIds: {a: ["row-1"]}, pendingChecks: {}};
 repos.writeShoppingCache(asA, W41, cache);
 assert.equal(scopeHasPendingChanges(asA.scope), false);
 repos.writeShoppingCache(asA, W41, {...cache, pendingChecks: {a: true}});
 assert.equal(scopeHasPendingChanges(asA.scope), true, "a mark the account has not accepted");
 repos.writeShoppingCache(asA, W41, {...cache, listId: null});
 assert.equal(scopeHasPendingChanges(asA.scope), true, "a list generated while the account could not be reached");
 repos.writeShoppingCache(guest, W41, {...cache, listId: null});
 assert.equal(scopeHasPendingChanges("guest"), false, "guests have nothing to sync");
});

// --- Step 15: visible states ----------------------------------------------------------------

test("visible states: one label per real result, «Guardado en tu cuenta» only when the account confirmed it", () => {
 assert.equal(syncStatus({signedIn: false}).label, "Solo en este dispositivo");
 assert.equal(syncStatus({signedIn: false, pending: true, offline: true}).kind, "device", "guests never see sync states");
 assert.equal(syncStatus({signedIn: true}).label, "Guardado en tu cuenta");
 assert.equal(syncStatus({signedIn: true, checking: true}).label, "Comprobando tu cuenta…");
 assert.equal(syncStatus({signedIn: true, saving: true, pending: true}).label, "Guardando…");
 const pending = syncStatus({signedIn: true, pending: true, offline: true});
 assert.equal(pending.label, "Pendiente de sincronizar");
 assert.equal(pending.canRetry, true);
 const error = syncStatus({signedIn: true, offline: true});
 assert.equal(error.label, "Error: reintentar");
 assert.equal(error.canRetry, true);
 for (const input of [{pending: true}, {offline: true}, {saving: true}, {checking: true}]) {
  assert.notEqual(syncStatus({signedIn: true, ...input}).kind, "saved", JSON.stringify(input));
 }
 assert.deepEqual(Object.values(syncStatusLabels).filter(label => /Guardado en tu cuenta|Solo en este dispositivo|Pendiente de sincronizar|Error: reintentar/.test(label)).length, 4);
});
