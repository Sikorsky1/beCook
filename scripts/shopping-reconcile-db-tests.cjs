// C4 (roadmap steps 19 and 20) against the real local Supabase (Auth + RLS + functions): the list
// comes from the dish cards, a dish change updates the same list in place keeping what was bought,
// the trigger covers marks of any client, reconcile_shopping_list's contract, and the rollout with
// the client deployed before C4 (tests/fixtures/legacy-shopping-client-6121e34.ts). Only the AI
// route is replaced by a fixed answer per dish. Scenario weeks live in 2036 and are removed after.
const assert = require("node:assert/strict");
const path = require("node:path");

const YEAR = 2036;
const CARD_TITLE = "Lentejas C4 prueba";
const AI = {
  merluza: [{ name: "merluza", quantity: 400, unit: "g", category: "pescadería" }, { name: "limón", quantity: 1, unit: "ud", category: "frutería" }],
  tortilla: [{ name: "huevos", quantity: 6, unit: "ud", category: "lácteos" }, { name: "patata", quantity: 500, unit: "g", category: "frutería" }],
  garbanzos: [{ name: "garbanzos", quantity: 400, unit: "g", category: "despensa" }, { name: "limón", quantity: 2, unit: "ud", category: "frutería" }],
  arroz: [{ name: "arroz", quantity: 300, unit: "g", category: "despensa" }, { name: "tomate", quantity: 4, unit: "ud", category: "frutería" }],
};
const lentejasCard = {
  baseServings: 2,
  totalMinutes: 45,
  ingredients: [
    { name: "lentejas", quantity: 200, unit: "g", category: "despensa", optional: false },
    { name: "zanahoria", quantity: 2, unit: "ud", category: "frutería", optional: false },
    { name: "chorizo", quantity: 100, unit: "g", category: "carnicería", optional: true },
  ],
  steps: ["Cocer las lentejas."],
  possibleAllergens: [],
};
const options = { auth: { persistSession: false, autoRefreshToken: false } };

// A fresh copy of the data layer behaves like another tab or device (own queues and generations).
function freshLayer() {
  for (const key of Object.keys(require.cache)) {
    if (/src[\\/]lib[\\/](data[\\/](repositories|sync|shopping)|supabase[\\/](weeks|shopping-lists|recipes))\.ts$/.test(key)) delete require.cache[key];
  }
  return { repos: require("../src/lib/data/repositories.ts"), shopping: require("../src/lib/data/shopping.ts") };
}

async function runShoppingReconcileTests({ check: baseCheck, sql, id, supabase, api, createClient, outcome }) {
  // C4_DEBUG=1 prints what was observed (synthetic rows only) when a scenario fails.
  let observed = null;
  const check = (name, fn) => baseCheck(name, () => {
    try { fn(); } catch (error) {
      if (process.env.C4_DEBUG) console.error("  observed:", JSON.stringify(observed), error.message.split("\n")[0]);
      throw error;
    }
  });
  const { createDevice, useDevice } = require(path.join(__dirname, "../tests/helpers/fake-browser.cjs"));
  const recipes = require("../src/lib/supabase/recipes.ts");
  const legacy = require("../tests/fixtures/legacy-shopping-client-6121e34.ts");
  const userA = id("0", 1);
  const userB = id("0", 2);
  const asA = { scope: "u_" + userA, userId: userA };
  const week = (n) => ({ isoYear: YEAR, isoWeek: n });
  const json = (statement) => JSON.parse(sql(statement).trim());
  const weekId = (n) => sql("SELECT id FROM public.weeks WHERE user_id='" + userA + "' AND iso_year=" + YEAR + " AND iso_week=" + n + ";").trim();
  const listsOf = (n) => json(
    "SELECT coalesce(json_agg(json_build_object('id',l.id,'basis',l.ingredient_basis,'reconciled',l.reconciled_at IS NOT NULL,'signature',l.week_signature," +
    "'items',(SELECT coalesce(json_agg(json_build_object('id',i.id,'name',i.name,'quantity',i.quantity,'unit',i.unit,'checked',i.checked,'key',i.item_key," +
    "'origins',i.origins,'bought',i.checked_quantity,'review',i.needs_review,'removed',i.removed_at IS NOT NULL) ORDER BY i.name),'[]') FROM public.shopping_items i WHERE i.shopping_list_id=l.id))" +
    " ORDER BY l.created_at, l.id),'[]') FROM public.shopping_lists l JOIN public.weeks w ON w.id=l.week_id" +
    " WHERE w.user_id='" + userA + "' AND w.iso_year=" + YEAR + " AND w.iso_week=" + n + ";");
  const item = (n, name) => listsOf(n).at(-1).items.find((row) => row.name === name);
  const cleanup = () => {
    sql("DELETE FROM public.weeks WHERE user_id IN ('" + userA + "','" + userB + "') AND iso_year=" + YEAR + ";");
    sql("DELETE FROM public.recipes WHERE owner_user_id='" + userA + "' AND title='" + CARD_TITLE + "';");
  };
  const restoreDevice = useDevice(createDevice());
  const newDevice = () => useDevice(createDevice());

  // The AI route answers per requested dish (breakdown) or with whole-week items (no breakdown).
  const realFetch = global.fetch;
  const aiBodies = [];
  global.fetch = async (input, init) => {
    if (String(input) === "/api/generate-shopping-list") {
      const body = JSON.parse(init.body);
      aiBodies.push(body);
      const dishes = body.week.flatMap((day) => ["lunch", "dinner"].filter((meal) => day[meal] !== "LIBRE")
        .map((meal) => ({ day: day.day, meal, items: AI[day[meal].toLowerCase()] ?? [{ name: day[meal].toLowerCase(), quantity: 1, unit: "ud", category: "otros" }] })));
      const items = dishes.flatMap((dish) => dish.items);
      return Response.json(body.breakdown ? { items, dishes } : { items });
    }
    return realFetch(input, init);
  };
  const planned = (body) => body.week.flatMap((day) => ["lunch", "dinner"].filter((meal) => day[meal] !== "LIBRE").map((meal) => day.day + " " + day[meal]));

  try {
    await supabase.auth.signOut({ scope: "local" });
    await supabase.auth.signInWithPassword({ email: "fixture-1@example.invalid", password: "Local-fixture-only-2026!" });
    cleanup();

    // 1. A dish with a card takes the card's ingredients (scaled); one AI call, only for the others.
    newDevice();
    let layer = freshLayer();
    const baseDays = [
      { day: "Lunes", date: "", lunch: CARD_TITLE, dinner: "Merluza" },
      { day: "Martes", date: "", lunch: "Tortilla", dinner: "LIBRE" },
    ];
    await layer.repos.saveWeek(asA, week(1), baseDays, { overwrite: true });
    const saved = await recipes.saveInferredRecipeInSupabase(supabase, { title: CARD_TITLE, card: lentejasCard, model: null, requestKey: crypto.randomUUID() });
    const loaded = await layer.repos.loadWeek(asA, week(1));
    await layer.repos.saveWeekRecipe(asA, week(1), loaded.data, { day: "Lunes", meal: "lunch" }, { versionId: saved.versionId });
    const days1 = (await layer.repos.loadWeek(asA, week(1))).data;
    const servings = Number(sql("SELECT coalesce((SELECT c.servings FROM public.week_food_contexts c WHERE c.week_id='" + weekId(1) + "'), 2);").trim());
    const first = await layer.shopping.ensureShoppingList(asA, week(1), days1);
    const afterFirst = listsOf(1);
    observed = { status: first.status, ai: aiBodies.map(planned), servings, lists: afterFirst.length };
    check("C4 shopping: a dish with a card takes its ingredients from the card (scaled, optional left out); AI once, only for dishes without a card", () => {
      assert.equal(first.status, "ready");
      assert.equal(aiBodies.length, 1);
      assert.equal(aiBodies[0].breakdown, true);
      assert.deepEqual(planned(aiBodies[0]), ["Lunes Merluza", "Martes Tortilla"]);
      assert.equal(afterFirst.length, 1);
      assert.equal(afterFirst[0].basis, "mixed-v1");
      assert.equal(Number(item(1, "lentejas").quantity), 200 * servings / 2);
      assert.equal(item(1, "lentejas").key, "despensa|lenteja|mass");
      assert.equal(item(1, "lentejas").origins[0].kind, "card_inferred");
      assert.equal(item(1, "lentejas").origins[0].versionId, saved.versionId);
      assert.equal(item(1, "chorizo"), undefined);
      assert.equal(item(1, "merluza").origins[0].kind, "ai_title");
    });

    // 2. Mark two items, change one dish: the same list is updated, marks stay, AI only for the new dish.
    const visible = (name) => first.view.items.find((entry) => entry.name === name).id;
    await layer.shopping.setShoppingItemChecked(asA, week(1), visible("huevos"), true);
    await layer.shopping.setShoppingItemChecked(asA, week(1), visible("lentejas"), true);
    const marked = listsOf(1)[0];
    const edited = days1.map((day) => (day.day === "Martes" ? { ...day, lunch: "Garbanzos" } : day));
    await layer.repos.saveWeekSlot(asA, week(1), edited, { day: "Martes", meal: "lunch" });
    const editedDays = (await layer.repos.loadWeek(asA, week(1))).data;
    const updated = await freshLayer().shopping.ensureShoppingList(asA, week(1), editedDays);
    const afterEdit = listsOf(1);
    observed = { status: updated.status, change: updated.view?.change, ai: aiBodies.map(planned), lists: afterEdit.map((l) => l.items.map((i) => [i.name, i.checked, i.removed])) };
    check("C4 shopping: changing a dish updates the same list in place; marks kept; AI only for the new dish", () => {
      assert.equal(updated.status, "ready");
      assert.equal(afterEdit.length, 1, "no new list");
      assert.equal(afterEdit[0].id, marked.id);
      assert.equal(afterEdit[0].reconciled, true);
      assert.equal(aiBodies.length, 2);
      assert.deepEqual(planned(aiBodies[1]), ["Martes Garbanzos"]);
      assert.equal(item(1, "lentejas").checked, true);
      assert.equal(item(1, "huevos").checked, true);
      assert.equal(item(1, "huevos").removed, true, "bought for the removed dish: «Comprado, ya no hace falta»");
      assert.equal(item(1, "patata"), undefined, "not bought, no longer needed: removed");
      assert.ok(item(1, "garbanzos"));
      assert.equal(Number(item(1, "limón").quantity), 3);
      assert.deepEqual(updated.view.change, { added: 1, removed: 1, keptBought: 1, changed: 1, review: 0 });
    });

    // 3. The trigger covers marks of the deployed client (set_shopping_items_checked untouched).
    sql("UPDATE public.shopping_items SET needs_review=true WHERE id='" + item(1, "limón").id + "';");
    const legacyMark = await legacy.setShoppingItemsCheckedInSupabase([item(1, "limón").id], true);
    const afterMark = item(1, "limón");
    await legacy.setShoppingItemsCheckedInSupabase([item(1, "limón").id], false);
    const afterUnmark = item(1, "limón");
    observed = { legacyMark, afterMark, afterUnmark };
    check("C4 trigger: a mark from any client records what was bought and settles a review; unmarking clears it", () => {
      assert.equal(legacyMark.status, "applied");
      assert.equal(afterMark.checked, true);
      assert.equal(Number(afterMark.bought), 3);
      assert.equal(afterMark.review, false);
      assert.equal(afterUnmark.bought, null);
    });

    // 4. reconcile_shopping_list contract through the application adapter.
    const { reconcileShoppingListInSupabase, saveShoppingListInSupabase } = require("../src/lib/supabase/shopping-lists.ts");
    const list1 = listsOf(1)[0];
    const call = (overrides = {}) => reconcileShoppingListInSupabase({
      isoYear: YEAR, isoWeek: 1, listId: list1.id, fromSignature: list1.signature, toSignature: list1.signature,
      ops: { add: [], update: [], remove: [] }, expectedWeekVersion: null, ...overrides,
    });
    const op = (name, quantity, unit, category, key) => ({ name, quantity, unit, category, item_key: key, origins: [] });
    const stale = await call({ fromSignature: "shop1:other", toSignature: "shop1:another" });
    const staleList = await call({ listId: id("4", 1) });
    const changedWeek = await call({ expectedWeekVersion: 0 });
    const existing = await call({ fromSignature: "shop1:older" });
    const invalidTaste = await call({ ops: { add: [op("sal", null, "g", "despensa", "despensa|sal|taste")], update: [], remove: [] } }).catch((error) => error.message);
    const duplicateKey = await call({ ops: { add: [op("sal", 1, "ud", "despensa", "k"), op("sal", 2, "ud", "despensa", "k")], update: [], remove: [] } }).catch((error) => error.message);
    const foreignItem = await call({ ops: { add: [], update: [], remove: [{ id: "50000000-0000-4000-8000-000000000011" }] } });
    observed = { stale: stale.status, staleList: staleList.status, changedWeek: changedWeek.status, existing: existing.status, invalidTaste, duplicateKey, foreignItem: foreignItem.status };
    check("C4 reconcile: stale signature or list, moved week, list already updated, invalid items and items of another list write nothing", () => {
      assert.equal(stale.status, "stale");
      assert.equal(staleList.status, "stale");
      assert.equal(changedWeek.status, "week_changed");
      assert.equal(existing.status, "existing", "another device already brought it to this signature");
      assert.match(invalidTaste, /invalid item/);
      assert.match(duplicateKey, /invalid item/);
      assert.equal(foreignItem.status, "stale");
      assert.deepEqual(listsOf(1)[0], list1);
    });

    // Bought vs needed compares base units: 1 kg bought covers 800 g, not 1200 g.
    const legacyRow = json("WITH r AS (INSERT INTO public.shopping_items (shopping_list_id,name,quantity,unit,category,checked) VALUES ('" + list1.id + "','arroz',1,'kg','despensa',false) RETURNING id) SELECT json_build_object('id', id) FROM r;").id;
    await legacy.setShoppingItemsCheckedInSupabase([legacyRow], true);
    const lower = await call({ ops: { add: [], update: [{ id: legacyRow, ...op("arroz", 800, "g", "despensa", "despensa|arroz|mass") }], remove: [] } });
    const reviewAfterLower = item(1, "arroz").review;
    const higher = await call({ ops: { add: [], update: [{ id: legacyRow, ...op("arroz", 1200, "g", "despensa", "despensa|arroz|mass") }], remove: [] } });
    const reviewAfterHigher = item(1, "arroz").review;
    const removeBought = await call({ ops: { add: [{ ...op("sal", null, "al gusto", "despensa", "despensa|sal|taste") }], update: [], remove: [{ id: legacyRow }] } });
    const afterRemove = listsOf(1)[0];
    observed = { lower: lower.status, reviewAfterLower, higher: higher.status, higherSummary: higher.summary, reviewAfterHigher, removeBought: removeBought.summary };
    check("C4 reconcile: a bought item that now needs more is to review (kg vs g compared); removed bought items stay; «al gusto» rows accepted", () => {
      assert.equal(lower.status, "applied");
      assert.equal(reviewAfterLower, false, "1 kg bought covers 800 g");
      assert.equal(higher.summary.review, 1);
      assert.equal(reviewAfterHigher, true);
      assert.deepEqual(removeBought.summary, { added: 1, removed: 0, keptBought: 1, changed: 0, review: 0 });
      assert.equal(afterRemove.items.find((row) => row.name === "arroz").removed, true);
      assert.equal(afterRemove.items.find((row) => row.name === "sal").quantity, null);
      assert.equal(afterRemove.items.find((row) => row.name === "sal").unit, "al gusto");
    });

    // A row marked before C4 (no checked_quantity): what it had then is kept as bought, so a lower
    // and then equal amount is never a false «Revisar»; 1 kg → 1000 g is not a change. A key already
    // taken by an active row (two devices adding at once) → stale, nothing written.
    const preC4 = json("WITH r AS (INSERT INTO public.shopping_items (shopping_list_id,name,quantity,unit,category,checked) VALUES ('" + list1.id + "','avena',1,'kg','despensa',true) RETURNING id) SELECT json_build_object('id', id) FROM r;").id;
    const same = await call({ ops: { add: [], update: [{ id: preC4, ...op("avena", 1000, "g", "despensa", "despensa|avena|mass") }], remove: [] } });
    const down = await call({ ops: { add: [], update: [{ id: preC4, ...op("avena", 800, "g", "despensa", "despensa|avena|mass") }], remove: [] } });
    const backUp = await call({ ops: { add: [], update: [{ id: preC4, ...op("avena", 1000, "g", "despensa", "despensa|avena|mass") }], remove: [] } });
    const avena = item(1, "avena");
    const beforeTaken = JSON.stringify(listsOf(1));
    const taken = await call({ ops: { add: [op("avena", 5, "g", "despensa", "despensa|avena|mass")], update: [], remove: [{ id: item(1, "garbanzos").id }] } });
    const afterTaken = JSON.stringify(listsOf(1));
    observed = { same: same.summary, down: down.summary, backUp: backUp.summary, avena, taken: taken.status };
    check("C4 reconcile: a row marked before C4 keeps what was bought (no false review); kg ↔ g is not a change; a taken key is stale and writes nothing", () => {
      assert.equal(same.summary.changed, 0, "1 kg → 1000 g");
      assert.equal(Number(avena.bought), 1000);
      assert.equal(backUp.summary.review, 0, "1000 g needed, 1 kg bought");
      assert.equal(avena.review, false);
      assert.equal(taken.status, "stale");
      assert.equal(afterTaken, beforeTaken, "the remove before the failed add was undone too");
    });

    // Unique active key per list; permissions.
    const duplicateRow = outcome(1, "INSERT INTO public.shopping_items (shopping_list_id,name,quantity,unit,category,item_key) VALUES ('" + list1.id + "','lentejas',1,'g','despensa','despensa|lenteja|mass')");
    const otherUser = createClient(api.url, api.key, options);
    await otherUser.auth.signInWithPassword({ email: "fixture-2@example.invalid", password: "Local-fixture-only-2026!" });
    const foreign = await otherUser.rpc("reconcile_shopping_list", { p_iso_year: YEAR, p_iso_week: 1, p_list_id: list1.id, p_from_signature: list1.signature, p_to_signature: "shop1:x", p_ops: { remove: [{ id: item(1, "garbanzos").id }] } });
    const foreignDiscard = await otherUser.rpc("shopping_items_discard_unbought", { p_list_id: list1.id, p_item_ids: [item(1, "garbanzos").id] });
    await otherUser.auth.signOut({ scope: "local" });
    const anon = createClient(api.url, api.key, options);
    const anonCall = await anon.rpc("reconcile_shopping_list", { p_iso_year: YEAR, p_iso_week: 1, p_list_id: list1.id, p_from_signature: null, p_to_signature: "shop1:x", p_ops: {} });
    const anonDiscard = await anon.rpc("shopping_items_discard_unbought", { p_list_id: list1.id, p_item_ids: [item(1, "garbanzos").id] });
    observed = { duplicateRow, foreign: foreign.data ?? foreign.error?.code, foreignDiscard: foreignDiscard.data ?? foreignDiscard.error?.code, anonCall: anonCall.error?.code, anonDiscard: anonDiscard.error?.code };
    check("C4 reconcile: one active row per key; another user cannot update or remove this user's items; anon cannot call the functions", () => {
      assert.equal(duplicateRow, "constraint:23505");
      assert.equal(foreign.error, null);
      assert.equal(foreign.data.status, "no_week");
      assert.equal(foreignDiscard.error, null);
      assert.equal(foreignDiscard.data, 0, "RLS: nothing visible, nothing removed");
      assert.equal(anonCall.error?.code, "42501");
      assert.equal(anonDiscard.error?.code, "42501");
      assert.ok(item(1, "garbanzos"));
    });

    // 5. save_shopping_list: same signature, optional keys and origins, «al gusto» only with that unit.
    await freshLayer().repos.saveWeek(asA, week(5), [{ day: "Lunes", date: "", lunch: "Arroz", dinner: "LIBRE" }], { overwrite: true });
    const plain = await saveShoppingListInSupabase({ isoYear: YEAR, isoWeek: 5, weekSignature: "shop1:c4-plain", expectedWeekVersion: null,
      items: [{ name: "arroz", quantity: 300, unit: "g", category: "despensa" }] });
    const badTaste = await saveShoppingListInSupabase({ isoYear: YEAR, isoWeek: 5, weekSignature: "shop1:c4-bad", expectedWeekVersion: null,
      items: [{ name: "sal", quantity: null, unit: "g", category: "despensa" }] }).catch((error) => error.message);
    const keyed = await saveShoppingListInSupabase({ isoYear: YEAR, isoWeek: 5, weekSignature: "shop1:c4-keyed", expectedWeekVersion: null,
      items: [{ name: "sal", quantity: null, unit: "al gusto", category: "despensa", itemKey: "despensa|sal|taste", origins: [{ day: 0, meal: "lunch", dish: "arroz", kind: "ai_title", quantity: null }] }] });
    const lists5 = listsOf(5);
    observed = { keyed: keyed.status, badTaste, plain: plain.status, lists5: lists5.map((l) => l.basis) };
    check("C4 save_shopping_list: keys and origins stored (basis mixed-v1), «al gusto» only with that unit, plain lists as before", () => {
      assert.equal(keyed.status, "created");
      assert.equal(keyed.list.items[0].quantity, null);
      assert.equal(keyed.list.items[0].itemKey, "despensa|sal|taste");
      assert.match(badTaste, /invalid item/);
      assert.equal(plain.status, "created");
      assert.deepEqual(lists5.map((l) => l.basis), [null, "mixed-v1"]);
    });

    // 6. Two devices updating the same list at once: one update, the other sees it done.
    newDevice();
    layer = freshLayer();
    await layer.repos.saveWeek(asA, week(6), [{ day: "Lunes", date: "", lunch: "Arroz", dinner: "Merluza" }], { overwrite: true });
    await layer.shopping.ensureShoppingList(asA, week(6), (await layer.repos.loadWeek(asA, week(6))).data);
    const changedDays = [{ day: "Lunes", date: "", lunch: "Arroz", dinner: "Tortilla" }];
    await layer.repos.saveWeek(asA, week(6), changedDays, { overwrite: true });
    const aiBefore = aiBodies.length;
    const [one, two] = await Promise.all([1, 2].map(() => { newDevice(); return freshLayer().shopping.ensureShoppingList(asA, week(6), changedDays); }));
    const lists6 = listsOf(6);
    observed = { statuses: [one.status, two.status], lists: lists6.length, items: lists6[0]?.items.map((i) => i.name), ai: aiBodies.length - aiBefore };
    check("C4 reconcile: two devices updating the same list at once → one list, no duplicated items", () => {
      assert.deepEqual([one.status, two.status], ["ready", "ready"]);
      assert.equal(lists6.length, 1);
      const names = lists6[0].items.map((i) => i.name);
      assert.equal(new Set(names).size, names.length);
      assert.ok(names.includes("huevos") && !names.includes("merluza"));
      assert.deepEqual(one.view.items.map((i) => i.id).sort(), two.view.items.map((i) => i.id).sort());
    });

    // 7. Rollout: migration applied while the previous client (6121e34) is still served.
    newDevice();
    layer = freshLayer();
    const rolloutDays = [{ day: "Lunes", date: "", lunch: "Arroz", dinner: "Merluza" }];
    await layer.repos.saveWeek(asA, week(7), rolloutDays, { overwrite: true });
    const { getShoppingSignature } = require("../src/lib/shoppingListStorage.ts");
    const context = json("SELECT coalesce((SELECT json_build_object('servings',servings,'version',context_version) FROM public.week_food_contexts WHERE week_id='" + weekId(7) + "'),'null');");
    const legacySignature = getShoppingSignature(week(7), rolloutDays, context);
    const legacyErrors = [];
    const attempt = async (fn) => { try { return await fn(); } catch (error) { legacyErrors.push(error.message); return null; } };
    const legacySave = await attempt(() => legacy.saveShoppingListInSupabase({ isoYear: YEAR, isoWeek: 7, weekSignature: legacySignature, expectedWeekVersion: null,
      items: [...AI.arroz, ...AI.merluza] }));
    const legacyMarked = await attempt(() => legacy.setShoppingItemsCheckedInSupabase([legacySave.list.items.find((i) => i.name === "tomate").id], true));
    const legacyRead = await attempt(() => legacy.getLatestShoppingListForWeekFromSupabase(weekId(7)));
    const aiBeforeRollout = aiBodies.length;
    const adopted = await layer.shopping.ensureShoppingList(asA, week(7), (await layer.repos.loadWeek(asA, week(7))).data);
    const aiAfterAdopt = aiBodies.length - aiBeforeRollout;
    const rolloutEdited = [{ day: "Lunes", date: "", lunch: "Arroz", dinner: "Tortilla" }];
    await layer.repos.saveWeek(asA, week(7), rolloutEdited, { overwrite: true });
    const reconciled = await freshLayer().shopping.ensureShoppingList(asA, week(7), rolloutEdited);
    const legacyAfter = await attempt(() => legacy.getLatestShoppingListForWeekFromSupabase(weekId(7)));
    const lists7 = listsOf(7);
    observed = { legacyErrors, legacyMarked, adopted: adopted.status, aiAfterAdopt, reconciled: reconciled.status, ai: aiBodies.slice(aiBeforeRollout).map(planned), lists: lists7.length };
    check("C4 rollout: the previous client (6121e34) still saves, marks and reads lists after the migration", () => {
      assert.deepEqual(legacyErrors, []);
      assert.equal(legacySave.status, "created");
      assert.equal(legacyMarked.status, "applied");
      assert.equal(legacyRead.items.filter((i) => i.checked).length, 1);
      assert.equal(lists7[0].basis ?? null, "mixed-v1", "same signature: the new client reconciled its list, it did not make another");
    });
    check("C4 rollout: the new client reuses that list without AI, then updates it in place keeping its marks (one AI call for all dishes)", () => {
      assert.equal(adopted.status, "ready");
      assert.equal(aiAfterAdopt, 0);
      assert.equal(reconciled.status, "ready");
      assert.equal(lists7.length, 1);
      assert.deepEqual(aiBodies.slice(aiBeforeRollout).map(planned), [["Lunes Arroz", "Lunes Tortilla"]]);
      const tomate = lists7[0].items.find((i) => i.name === "tomate");
      assert.equal(tomate.checked, true);
      assert.equal(tomate.key, "frutería|tomate|count");
      assert.equal(lists7[0].items.find((i) => i.name === "merluza"), undefined);
      assert.equal(legacyAfter.items.find((i) => i.name === "tomate").checked, true, "the previous client reads the updated list");
    });

    // Known limit (documented in the expectations): a list with «al gusto» rows written by the new
    // client cannot be read by a tab still running the previous client.
    const legacyTaste = await legacy.getLatestShoppingListForWeekFromSupabase(weekId(5)).then(() => "read", (error) => error.message);
    check("C4 rollout (known limit): the previous client cannot read a list with «al gusto» rows", () => {
      assert.match(legacyTaste, /shopping_items\.quantity/);
    });
  } finally {
    global.fetch = realFetch;
    cleanup();
    restoreDevice();
    freshLayer();
  }
}

module.exports = { runShoppingReconcileTests };
