const {test, beforeEach, afterEach} = require("node:test");
const assert = require("node:assert/strict");
const {createDevice, useDevice} = require("./helpers/fake-browser.cjs");
const {createIdentityStore} = require("../src/lib/session/identity.ts");
const repos = require("../src/lib/data/repositories.ts");
const pantry = require("../src/lib/data/pantry.ts");
const {createPantryBackend} = require("./helpers/fake-pantry.cjs");
const {migrateLegacyStorage, readLegacyOrigin} = require("../src/lib/storage/legacy.ts");
const {importLegacyData, declineLegacyImport, hasPendingLegacyData} = require("../src/lib/data/legacy-import.ts");
const {readEnvelope, scopeForUser, scopeHasPendingChanges} = require("../src/lib/storage/scoped-storage.ts");

// B1: identity-scoped local data and remote-as-source-of-truth. Synthetic auth and remote; no network.
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const week41 = {isoYear: 2026, isoWeek: 41};
const profileOf = (who, extra = {}) => ({sex: "female", birthDate: "1990-01-01", heightCm: 170, weightKg: 60, householdSize: 2, weeklyTrainingDays: 2, trainingTypes: [], goals: ["healthy_eating"], goal: "healthy_eating", dietaryRestrictions: ["none"], allergies: [], dislikedFoods: [who], ...extra});
const daysOf = dish => [{day: "Lunes", date: "5 oct", lunch: dish, dinner: "LIBRE"}];

// One shared "account backend" per test: two devices can talk to it.
function createRemoteBackend() {
 let clock = 0;
 const tick = () => `2026-10-06T10:00:00.${String(++clock).padStart(6, "0")}+00:00`;
 const state = {profiles: new Map(), weeks: new Map(), down: false, calls: 0};
 const pantryBackend = createPantryBackend();
 const entity = (map, key) => ({
  async fetch() {
   state.calls++;
   if (state.down) throw new Error("offline");
   const row = map.get(key);
   return {data: row ? structuredClone(row.data) : null, version: row?.version ?? null};
  },
  async push(data) {
   state.calls++;
   if (state.down) throw new Error("offline");
   const version = tick();
   map.set(key, {data: structuredClone(data), version});
   return {version};
  },
 });
 const remotes = {
  profile: userId => entity(state.profiles, userId),
  week: (userId, isoWeek) => entity(state.weeks, `${userId}:${isoWeek.isoYear}-${isoWeek.isoWeek}`),
  pantry: userId => pantryBackend.remote(userId),
  shopping: () => ({fetch: async () => ({week: null, list: null}), save: async () => ({status: "no_week"}), setChecked: async () => ({status: "missing"})}),
 };
 return {state, remotes, editElsewhere: (map, key, data) => map.set(key, {data, version: tick()})};
}

function createFakeAuth(initialUser = null) {
 let session = initialUser ? {user: {id: initialUser, email: `${initialUser.slice(-1)}@example.invalid`}} : null;
 const listeners = new Set();
 const emit = (event, next) => { session = next; listeners.forEach(fn => fn(event, next)); };
 return {
  auth: {
   async getSession() { return {data: {session}}; },
   onAuthStateChange(fn) { listeners.add(fn); return {data: {subscription: {unsubscribe: () => listeners.delete(fn)}}}; },
   async signOut() { emit("SIGNED_OUT", null); return {error: null}; },
  },
  signIn: userId => emit("SIGNED_IN", {user: {id: userId, email: `${userId.slice(-1)}@example.invalid`}}),
  expire: () => emit("SIGNED_OUT", null),
 };
}

const idFor = identity => ({scope: identity.scope, userId: identity.userId});
let backend, restoreDevice;

beforeEach(() => {
 backend = createRemoteBackend();
 repos.configureRemotes(backend.remotes);
 restoreDevice = useDevice(createDevice());
});
afterEach(() => {
 repos.configureRemotes(null);
 restoreDevice();
});

test("H3 regression: A signs in, saves, signs out; B signs in on the same device and sees none of A's data", async () => {
 const auth = createFakeAuth(A);
 const store = createIdentityStore(auth);
 await store.start();
 const asA = idFor(store.getSnapshot());
 assert.equal(asA.scope, scopeForUser(A));
 assert.equal((await repos.saveProfile(asA, profileOf("A", {id: "profile-of-A"}))).status, "synced");
 assert.equal((await repos.saveWeek(asA, week41, daysOf("Plato de A"))).status, "synced");
 assert.equal((await pantry.addPantryItem(asA, "especias", "Azafrán de A")).status, "synced");

 await store.signOut();
 assert.equal(store.getSnapshot().scope, "guest");
 assert.equal(store.getSnapshot().sessionExpired, false, "explicit sign-out is not an expiry");
 assert.equal(window.localStorage.keys().filter(k => k.includes(A)).length, 0, "A's device cache is removed on explicit sign-out");

 auth.signIn(B);
 const asB = idFor(store.getSnapshot());
 assert.equal(asB.userId, B);
 assert.equal(repos.readCachedProfile(asB), null);
 assert.equal(repos.readCachedWeek(asB, week41), null);
 assert.equal((await repos.loadProfile(asB)).data, null, "B has no profile of its own");
 assert.equal((await repos.loadWeek(asB, week41)).data, null);
 assert.equal((await pantry.loadPantry(asB)).data, null);
 assert.ok(!JSON.stringify(window.localStorage.map).includes("Plato de A"));
 assert.ok(!JSON.stringify(window.localStorage.map).includes("profile-of-A"));
});

test("switching directly from A to B (no sign-out) changes scope and bumps the epoch", async () => {
 const auth = createFakeAuth(A);
 const store = createIdentityStore(auth);
 await store.start();
 const firstEpoch = store.getSnapshot().epoch;
 await repos.saveProfile(idFor(store.getSnapshot()), profileOf("A"));
 auth.signIn(B);
 assert.equal(store.getSnapshot().userId, B);
 assert.ok(store.getSnapshot().epoch > firstEpoch);
 assert.equal(repos.readCachedProfile(idFor(store.getSnapshot())), null);
});

test("identity resolves before any data and guest is the default", async () => {
 const store = createIdentityStore(createFakeAuth(null));
 assert.equal(store.getSnapshot().status, "resolving");
 await store.start();
 assert.deepEqual([store.getSnapshot().status, store.getSnapshot().scope], ["ready", "guest"]);
});

test("guest mode works without an account, never calls the remote and never marks data as pending", async () => {
 const guest = {scope: "guest", userId: null};
 assert.equal((await repos.saveProfile(guest, profileOf("guest"))).status, "local");
 assert.equal((await repos.saveWeek(guest, week41, daysOf("Plato invitado"))).status, "local");
 const loaded = await repos.loadWeek(guest, week41);
 assert.equal(loaded.source, "local");
 assert.equal(loaded.data[0].lunch, "Plato invitado");
 assert.equal(readEnvelope("guest", "week", "2026-W41").pending, false);
 assert.equal(backend.state.calls, 0);
});

test("two devices: a change made on one appears on the other when it reloads", async () => {
 const deviceOne = createDevice(), deviceTwo = createDevice();
 const me = {scope: scopeForUser(A), userId: A};
 restoreDevice();
 let restore = useDevice(deviceTwo);
 await repos.saveProfile(me, profileOf("version 1"));
 assert.equal(repos.readCachedProfile(me).dislikedFoods[0], "version 1");
 restore();
 restore = useDevice(deviceOne);
 await repos.loadProfile(me);
 assert.equal((await repos.saveProfile(me, profileOf("version 2"))).status, "synced");
 restore();
 restoreDevice = useDevice(deviceTwo);
 // Device two still has version 1 cached; reloading shows the account's version 2.
 assert.equal(repos.readCachedProfile(me).dislikedFoods[0], "version 1");
 const reloaded = await repos.loadProfile(me);
 assert.equal(reloaded.source, "remote");
 assert.equal(reloaded.data.dislikedFoods[0], "version 2");
 assert.equal(repos.readCachedProfile(me).dislikedFoods[0], "version 2");
});

test("conflict: a pending change based on an old version is discarded; the remote wins", async () => {
 const me = {scope: scopeForUser(A), userId: A};
 await repos.saveWeek(me, week41, daysOf("Base"));
 backend.state.down = true;
 assert.equal((await repos.saveWeek(me, week41, daysOf("Cambio sin conexión"))).status, "pending");
 backend.state.down = false;
 backend.editElsewhere(backend.state.weeks, `${A}:2026-41`, daysOf("Cambio en otro dispositivo"));
 const result = await repos.loadWeek(me, week41);
 assert.equal(result.discardedLocalChanges, true);
 assert.equal(result.data[0].lunch, "Cambio en otro dispositivo");
 assert.equal(scopeHasPendingChanges(me.scope), false);
});

test("a pending change whose base is still current is pushed on the next load", async () => {
 const me = {scope: scopeForUser(A), userId: A};
 await repos.saveWeek(me, week41, daysOf("Base"));
 backend.state.down = true;
 await repos.saveWeek(me, week41, daysOf("Cambio sin conexión"));
 backend.state.down = false;
 const result = await repos.loadWeek(me, week41);
 assert.deepEqual([result.discardedLocalChanges, result.pending, result.data[0].lunch], [false, false, "Cambio sin conexión"]);
 assert.equal((await backend.remotes.week(A, week41).fetch()).data[0].lunch, "Cambio sin conexión");
});

test("saving over a newer account version is refused and the account copy is shown", async () => {
 const me = {scope: scopeForUser(A), userId: A};
 await repos.saveProfile(me, profileOf("mine"));
 backend.editElsewhere(backend.state.profiles, A, profileOf("other device"));
 const result = await repos.saveProfile(me, profileOf("stale edit"));
 assert.equal(result.status, "conflict");
 assert.equal(result.remoteData.dislikedFoods[0], "other device");
 assert.equal(repos.readCachedProfile(me).dislikedFoods[0], "other device");
});

test("an explicit overwrite (user confirmed replacing the week) skips the version check", async () => {
 const me = {scope: scopeForUser(A), userId: A};
 backend.editElsewhere(backend.state.weeks, `${A}:2026-41`, daysOf("Semana anterior"));
 assert.equal((await repos.saveWeek(me, week41, daysOf("Menú nuevo"), {overwrite: true})).status, "synced");
 assert.equal((await backend.remotes.week(A, week41).fetch()).data[0].lunch, "Menú nuevo");
});

test("rapid saves on one device never conflict with each other; the last one wins", async () => {
 const me = {scope: scopeForUser(A), userId: A};
 const results = await Promise.all([1, 2, 3].map(n => repos.saveProfile(me, profileOf(`Item ${n}`))));
 assert.ok(results.every(r => r.status === "synced"), JSON.stringify(results));
 assert.equal((await backend.remotes.profile(A).fetch()).data.dislikedFoods[0], "Item 3");
 assert.equal(scopeHasPendingChanges(me.scope), false);
});

test("nothing is declared empty while the account is unreachable", async () => {
 const me = {scope: scopeForUser(A), userId: A};
 await repos.saveWeek(me, week41, daysOf("Guardado"));
 backend.state.down = true;
 const result = await repos.loadWeek(me, week41);
 assert.deepEqual([result.offline, result.source, result.data[0].lunch], [true, "cache", "Guardado"]);
 backend.state.down = false;
 backend.state.weeks.clear();
 const confirmed = await repos.loadWeek(me, week41);
 assert.deepEqual([confirmed.source, confirmed.data], ["remote", null]);
 assert.equal(repos.readCachedWeek(me, week41), null, "remote confirmed deletion clears the cache");
});

test("expired session: guest scope, notice flag, user cache and pending changes kept; re-login pushes them", async () => {
 const auth = createFakeAuth(A);
 const store = createIdentityStore(auth);
 await store.start();
 const me = idFor(store.getSnapshot());
 await repos.saveWeek(me, week41, daysOf("Base"));
 backend.state.down = true;
 await repos.saveWeek(me, week41, daysOf("Pendiente"));
 auth.expire();
 assert.deepEqual([store.getSnapshot().scope, store.getSnapshot().sessionExpired], ["guest", true]);
 assert.equal(repos.readCachedWeek(idFor(store.getSnapshot()), week41), null, "guest does not see the account's week");
 assert.equal(scopeHasPendingChanges(me.scope), true, "the user's pending change survives the expiry");
 backend.state.down = false;
 auth.signIn(A);
 assert.equal(store.getSnapshot().sessionExpired, false);
 const result = await repos.loadWeek(idFor(store.getSnapshot()), week41);
 assert.equal(result.data[0].lunch, "Pendiente");
 assert.equal((await backend.remotes.week(A, week41).fetch()).data[0].lunch, "Pendiente");
});

test("legacy keys move to the guest scope, never to an account, and are flagged for an explicit choice", () => {
 window.localStorage.setItem("becook-profile", JSON.stringify(profileOf("legacy")));
 window.localStorage.setItem("becook-week:2026-W41", JSON.stringify(daysOf("Plato antiguo")));
 window.localStorage.setItem("becook-pantry-base", JSON.stringify(["sal"]));
 window.localStorage.setItem("becook-selected-iso-week", JSON.stringify(week41));
 window.localStorage.setItem("becook-shopping-list-cache", JSON.stringify({weekSignature: "x", items: [], checkedItemIds: []}));
 window.localStorage.setItem("becook-week", JSON.stringify(daysOf("Sin semana")));
 const origin = migrateLegacyStorage();
 assert.deepEqual(origin.entities, ["pantry", "profile", "week:2026-W41"]);
 assert.equal(origin.status, "pending");
 assert.equal(window.localStorage.keys().filter(k => k.startsWith("becook-")).length, 0, "old unscoped keys are gone");
 assert.ok(window.localStorage.keys().every(k => k.startsWith("becook:guest:")), window.localStorage.keys().join());
 assert.equal(repos.readCachedWeek({scope: "guest", userId: null}, week41)[0].lunch, "Plato antiguo");
 assert.deepEqual(migrateLegacyStorage(), origin, "idempotent");
});

test("legacy import: only what the account lacks is added; existing account data is never overwritten", async () => {
 window.localStorage.setItem("becook-profile", JSON.stringify(profileOf("legacy")));
 window.localStorage.setItem("becook-week:2026-W41", JSON.stringify(daysOf("Plato antiguo")));
 migrateLegacyStorage();
 backend.editElsewhere(backend.state.profiles, A, profileOf("account"));
 const me = {scope: scopeForUser(A), userId: A};
 const result = await importLegacyData(me);
 assert.deepEqual(result, {imported: ["week:2026-W41"], keptInAccount: ["profile"], failed: []});
 assert.equal((await backend.remotes.profile(A).fetch()).data.dislikedFoods[0], "account");
 assert.equal((await backend.remotes.week(A, week41).fetch()).data[0].lunch, "Plato antiguo");
 assert.equal(repos.readCachedWeek({scope: "guest", userId: null}, week41), null, "imported data leaves the guest scope");
 assert.equal(repos.readCachedProfile({scope: "guest", userId: null}).dislikedFoods[0], "legacy", "kept data stays as guest");
 assert.equal(hasPendingLegacyData(), false);
});

test("legacy import declined: data stays as guest and is not offered again; failures stay offered", async () => {
 window.localStorage.setItem("becook-week:2026-W41", JSON.stringify(daysOf("Plato antiguo")));
 migrateLegacyStorage();
 backend.state.down = true;
 const failed = await importLegacyData({scope: scopeForUser(A), userId: A});
 assert.deepEqual(failed.failed, ["week:2026-W41"]);
 assert.equal(hasPendingLegacyData(), true);
 declineLegacyImport();
 assert.equal(readLegacyOrigin().status, "declined");
 assert.equal(hasPendingLegacyData(), false);
 assert.equal(repos.readCachedWeek({scope: "guest", userId: null}, week41)[0].lunch, "Plato antiguo");
});

test("guests are never asked to import: the offer needs a signed-in user", async () => {
 window.localStorage.setItem("becook-profile", JSON.stringify(profileOf("legacy")));
 migrateLegacyStorage();
 const result = await importLegacyData({scope: "guest", userId: null});
 assert.deepEqual(result, {imported: [], keptInAccount: [], failed: []});
 assert.equal(readLegacyOrigin().status, "pending");
});
