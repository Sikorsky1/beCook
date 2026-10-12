const {test, beforeEach, afterEach, mock} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {createDevice, useDevice} = require("./helpers/fake-browser.cjs");
const {createPantryBackend} = require("./helpers/fake-pantry.cjs");
const repos = require("../src/lib/data/repositories.ts");
const pantry = require("../src/lib/data/pantry.ts");
const storage = require("../src/lib/pantryStorage.ts");
const {scopeForUser} = require("../src/lib/storage/scoped-storage.ts");

// D5 (roadmap step 31): Despensa with explicit «Tengo / Se acabó», several basics added at once,
// a delete that can be undone for a few seconds, and the pantry actions of Compra («Se me acabó»
// on an item left out because it is usually at home, «Añadir a despensa» from a bought item).
// Synthetic account store (semantics of the B7 functions) and devices; no network.
const A = "00000000-0000-4000-8000-00000000000a";
const me = {scope: scopeForUser(A), userId: A};
const guest = {scope: "guest", userId: null};
const unusedRemote = {fetch: async () => ({data: null, version: null}), push: async () => ({version: null})};
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
// JSX <input> tags (attributes may hold arrow functions, so a tag ends at «/>»).
const inputs = (source) => source.split(/<input\b/).slice(1).map((chunk) => chunk.slice(0, chunk.search(/\/>/)));

let backend, account, restore;
const rows = () => account.rows().sort((a, b) => a.name.localeCompare(b.name));

beforeEach(() => {
 backend = createPantryBackend();
 account = backend.elsewhere(A);
 repos.configureRemotes({profile: () => unusedRemote, week: () => unusedRemote, shopping: () => null, pantry: (userId) => backend.remote(userId)});
 restore = useDevice(createDevice());
});
afterEach(() => {
 repos.configureRemotes(null);
 restore();
});

test("several basics are added in one request, each in its own category; those already there are not duplicated", async () => {
 account.insert("Sal", "básicos");
 await pantry.loadPantry(me);
 const result = await pantry.addPantryItems(me, [
  {name: "Arroz", category: "básicos"}, {name: "Comino", category: "especias"}, {name: "sal", category: "básicos"},
 ]);
 assert.equal(result.status, "synced");
 assert.equal(backend.state.calls.add, 1);
 assert.deepEqual(rows().map((row) => [row.name, row.category, row.active]), [["Arroz", "básicos", true], ["Comino", "especias", true], ["Sal", "básicos", true]]);
});

test("the basics catalogue offers only what the pantry does not have yet (accents and case ignored)", () => {
 const offered = storage.pantryBasicsToOffer([{name: "Aceite de Oliva", category: "aceites y vinagres", active: false}, {name: "sal", category: "básicos", active: true}]);
 const names = offered.map((item) => item.name);
 assert.ok(!names.includes("Aceite de oliva") && !names.includes("Sal"));
 assert.ok(names.includes("Arroz") && names.includes("Pimentón"));
 assert.ok(offered.every((item) => storage.pantryCategoryOrder.includes(item.category)));
 assert.equal(new Set(names).size, names.length);
});

test("Compra «Se me acabó»: the pantry item with that name (plurals ignored) is marked as used up", async () => {
 account.insert("Tomate", "otros");
 account.insert("Sal", "básicos");
 await pantry.loadPantry(me);
 const result = await pantry.markPantryItemUsedUp(me, "Tomates");
 assert.equal(result.status, "synced");
 assert.deepEqual(rows().map((row) => [row.name, row.active]), [["Sal", true], ["Tomate", false]]);
 assert.equal((await pantry.markPantryItemUsedUp(me, "Azafrán")).status, "missing");
});

test("Compra «Añadir a despensa»: a bought item is added (or marked as at home if it was used up)", async () => {
 account.insert("Arroz", "básicos", false);
 await pantry.loadPantry(me);
 assert.equal((await pantry.ensurePantryItemInStock(me, "arroz", "despensa")).status, "synced");
 assert.equal((await pantry.ensurePantryItemInStock(me, "Atún en lata", "despensa")).status, "synced");
 assert.equal((await pantry.ensurePantryItemInStock(me, "Guisantes", "congelados")).status, "synced");
 assert.deepEqual(rows().map((row) => [row.name, row.category, row.active]), [
  ["Arroz", "básicos", true], ["Atún en lata", "básicos", true], ["Guisantes", "congelados", true],
 ]);
 assert.equal(storage.pantryCategoryForShopping("frutería"), "otros");
});

test("guest: the same actions on this device only", async () => {
 const added = await pantry.addPantryItems(guest, [{name: "Arroz", category: "básicos"}]);
 assert.equal(added.status, "local");
 assert.equal((await pantry.markPantryItemUsedUp(guest, "arroz")).status, "local");
 assert.equal(pantry.readPantryView(guest).find((item) => item.name === "Arroz").active, false);
 assert.equal(backend.state.calls.add, 0);
});

test("a delete waits ~6 s and can be undone; leaving the page commits what is pending", () => {
 mock.timers.enable({apis: ["setTimeout"]});
 try {
  const committed = [];
  const changes = [];
  const deletes = pantry.createDeferredDeletes({delayMs: 6000, commit: (key) => committed.push(key), onChange: (keys) => changes.push(keys)});
  deletes.schedule("básicos:sal");
  deletes.schedule("especias:comino");
  assert.deepEqual(deletes.pending(), ["básicos:sal", "especias:comino"]);
  mock.timers.tick(3000);
  assert.equal(deletes.undo("básicos:sal"), true);
  mock.timers.tick(3000);
  assert.deepEqual(committed, ["especias:comino"]);
  deletes.schedule("otros:pan");
  deletes.flush();
  assert.deepEqual(committed, ["especias:comino", "otros:pan"]);
  mock.timers.tick(10000);
  assert.deepEqual(committed, ["especias:comino", "otros:pan"], "nothing twice");
  assert.equal(deletes.undo("otros:pan"), false, "too late to undo");
  assert.deepEqual(changes.at(-1), []);
 } finally {
  mock.timers.reset();
 }
});

test("Despensa: «Tengo / Se acabó» as explicit pressed buttons, multiple basics, undo of a delete", () => {
 const page = read("src/components/pages/PantryPage.tsx");
 const toggle = read("src/components/features/PantryStockToggle.tsx");
 const picker = read("src/components/features/PantryBasicsPicker.tsx");
 assert.ok(!page.includes("CheckboxItem"), "the pantry no longer uses a checkbox that means something else than in Compra");
 assert.match(toggle, /Tengo/);
 assert.match(toggle, /Se acabó/);
 assert.match(toggle, /aria-pressed=/);
 assert.match(toggle, /role="group"/);
 const checkboxes = inputs(picker).filter((input) => input.includes('type="checkbox"'));
 assert.ok(checkboxes.length > 0);
 for (const checkbox of checkboxes) assert.match(checkbox, /aria-label=|id=/);
 assert.match(page, /Deshacer/);
 assert.match(page, /role="status"/);
 for (const file of ["src/components/pages/PantryPage.tsx", "src/components/features/PantryStockToggle.tsx", "src/components/features/PantryBasicsPicker.tsx"]) {
  const source = read(file);
  assert.equal(source.match(/text-\[0\.(?:[0-6]\d*|7[0-4]\d*)rem\]/g), null, file);
  assert.equal(source.match(/\bmin-h-(?:9|10)\b/g), null, file);
 }
});

test("review UI: pending deletes are committed on pagehide; focus after delete, undo and adding basics; message by result", () => {
 const page = read("src/components/pages/PantryPage.tsx");
 const picker = read("src/components/features/PantryBasicsPicker.tsx");
 assert.match(page, /addEventListener\("pagehide", commitPending\)/);
 assert.match(page, /removeEventListener\("pagehide", commitPending\)/);
 assert.match(page, /data-pantry-key=\{pantryItemKey\(item\)\}/);
 assert.match(page, /undoDelete\(key, \{ focus: true \}\)/);
 assert.match(page, /requestAnimationFrame\(\(\) => target\?\.focus\(\)\)/);
 assert.match(page, /result\.status === "conflict"\s*\?\s*"Tu despensa había cambiado/);
 assert.match(picker, /toggleRef\.current\?\.focus\(\)/);
});
