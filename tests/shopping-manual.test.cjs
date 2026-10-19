const {test, beforeEach, afterEach} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// D5 (roadmap steps 30 and 31): items added by hand to the week's list (item_key «manual|…»,
// origins [{kind:"manual"}]) and quantities adjusted by the user (origin {kind:"user_adjust"}).
// Pure modules first (origins, diff), then the real data layer against an in-memory account with
// the semantics of edit_shopping_items and the trigger shopping_items_guard_manual
// (tests/helpers/fake-shopping.cjs), then the static markup of Compra.
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "synthetic-anon-key";
const {createDevice, useDevice} = require("./helpers/fake-browser.cjs");
const {createShoppingAccount} = require("./helpers/fake-shopping.cjs");
const {supabase} = require("../src/lib/supabase/client.ts");
const repos = require("../src/lib/data/repositories.ts");
const shopping = require("../src/lib/data/shopping.ts");
const units = require("../src/lib/shopping/units.ts");
const reconcile = require("../src/lib/shopping/reconcile.ts");
const {parseShoppingOrigins} = require("../src/lib/shoppingList.ts");
const {withWeekDates} = require("../src/lib/weekStorage.ts");

const A = "00000000-0000-4000-8000-00000000000a";
const asA = {scope: "u_" + A, userId: A};
const guest = {scope: "guest", userId: null};
const W41 = {isoYear: 2026, isoWeek: 41};
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const aiDishes = {
 Merluza: [{name: "merluza", quantity: 400, unit: "g", category: "pescadería"}, {name: "limón", quantity: 1, unit: "ud", category: "frutería"}],
 Tortilla: [{name: "huevos", quantity: 6, unit: "ud", category: "lácteos"}, {name: "patata", quantity: 500, unit: "g", category: "frutería"}],
 Garbanzos: [{name: "garbanzos", quantity: 400, unit: "g", category: "despensa"}, {name: "limón", quantity: 2, unit: "ud", category: "frutería"}],
 Pisto: [{name: "calabacín", quantity: 2, unit: "ud", category: "frutería"}, {name: "patata", quantity: 300, unit: "g", category: "frutería"}],
};
const day = (name, lunch, dinner = "LIBRE") => ({day: name, date: "", lunch, dinner});
const week = (monday = "Merluza", tuesday = "Tortilla") => withWeekDates([day("Lunes", "LIBRE", monday), day("Martes", tuesday)], W41);

// --- pure -------------------------------------------------------------------------------------

test("origins: manual and user_adjust entries are read; unknown kinds and malformed dish origins still dropped", () => {
 assert.deepEqual(parseShoppingOrigins([{kind: "manual", quantity: 2}]), [{kind: "manual", quantity: 2}]);
 assert.deepEqual(parseShoppingOrigins([{kind: "user_adjust", quantity: null}]), [{kind: "user_adjust", quantity: null}]);
 assert.deepEqual(parseShoppingOrigins([{kind: "otro"}, {kind: "manual", quantity: -1}, {day: 9, meal: "lunch", dish: "x", kind: "ai_title", quantity: 1}]), []);
 assert.equal(units.manualItemKey("  Papel de cocina "), "manual|papel de cocina");
 assert.equal(units.isManualKey("manual|leche"), true);
 assert.equal(units.isManualKey("lácteos|leche|volume"), false);
});

const existing = (id, name, quantity, unit, category, extra = {}) => ({id, name, quantity, unit, category, checked: false, itemKey: null, origins: null, removedAt: null, ...extra});
const desired = (name, quantity, unit, category, origins = []) => {
 const amount = units.normalizeAmount(quantity, unit);
 return {itemKey: units.shoppingItemKey(category, name, amount.dimension), name, quantity: amount.quantity, unit: amount.unit, category, origins};
};
const merluzaOrigin = {day: 0, meal: "dinner", dish: "merluza", kind: "ai_title", quantity: 400};

test("D5 defect: reconciling never removes or changes a manual item, bought or not", () => {
 const rows = [
  existing("m1", "Papel de cocina", 1, "ud", "otros", {itemKey: "manual|papel de cocina", origins: [{kind: "manual", quantity: 1}]}),
  existing("m2", "Leche", 2, "ud", "lácteos", {checked: true, itemKey: "manual|leche", origins: [{kind: "manual", quantity: 2}]}),
  existing("r1", "merluza", 400, "g", "pescadería", {itemKey: "pescadería|merluza|mass", origins: [merluzaOrigin]}),
 ];
 const ops = reconcile.diffShoppingList(rows, [desired("leche", 500, "ml", "lácteos")]);
 assert.deepEqual(ops.remove.map((op) => op.id), ["r1"]);
 assert.deepEqual(ops.update, []);
 assert.deepEqual(ops.add.map((op) => op.item_key), ["lácteos|leche|volume"], "the dishes' milk is its own line");
});

test("an adjusted quantity is kept while the dishes of that ingredient stay the same, and dropped (reported) when they change", () => {
 const adjusted = existing("r1", "merluza", 600, "g", "pescadería", {itemKey: "pescadería|merluza|mass", origins: [merluzaOrigin, {kind: "user_adjust", quantity: 600}]});
 const same = reconcile.diffShoppingList([adjusted], [desired("merluza", 400, "g", "pescadería", [merluzaOrigin])]);
 assert.equal(reconcile.isEmptyOps(same), true);
 const moreDishes = [merluzaOrigin, {day: 2, meal: "lunch", dish: "merluza", kind: "ai_title", quantity: 400}];
 const changed = reconcile.diffShoppingList([adjusted], [desired("merluza", 800, "g", "pescadería", moreDishes)]);
 assert.deepEqual(changed.update.map((op) => [op.id, op.quantity, op.origins.length]), [["r1", 800, 2]]);
 assert.deepEqual(reconcile.discardedAdjustments([adjusted], changed), ["merluza"]);
 assert.deepEqual(reconcile.discardedAdjustments([adjusted], same), []);
});

// --- data layer -------------------------------------------------------------------------------

let account, ai, restoreDevice, originalFetch, originalGetSession;
function newDevice() { restoreDevice?.(); restoreDevice = useDevice(createDevice()); }

beforeEach(() => {
 account = createShoppingAccount();
 repos.configureRemotes(account.remotes);
 shopping.forgetShoppingUpdateFailures();
 ai = {calls: 0};
 originalFetch = global.fetch;
 global.fetch = async (url, init) => {
  assert.equal(String(url), "/api/generate-shopping-list");
  ai.calls++;
  const body = JSON.parse(init.body);
  const dishes = body.week.flatMap((d) => ["lunch", "dinner"].filter((meal) => d[meal] !== "LIBRE")
   .map((meal) => ({day: d.day, meal, items: aiDishes[d[meal]] ?? [{name: d[meal].toLowerCase(), quantity: 1, unit: "ud", category: "otros"}]})));
  return Response.json({items: dishes.flatMap((d) => d.items), dishes});
 };
 originalGetSession = supabase.auth.getSession;
 supabase.auth.getSession = async () => ({data: {session: {access_token: "synthetic"}}, error: null});
 newDevice();
});

afterEach(() => {
 repos.configureRemotes(null);
 global.fetch = originalFetch;
 supabase.auth.getSession = originalGetSession;
 restoreDevice?.();
 restoreDevice = null;
});

const open = (days = week()) => shopping.ensureShoppingList(asA, W41, days);
const rows = () => account.listsOf(W41).at(-1).items;
const rowNamed = (name) => rows().find((item) => item.name === name);
const papel = {name: "Papel de cocina", quantity: 2, unit: "rollos", category: "otros"};

test("D5 defect: a manual item is added to the week's list with the client's id; resending it does not duplicate", async () => {
 account.writeWeek(W41, week());
 await open();
 const added = await shopping.addManualShoppingItem(asA, W41, papel, week());
 assert.equal(added.status, "synced");
 const row = rowNamed("Papel de cocina");
 assert.equal(row.itemKey, "manual|papel de cocina");
 assert.deepEqual(row.origins, [{kind: "manual", quantity: 2}]);
 assert.equal(row.quantity, 2);
 assert.equal(row.unit, "rollos");
 const line = added.view.items.find((item) => item.name === "Papel de cocina");
 assert.equal(line.manual, true);
 assert.equal(line.editable, true);
 assert.equal(account.listsOf(W41).length, 1);
 const again = await shopping.addManualShoppingItem(asA, W41, {...papel, name: "papel de cocina "}, week());
 assert.equal(again.status, "existing", "the same item is already in the list");
 assert.equal(rows().filter((item) => item.itemKey === "manual|papel de cocina").length, 1);
});

test("a manual item added offline stays on this device with its id and is sent once on the next load", async () => {
 account.writeWeek(W41, week());
 await open();
 account.st.down = true;
 const added = await shopping.addManualShoppingItem(asA, W41, papel, week());
 assert.equal(added.status, "pending");
 assert.ok(added.view.items.some((item) => item.name === "Papel de cocina"));
 assert.equal(added.view.pending, true);
 account.st.down = false;
 const loaded = await shopping.loadShoppingList(asA, W41, week());
 assert.equal(loaded.status, "ready");
 assert.equal(loaded.view.pending, false);
 assert.equal(rows().filter((item) => item.name === "Papel de cocina").length, 1);
 await shopping.loadShoppingList(asA, W41, week());
 assert.equal(account.st.calls.edit, 2, "one failed attempt, one accepted; nothing left to send");
});

test("a lost answer is harmless: the add is sent again with the same id and reported as duplicate", async () => {
 account.writeWeek(W41, week());
 await open();
 account.st.loseEditReplies = 1;
 assert.equal((await shopping.addManualShoppingItem(asA, W41, papel, week())).status, "pending");
 await shopping.loadShoppingList(asA, W41, week());
 assert.equal(rows().filter((item) => item.name === "Papel de cocina").length, 1);
});

test("marking a manual item added offline waits for the add (one queue per week)", async () => {
 account.writeWeek(W41, week());
 await open();
 account.st.down = true;
 const added = await shopping.addManualShoppingItem(asA, W41, papel, week());
 const id = added.view.items.find((item) => item.manual).id;
 assert.equal((await shopping.setShoppingItemChecked(asA, W41, id, true)).status, "pending");
 account.st.down = false;
 const loaded = await shopping.loadShoppingList(asA, W41, week());
 assert.equal(rowNamed("Papel de cocina").checked, true);
 assert.equal(loaded.view.discardedLocalChanges, false);
});

test("review H1: add, remove and add again the same item offline is sent in safe batches and ends with one row", async () => {
 account.writeWeek(W41, week());
 await open();
 account.st.down = true;
 const first = await shopping.addManualShoppingItem(asA, W41, {name: "Pan", quantity: 1, unit: "ud", category: "despensa"}, week());
 const panLine = first.view.items.find((item) => item.name === "Pan").id;
 await shopping.removeManualShoppingItem(asA, W41, panLine, week());
 const again = await shopping.addManualShoppingItem(asA, W41, {name: "Pan", quantity: 2, unit: "barras", category: "despensa"}, week());
 assert.equal(again.status, "pending");
 account.st.down = false;
 const loaded = await shopping.loadShoppingList(asA, W41, week());
 assert.equal(loaded.view.pending, false, "nothing stuck in the queue");
 assert.equal(loaded.view.discardedLocalChanges, false);
 const panes = rows().filter((item) => item.itemKey === "manual|pan");
 assert.equal(panes.length, 1);
 assert.equal(panes[0].unit, "barras");
 assert.equal(repos.readShoppingCache(asA, W41).pendingEdits.length, 0);
});

test("review H1: a batch the database refuses is dropped (not retried forever) and reported as discarded", async () => {
 account.writeWeek(W41, week());
 await open();
 account.st.rejectNextEdit = true;
 const refused = await shopping.addManualShoppingItem(asA, W41, papel, week());
 assert.equal(refused.status, "discarded");
 assert.equal(refused.view.discardedLocalChanges, true);
 assert.equal(refused.view.items.some((item) => item.name === "Papel de cocina"), false, "the device shows the account list");
 assert.equal(repos.readShoppingCache(asA, W41).pendingEdits.length, 0);
 assert.equal((await shopping.addManualShoppingItem(asA, W41, papel, week())).status, "synced", "later edits go through");
});

test("review H3: marking an item whose add is still pending keeps the mark pending (no server call) and sends it after the add", async () => {
 account.writeWeek(W41, week());
 await open();
 account.st.down = true;
 const added = await shopping.addManualShoppingItem(asA, W41, papel, week());
 account.st.down = false;
 const calls = account.st.calls.setChecked;
 const marked = await shopping.setShoppingItemChecked(asA, W41, added.view.items.find((item) => item.manual).id, true);
 assert.equal(marked.status, "pending");
 assert.equal(account.st.calls.setChecked, calls, "not sent before the item exists");
 const loaded = await shopping.loadShoppingList(asA, W41, week());
 assert.equal(rowNamed("Papel de cocina").checked, true);
 assert.equal(loaded.view.pending, false);
});

test("review H3: while the add cannot be sent, a load keeps its mark pending (not discarded)", async () => {
 account.writeWeek(W41, week());
 await open();
 account.st.down = true;
 const added = await shopping.addManualShoppingItem(asA, W41, papel, week());
 await shopping.setShoppingItemChecked(asA, W41, added.view.items.find((item) => item.manual).id, true);
 account.st.down = false;
 account.st.editUnavailable = true;
 const waiting = await shopping.loadShoppingList(asA, W41, week());
 assert.equal(waiting.view.discardedLocalChanges, false);
 assert.equal(waiting.view.pending, true);
 assert.ok(waiting.view.checkedItemIds.includes(added.view.items.find((item) => item.manual).id));
 account.st.editUnavailable = false;
 await shopping.loadShoppingList(asA, W41, week());
 assert.equal(rowNamed("Papel de cocina").checked, true);
});

test("review H2: an item added by hand is never hidden as «usually at home»", () => {
 const build = require("../src/lib/shopping/build.ts");
 const item = {id: "manual-manual|sal", name: "Sal", quantity: 1, unit: "ud", category: "despensa", origins: [], needsReview: false, removed: false, manual: true, adjusted: false, editable: true};
 assert.equal(build.classifyShoppingLine(item, false, build.pantryNameKeys(["sal"])), "to_buy");
 assert.equal(build.classifyShoppingLine({...item, manual: false}, false, build.pantryNameKeys(["sal"])), "pantry");
 assert.deepEqual(build.classifyShoppingView([item], [], ["sal"]).to_buy.map((entry) => entry.name), ["Sal"]);
});

test("D5 defect: changing the dishes keeps the manual items (bought or not) where they were", async () => {
 account.writeWeek(W41, week());
 await open();
 await shopping.addManualShoppingItem(asA, W41, papel, week());
 await shopping.addManualShoppingItem(asA, W41, {name: "Leche", quantity: 2, unit: "l", category: "lácteos"}, week());
 const leche = (await shopping.loadShoppingList(asA, W41, week())).view.items.find((item) => item.name === "Leche");
 await shopping.setShoppingItemChecked(asA, W41, leche.id, true);
 account.writeWeek(W41, week("Merluza", "Garbanzos"));
 const after = await open(week("Merluza", "Garbanzos"));
 assert.equal(after.status, "ready");
 assert.equal(account.listsOf(W41).length, 1);
 assert.ok(rowNamed("Papel de cocina"));
 assert.equal(rowNamed("Leche").checked, true);
 assert.equal(rowNamed("Leche").removedAt, null, "never «ya no hace falta»");
 assert.equal(rowNamed("huevos"), undefined, "the dish items that are no longer needed do go");
});

test("even against a database without the guard, the new client never asks to remove a manual item", async () => {
 account.st.guardManual = false;
 account.writeWeek(W41, week());
 await open();
 await shopping.addManualShoppingItem(asA, W41, papel, week());
 account.writeWeek(W41, week("Merluza", "Garbanzos"));
 await open(week("Merluza", "Garbanzos"));
 assert.ok(rowNamed("Papel de cocina"));
});

test("removing: only manual items; a dish item cannot be removed by hand", async () => {
 account.writeWeek(W41, week());
 const loaded = await open();
 const added = await shopping.addManualShoppingItem(asA, W41, papel, week());
 const manualId = added.view.items.find((item) => item.manual).id;
 const removed = await shopping.removeManualShoppingItem(asA, W41, manualId, week());
 assert.equal(removed.status, "synced");
 assert.equal(rowNamed("Papel de cocina"), undefined);
 assert.equal(removed.view.items.some((item) => item.name === "Papel de cocina"), false);
 const dishLine = loaded.view.items.find((item) => item.name === "merluza");
 assert.equal((await shopping.removeManualShoppingItem(asA, W41, dishLine.id, week())).status, "refused");
 assert.ok(rowNamed("merluza"));
});

test("editing a quantity: a manual item changes; a dish item records user_adjust and keeps it until its dishes change", async () => {
 account.writeWeek(W41, week());
 const loaded = await open();
 const added = await shopping.addManualShoppingItem(asA, W41, papel, week());
 const manualId = added.view.items.find((item) => item.manual).id;
 assert.equal((await shopping.setShoppingItemQuantity(asA, W41, manualId, 4, week(), "rollos")).status, "synced");
 assert.equal(rowNamed("Papel de cocina").quantity, 4);
 assert.deepEqual(rowNamed("Papel de cocina").origins, [{kind: "manual", quantity: 4}]);

 const merluza = loaded.view.items.find((item) => item.name === "merluza");
 const edited = await shopping.setShoppingItemQuantity(asA, W41, merluza.id, 600, week());
 assert.equal(edited.status, "synced");
 assert.equal(rowNamed("merluza").quantity, 600);
 assert.deepEqual(rowNamed("merluza").origins.at(-1), {kind: "user_adjust", quantity: 600});
 assert.equal(edited.view.items.find((item) => item.name === "merluza").adjusted, true);

 // Another dish changes (not the hake): the adjustment stays.
 account.writeWeek(W41, week("Merluza", "Pisto"));
 const other = await open(week("Merluza", "Pisto"));
 assert.equal(rowNamed("merluza").quantity, 600);
 assert.deepEqual(other.view.discardedAdjustments, []);

 // The hake's dishes change (now on two days): recomputed, the adjustment is dropped and reported.
 const twice = withWeekDates([day("Lunes", "Merluza", "Merluza"), day("Martes", "Pisto")], W41);
 account.writeWeek(W41, twice);
 const after = await open(twice);
 assert.equal(rowNamed("merluza").quantity, 800);
 assert.equal(rowNamed("merluza").origins.some((origin) => origin.kind === "user_adjust"), false);
 assert.deepEqual(after.view.discardedAdjustments, ["merluza"]);
});

test("fromCards counts only card origins (manual, adjusted and unknown kinds are not cards)", async () => {
 account.writeWeek(W41, week());
 await open();
 const added = await shopping.addManualShoppingItem(asA, W41, papel, week());
 assert.equal(added.view.fromCards, false);
 const merluza = added.view.items.find((item) => item.name === "merluza");
 const edited = await shopping.setShoppingItemQuantity(asA, W41, merluza.id, 500, week());
 assert.equal(edited.view.fromCards, false);
 // A device copy written by a newer client with a kind this one does not know.
 const cache = repos.readShoppingCache(asA, W41);
 repos.writeShoppingCache(asA, W41, {...cache, items: cache.items.map((item) => ({...item, origins: [{kind: "future_kind"}]}))});
 account.st.down = true;
 const offline = await shopping.loadShoppingList(asA, W41, week());
 assert.equal(offline.view.fromCards, false);
});

test("a manual item needs a list: without one nothing is added", async () => {
 account.writeWeek(W41, week());
 assert.equal((await shopping.addManualShoppingItem(asA, W41, papel, week())).status, "no_list");
});

test("guest: manual items and quantities live on this device only", async () => {
 newDevice();
 repos.writeShoppingCache(guest, W41, {weekSignature: "x", items: [{name: "pan", quantity: 1, unit: "ud", category: "despensa"}], checkedItemIds: []});
 const added = await shopping.addManualShoppingItem(guest, W41, papel, week());
 assert.equal(added.status, "local");
 assert.ok(added.view.items.some((item) => item.name === "Papel de cocina" && item.manual));
 const pan = added.view.items.find((item) => item.name === "pan");
 assert.equal((await shopping.setShoppingItemQuantity(guest, W41, pan.id, 3, week())).view.items.find((item) => item.name === "pan").quantity, 3);
 assert.equal(account.st.calls.edit, 0);
});

test("step 34 defect: the week's servings are shown right after generating the list, not only after reloading", async () => {
 account.writeWeek(W41, week(), {servings: 4, version: "fc1:x"});
 const generated = await open();
 assert.equal(generated.status, "ready");
 assert.equal(account.listsOf(W41).length, 1, "the list was generated now");
 assert.equal(generated.view.servings, 4);
 // Reading it again says the same.
 assert.equal((await open()).view.servings, 4);
});

// --- markup -----------------------------------------------------------------------------------

test("Compra: one continuous list with section anchors, the usual-at-home group folded, week and servings shown", () => {
 const page = read("src/components/pages/ShoppingListPage.tsx");
 const section = read("src/components/features/ShoppingSection.tsx");
 assert.ok(!page.includes("selectedCategory"), "no single-category view");
 assert.match(page, /aria-label="Secciones de la lista"/);
 // Section anchors land under the fixed header thanks to the page's scroll-padding (step 34).
 assert.match(section, /<section id=\{id\}/);
 assert.match(read("src/app/layout.tsx"), /has-\[\[data-sticky-header\]\]:scroll-pt-/);
 assert.match(page, /<details/);
 assert.match(page, /Ya lo tienes habitualmente/);
 assert.match(page, /comensales/);
 assert.match(page, /Se me acabó/);
 assert.match(section, /Añadir a despensa/);
});

// JSX tags of one kind (attributes may hold arrow functions, so a tag ends at «/>» or «</select>»).
const tags = (source, tag) => source.split(new RegExp(`<${tag}\\b`)).slice(1).map((chunk) => chunk.slice(0, chunk.search(tag === "select" ? /<\/select>/ : /\/>/)));

// The classes of a tag: inline, or a constant of the same file (className={fieldClass}).
const classesOf = (source, tag) => {
 const constant = tag.match(/className=\{(\w+)\}/);
 return constant ? (source.match(new RegExp(`const ${constant[1]} =\\s*"([^"]+)"`)) ?? [, ""])[1] : tag;
};

test("Compra: every checkbox has its own accessible name (not «on»), fields at 16px, targets of 44px", () => {
 let checkboxes = 0;
 for (const file of ["src/components/features/ShoppingSection.tsx", "src/components/features/ManualItemForm.tsx", "src/components/features/QuantityEditor.tsx"]) {
  const source = read(file);
  for (const input of tags(source, "input")) {
   if (input.includes('type="checkbox"')) {
    checkboxes++;
    assert.match(input, /aria-label=|aria-labelledby=/, file);
   } else assert.match(classesOf(source, input), /\btext-base\b/, `${file}: ${input}`);
  }
  for (const select of tags(source, "select")) assert.match(classesOf(source, select), /\btext-base\b/, `${file}: ${select}`);
  assert.equal(source.match(/text-\[0\.(?:[0-6]\d*|7[0-4]\d*)rem\]|text-\[1[01]px\]/g), null, file);
  assert.equal(source.match(/\bmin-h-(?:9|10)\b|\bh-(?:8|9|10)\b(?=[^"]*")/g), null, file);
 }
 assert.ok(checkboxes > 0);
 assert.ok(!read("src/components/pages/ShoppingListPage.tsx").includes("CheckboxItem"), "Compra no longer uses the shared row that announced «on»");
});

test("review UI: messages follow what the account did, focus is given back, names and errors are announced", () => {
 const page = read("src/components/pages/ShoppingListPage.tsx");
 const section = read("src/components/features/ShoppingSection.tsx");
 const editor = read("src/components/features/QuantityEditor.tsx");
 const form = read("src/components/features/ManualItemForm.tsx");
 // Quantity and removal messages go through the same switch as the add (never «done» when stale/pending).
 assert.match(page, /function editMessage\(status/);
 for (const status of ["pending", "stale", "discarded", "local"]) assert.match(page, new RegExp(`case "${status}"`));
 assert.equal((page.match(/editMessage\(result\.status/g) ?? []).length, 3);
 assert.match(page, /draft\.category === "congelados" \? "otros"/, "the message names the section where it is shown");
 // Focus: after «Quitar», saving or cancelling a quantity, closing the add form.
 assert.match(section, /focusTargetAfterRemoval\(event\.currentTarget\)/);
 assert.match(section, /<h2 id=\{`\$\{id\}-title`\} tabIndex=\{-1\}/);
 assert.match(editor, /triggerRef\.current\?\.focus\(\)/);
 assert.match(form, /openButtonRef\.current\?\.focus\(\)/);
 assert.match(section, /aria-label=\{`Añadir a despensa: \$\{name\}`\}/);
 assert.match(form, /aria-invalid=\{errorField === "quantity" \? true : undefined\}/);
 assert.match(form, /aria-describedby=\{errorField === "quantity" \?/);
});
