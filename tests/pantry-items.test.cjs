const {test, beforeEach, afterEach} = require("node:test");
const assert = require("node:assert/strict");
const {createDevice, useDevice} = require("./helpers/fake-browser.cjs");
const {createPantryBackend} = require("./helpers/fake-pantry.cjs");
const repos = require("../src/lib/data/repositories.ts");
const pantry = require("../src/lib/data/pantry.ts");
const {migrateLegacyStorage} = require("../src/lib/storage/legacy.ts");
const {importLegacyData} = require("../src/lib/data/legacy-import.ts");
const {readEnvelope, scopeForUser, scopeHasPendingChanges, writeScoped} = require("../src/lib/storage/scoped-storage.ts");

// B7 (roadmap step 13): the pantry is read from the account and written item by item, with a
// version per item. Synthetic account store and devices; no network.
const A = "00000000-0000-4000-8000-00000000000a";
const me = {scope: scopeForUser(A), userId: A};
const guest = {scope: "guest", userId: null};
const DEFAULTS = ["Aceite de oliva", "Ajo en polvo", "Mostaza", "Pimienta", "Sal", "Vinagre"];
const unusedRemote = {fetch: async () => ({data: null, version: null}), push: async () => ({version: null})};

let backend, account, devices, restore;
const onDevice = device => { useDevice(device); return device; };
const names = items => (items ?? []).map(item => item.name).sort();
const shown = (items, name) => items.find(item => item.name === name);
const rows = () => account.rows().sort((a, b) => a.name.localeCompare(b.name));

beforeEach(() => {
 backend = createPantryBackend();
 account = backend.elsewhere(A);
 repos.configureRemotes({profile: () => unusedRemote, week: () => unusedRemote, shopping: () => null, pantry: userId => backend.remote(userId)});
 devices = [createDevice(), createDevice()];
 restore = useDevice(devices[0]);
});
afterEach(() => {
 repos.configureRemotes(null);
 restore();
});

test("an empty account shows the default items; the first change adds them once, with that change", async () => {
 const first = await pantry.loadPantry(me);
 assert.equal(first.data, null, "nothing stored yet");
 assert.deepEqual(names(pantry.readPantryView(me)), DEFAULTS);
 const result = await pantry.setPantryItemActive(me, "básicos", "Sal", false);
 assert.equal(result.status, "synced");
 assert.equal(backend.state.calls.add, 1, "one request for the defaults and the change");
 assert.deepEqual(rows().map(row => row.name), DEFAULTS);
 assert.equal(rows().find(row => row.name === "Sal").active, false);
 onDevice(devices[1]);
 const other = await pantry.loadPantry(me);
 assert.deepEqual(names(other.data), DEFAULTS);
 assert.equal(shown(other.data, "Sal").active, false);
});

test("changing an item writes only that item: same rows, only its version moves; never a whole replace", async () => {
 account.insert("Sal", "básicos");
 account.insert("Comino", "especias");
 await pantry.loadPantry(me);
 const before = rows();
 assert.equal((await pantry.setPantryItemActive(me, "básicos", "Sal", false)).status, "synced");
 const after = rows();
 assert.deepEqual(after.map(row => row.id), before.map(row => row.id));
 assert.deepEqual(after.map(row => [row.name, row.active, row.version]), [["Comino", true, 1], ["Sal", false, 2]]);
 assert.equal((await pantry.deletePantryItem(me, "especias", "Comino")).status, "synced");
 assert.deepEqual(rows().map(row => row.id), [before[1].id]);
 assert.equal(backend.state.calls.add, 0);
});

test("two devices changing different items keep both changes", async () => {
 account.insert("Sal", "básicos");
 account.insert("Pimienta", "especias");
 onDevice(devices[0]); await pantry.loadPantry(me);
 onDevice(devices[1]); await pantry.loadPantry(me);
 onDevice(devices[0]);
 const one = await pantry.setPantryItemActive(me, "básicos", "Sal", false);
 onDevice(devices[1]);
 const two = await pantry.addPantryItem(me, "especias", "Comino");
 const three = await pantry.setPantryItemActive(me, "especias", "Pimienta", false);
 assert.deepEqual([one.status, two.status, three.status], ["synced", "synced", "synced"]);
 assert.deepEqual(rows().map(row => [row.name, row.active]), [["Comino", true], ["Pimienta", false], ["Sal", false]]);
 onDevice(devices[0]);
 assert.deepEqual((await pantry.loadPantry(me)).data.map(item => [item.name, item.active]), [["Comino", true], ["Pimienta", false], ["Sal", false]]);
});

test("the same item changed on another device since it was read: refused, the account wins", async () => {
 account.insert("Sal", "básicos");
 await pantry.loadPantry(me);
 account.setActive("Sal", false);
 account.setActive("Sal", true);
 const result = await pantry.setPantryItemActive(me, "básicos", "Sal", false);
 assert.equal(result.status, "conflict");
 assert.equal(shown(result.items, "Sal").active, true);
 assert.equal(rows()[0].active, true);
 assert.equal(rows()[0].version, 3, "nothing written");
 assert.equal(scopeHasPendingChanges(me.scope), false);
});

test("an item deleted on another device: a change to it is dropped and the item disappears", async () => {
 account.insert("Sal", "básicos");
 account.insert("Comino", "especias");
 await pantry.loadPantry(me);
 account.remove("Sal");
 const result = await pantry.setPantryItemActive(me, "básicos", "Sal", false);
 assert.equal(result.status, "conflict");
 assert.deepEqual(names(result.items), ["Comino"]);
 assert.deepEqual(rows().map(row => row.name), ["Comino"]);
});

test("without connection a change stays on the device and is sent on the next load", async () => {
 account.insert("Sal", "básicos");
 await pantry.loadPantry(me);
 backend.state.down = true;
 const result = await pantry.setPantryItemActive(me, "básicos", "Sal", false);
 assert.equal(result.status, "pending");
 assert.equal(shown(result.items, "Sal").active, false, "the device shows the change");
 assert.equal(scopeHasPendingChanges(me.scope), true);
 const offline = await pantry.loadPantry(me);
 assert.deepEqual([offline.source, offline.offline, offline.pending], ["cache", true, true]);
 backend.state.down = false;
 const back = await pantry.loadPantry(me);
 assert.deepEqual([back.source, back.pending, back.discardedLocalChanges], ["remote", false, false]);
 assert.equal(rows()[0].active, false);
 assert.equal(scopeHasPendingChanges(me.scope), false);
});

test("a pending change of an item changed elsewhere meanwhile is discarded on reload (the account wins)", async () => {
 account.insert("Sal", "básicos");
 account.insert("Comino", "especias");
 await pantry.loadPantry(me);
 backend.state.down = true;
 await pantry.setPantryItemActive(me, "básicos", "Sal", false);
 await pantry.setPantryItemActive(me, "especias", "Comino", false);
 backend.state.down = false;
 account.setActive("Sal", true);
 const back = await pantry.loadPantry(me);
 assert.equal(back.discardedLocalChanges, true);
 assert.deepEqual(back.data.map(item => [item.name, item.active]), [["Comino", false], ["Sal", true]], "the other item's change is still sent");
 assert.deepEqual(rows().map(row => [row.name, row.active]), [["Comino", false], ["Sal", true]]);
});

test("a write whose answer is lost is sent again without effect: no duplicated row", async () => {
 await pantry.loadPantry(me);
 account.insert("Sal", "básicos");
 await pantry.loadPantry(me);
 backend.state.loseReplies = 1;
 const lost = await pantry.addPantryItem(me, "especias", "Comino");
 assert.equal(lost.status, "pending");
 assert.equal(rows().length, 2, "the add did arrive");
 const back = await pantry.loadPantry(me);
 assert.equal(back.pending, false);
 assert.deepEqual(rows().map(row => row.name), ["Comino", "Sal"]);
 backend.state.loseReplies = 1;
 assert.equal((await pantry.setPantryItemActive(me, "especias", "Comino", false)).status, "pending");
 assert.equal((await pantry.loadPantry(me)).discardedLocalChanges, false, "resending the same value is not a conflict");
 assert.equal(rows()[0].version, 2);
});

test("adding an item another device already added (other case and accents) reuses it", async () => {
 account.insert("Azafrán", "especias", false);
 await pantry.loadPantry(me);
 onDevice(devices[1]);
 backend.state.down = true;
 await pantry.loadPantry(me);
 const result = await pantry.addPantryItem(me, "especias", "  AZAFRAN ");
 assert.equal(result.status, "pending");
 backend.state.down = false;
 const back = await pantry.loadPantry(me);
 assert.equal(rows().length, 1);
 assert.deepEqual(back.data.map(item => [item.name, item.active]), [["Azafrán", false]]);
});

test("rows duplicated by the previous client show as one item; changing or deleting it covers every row", async () => {
 account.insert("Sal", "básicos", true);
 account.insert("Sal", "básicos", false);
 account.insert("Pimienta", "especias");
 const loaded = await pantry.loadPantry(me);
 assert.deepEqual(names(loaded.data), ["Pimienta", "Sal"]);
 assert.equal(shown(loaded.data, "Sal").active, true, "the oldest row names the item");
 await pantry.setPantryItemActive(me, "básicos", "Sal", false);
 assert.deepEqual(rows().filter(row => row.name === "Sal").map(row => row.active), [false, false]);
 await pantry.deletePantryItem(me, "básicos", "Sal");
 assert.deepEqual(rows().map(row => row.name), ["Pimienta"]);
});

test("rapid changes on one device are sent in order: the last one wins, no conflict with itself", async () => {
 account.insert("Sal", "básicos");
 await pantry.loadPantry(me);
 const results = await Promise.all([false, true, false].map(value => pantry.setPantryItemActive(me, "básicos", "Sal", value)));
 assert.ok(results.every(result => result.status === "synced"), JSON.stringify(results.map(result => result.status)));
 assert.equal(rows()[0].active, false);
 assert.equal(scopeHasPendingChanges(me.scope), false);
});

test("added and deleted without connection: nothing reaches the account", async () => {
 account.insert("Sal", "básicos");
 await pantry.loadPantry(me);
 backend.state.down = true;
 await pantry.addPantryItem(me, "otros", "Garbanzos");
 await pantry.deletePantryItem(me, "otros", "Garbanzos");
 assert.deepEqual(names(pantry.readPantryView(me)), ["Sal"]);
 backend.state.down = false;
 const back = await pantry.loadPantry(me);
 assert.deepEqual(names(back.data), ["Sal"]);
 assert.deepEqual(rows().map(row => row.name), ["Sal"]);
});

test("deleted and added again before it was sent: the item stays, in the pantry", async () => {
 account.insert("Sal", "básicos", false);
 await pantry.loadPantry(me);
 backend.state.down = true;
 await pantry.deletePantryItem(me, "básicos", "Sal");
 await pantry.addPantryItem(me, "básicos", "Sal");
 backend.state.down = false;
 await pantry.loadPantry(me);
 assert.deepEqual(rows().map(row => [row.name, row.active]), [["Sal", true]]);
});

test("nothing is declared empty while the account is unreachable", async () => {
 backend.state.down = true;
 const noCopy = await pantry.loadPantry(me);
 assert.deepEqual([noCopy.data, noCopy.source, noCopy.offline], [null, "cache", true]);
 backend.state.down = false;
 account.insert("Sal", "básicos");
 await pantry.loadPantry(me);
 backend.state.down = true;
 const withCopy = await pantry.loadPantry(me);
 assert.deepEqual([names(withCopy.data), withCopy.source], [["Sal"], "cache"]);
 assert.equal(backend.state.calls.add + backend.state.calls.remove + backend.state.calls.setActive, 0, "loading never writes");
});

test("a device copy saved before B7 with a change not sent: sent item by item if the account did not move", async () => {
 account.insert("Sal", "básicos");
 account.insert("Comino", "especias");
 const {version} = await backend.remote(A).fetch();
 writeScoped(me.scope, "pantry", [{name: "Sal", category: "básicos", active: false}, {name: "Orégano", category: "especias", active: true}], {remoteVersion: version, pending: true});
 const back = await pantry.loadPantry(me);
 assert.equal(back.discardedLocalChanges, false);
 assert.deepEqual(rows().map(row => [row.name, row.active]), [["Orégano", true], ["Sal", false]]);
 assert.equal(readEnvelope(me.scope, "pantry").pending, false);
});

test("a device copy saved before B7 based on an older account version is discarded (the account wins)", async () => {
 account.insert("Sal", "básicos");
 writeScoped(me.scope, "pantry", [{name: "Orégano", category: "especias", active: true}], {remoteVersion: "2026-10-01T00:00:00+00:00", pending: true});
 const back = await pantry.loadPantry(me);
 assert.equal(back.discardedLocalChanges, true);
 assert.deepEqual(names(back.data), ["Sal"]);
 assert.deepEqual(rows().map(row => row.name), ["Sal"]);
});

test("guests keep the pantry on the device and never call the account", async () => {
 const result = await pantry.setPantryItemActive(guest, "básicos", "Sal", false);
 assert.equal(result.status, "local");
 await pantry.addPantryItem(guest, "otros", "Garbanzos");
 await pantry.deletePantryItem(guest, "especias", "Pimienta");
 const loaded = await pantry.loadPantry(guest);
 assert.equal(loaded.source, "local");
 assert.deepEqual(names(loaded.data), ["Aceite de oliva", "Ajo en polvo", "Garbanzos", "Mostaza", "Sal", "Vinagre"]);
 assert.ok(loaded.data.every(item => !item.rows && !item.pending));
 assert.deepEqual(Object.values(backend.state.calls), [0, 0, 0, 0]);
});

test("legacy import adds the device pantry to an account without one, once", async () => {
 window.localStorage.setItem("becook-pantry-base", JSON.stringify(["sal", "mostaza"]));
 migrateLegacyStorage();
 const result = await importLegacyData(me);
 assert.deepEqual(result.imported, ["pantry"]);
 assert.deepEqual(rows().map(row => [row.name, row.active]), DEFAULTS.map(name => [name, ["Sal", "Mostaza"].includes(name)]).sort());
 assert.equal(backend.state.calls.add, 1);
});
