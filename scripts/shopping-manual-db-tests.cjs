// D5 (roadmap steps 30 and 31) against the real local Supabase (Auth + RLS + functions): items added
// by hand to the week's list and quantities changed by the user (edit_shopping_items), the trigger
// shopping_items_guard_manual (no other path removes or changes an item added by hand; cascades
// still work), the new client's reconciliation keeping them, and the rollout with the client
// deployed before D5 (tests/fixtures/legacy-shopping-client-f810818.ts and its diff). Only the AI
// route is replaced by a fixed answer per dish. Scenario weeks live in 2037 and are removed after.
const assert = require("node:assert/strict");
const path = require("node:path");
const { AsyncLocalStorage } = require("node:async_hooks");

const YEAR = 2037;
const AI = {
  merluza: [{ name: "merluza", quantity: 400, unit: "g", category: "pescadería" }, { name: "limón", quantity: 1, unit: "ud", category: "frutería" }],
  tortilla: [{ name: "huevos", quantity: 6, unit: "ud", category: "lácteos" }, { name: "patata", quantity: 500, unit: "g", category: "frutería" }],
  garbanzos: [{ name: "garbanzos", quantity: 400, unit: "g", category: "despensa" }, { name: "limón", quantity: 2, unit: "ud", category: "frutería" }],
  arroz: [{ name: "arroz", quantity: 300, unit: "g", category: "despensa" }, { name: "tomate", quantity: 4, unit: "ud", category: "frutería" }],
  pisto: [{ name: "calabacín", quantity: 2, unit: "ud", category: "frutería" }],
};
const options = { auth: { persistSession: false, autoRefreshToken: false } };

// A fresh copy of the data layer behaves like another tab or device (own queues and generations).
function freshLayer() {
  for (const key of Object.keys(require.cache)) {
    if (/src[\\/]lib[\\/](data[\\/](repositories|sync|shopping)|supabase[\\/](weeks|shopping-lists|recipes))\.ts$/.test(key)) delete require.cache[key];
  }
  return { repos: require("../src/lib/data/repositories.ts"), shopping: require("../src/lib/data/shopping.ts") };
}

async function runShoppingManualTests({ check: baseCheck, sql, id, supabase, api, createClient, outcome }) {
  // D5_DEBUG=1 prints what was observed (synthetic rows only) when a scenario fails.
  let observed = null;
  const check = (name, fn) => baseCheck(name, () => {
    try { fn(); } catch (error) {
      if (process.env.D5_DEBUG) console.error("  observed:", JSON.stringify(observed), error.message.split("\n")[0]);
      throw error;
    }
  });
  const { createDevice, useDevice } = require(path.join(__dirname, "../tests/helpers/fake-browser.cjs"));
  const legacy = require("../tests/fixtures/legacy-shopping-client-f810818.ts");
  const legacyDiff = require("../tests/fixtures/legacy-shopping-reconcile-f810818.ts");
  const build = require("../src/lib/shopping/build.ts");
  const { getShoppingSignature } = require("../src/lib/shoppingListStorage.ts");
  const userA = id("0", 1);
  const userB = id("0", 2);
  const asA = { scope: "u_" + userA, userId: userA };
  const week = (n) => ({ isoYear: YEAR, isoWeek: n });
  const json = (statement) => JSON.parse(sql(statement).trim());
  const weekId = (n) => sql("SELECT id FROM public.weeks WHERE user_id='" + userA + "' AND iso_year=" + YEAR + " AND iso_week=" + n + ";").trim();
  const listsOf = (n) => json(
    "SELECT coalesce(json_agg(json_build_object('id',l.id,'basis',l.ingredient_basis,'signature',l.week_signature,'reconciled',l.reconciled_at," +
    "'items',(SELECT coalesce(json_agg(json_build_object('id',i.id,'name',i.name,'quantity',i.quantity,'unit',i.unit,'category',i.category,'checked',i.checked," +
    "'key',i.item_key,'origins',i.origins,'bought',i.checked_quantity,'review',i.needs_review,'removed',i.removed_at IS NOT NULL) ORDER BY i.name),'[]')" +
    " FROM public.shopping_items i WHERE i.shopping_list_id=l.id)) ORDER BY l.created_at, l.id),'[]') FROM public.shopping_lists l JOIN public.weeks w ON w.id=l.week_id" +
    " WHERE w.user_id='" + userA + "' AND w.iso_year=" + YEAR + " AND w.iso_week=" + n + ";");
  const item = (n, name) => listsOf(n).at(-1).items.find((row) => row.name === name);
  const cleanup = () => sql("DELETE FROM public.weeks WHERE user_id IN ('" + userA + "','" + userB + "') AND iso_year=" + YEAR + ";");
  const restoreDevice = useDevice(createDevice());
  const newDevice = () => useDevice(createDevice());

  const realFetch = global.fetch;
  global.fetch = async (input, init) => {
    if (String(input) === "/api/generate-shopping-list") {
      const body = JSON.parse(init.body);
      const dishes = body.week.flatMap((day) => ["lunch", "dinner"].filter((meal) => day[meal] !== "LIBRE")
        .map((meal) => ({ day: day.day, meal, items: AI[day[meal].toLowerCase()] ?? [{ name: day[meal].toLowerCase(), quantity: 1, unit: "ud", category: "otros" }] })));
      return Response.json({ items: dishes.flatMap((dish) => dish.items), dishes });
    }
    return realFetch(input, init);
  };
  const papel = { name: "Papel de cocina", quantity: 2, unit: "rollos", category: "otros" };

  try {
    await supabase.auth.signOut({ scope: "local" });
    await supabase.auth.signInWithPassword({ email: "fixture-1@example.invalid", password: "Local-fixture-only-2026!" });
    cleanup();
    const { editShoppingItemsInSupabase } = require("../src/lib/supabase/shopping-lists.ts");

    // 1. Items added by hand through the application: client id, manual key and origin; resend and
    // a second item with the same name write nothing more; the list's signature and basis stay.
    newDevice();
    let layer = freshLayer();
    const days1 = [{ day: "Lunes", date: "", lunch: "Arroz", dinner: "Merluza" }, { day: "Martes", date: "", lunch: "Tortilla", dinner: "LIBRE" }];
    await layer.repos.saveWeek(asA, week(1), days1, { overwrite: true });
    const first = await layer.shopping.ensureShoppingList(asA, week(1), days1);
    const before = listsOf(1)[0];
    const added = await layer.shopping.addManualShoppingItem(asA, week(1), papel, days1);
    const manual = item(1, "Papel de cocina");
    const resend = await editShoppingItemsInSupabase({ isoYear: YEAR, isoWeek: 1, listId: before.id,
      ops: { add: [{ id: manual.id, name: "Papel de cocina", quantity: 2, unit: "rollos", category: "otros", item_key: "manual|papel de cocina" }], set_quantity: [], remove: [] } });
    const sameName = await editShoppingItemsInSupabase({ isoYear: YEAR, isoWeek: 1, listId: before.id,
      ops: { add: [{ id: crypto.randomUUID(), name: "papel de cocina", quantity: 1, unit: "ud", category: "otros", item_key: "manual|papel de cocina" }], set_quantity: [], remove: [] } });
    const afterAdd = listsOf(1);
    observed = { first: first.status, added: added.status, manual, resend: resend.status, sameName: sameName.status };
    check("D5 manual: an item added by hand gets the client's id, key manual|… and origin manual; resend → duplicate, same name → existing", () => {
      assert.equal(first.status, "ready");
      assert.equal(added.status, "synced");
      assert.equal(manual.key, "manual|papel de cocina");
      assert.deepEqual(manual.origins, [{ kind: "manual", quantity: 2 }]);
      assert.equal(manual.unit, "rollos");
      assert.ok(added.view.items.some((line) => line.manual && line.name === "Papel de cocina"));
      assert.equal(resend.status, "duplicate");
      assert.equal(sameName.status, "existing");
      assert.equal(afterAdd.length, 1);
      assert.equal(afterAdd[0].items.filter((row) => row.key === "manual|papel de cocina").length, 1);
      assert.equal(afterAdd[0].signature, before.signature);
      assert.equal(afterAdd[0].basis, before.basis);
      assert.equal(afterAdd[0].reconciled, before.reconciled);
    });

    // 2. Quantities: an item added by hand changes amount and unit; an item of the dishes keeps its
    // unit and records user_adjust; a dish item cannot be removed by hand.
    const view1 = layer.shopping.readShoppingView(asA, week(1), days1);
    const lineOf = (view, name) => view.items.find((line) => line.name === name).id;
    const manualQty = await layer.shopping.setShoppingItemQuantity(asA, week(1), lineOf(view1, "Papel de cocina"), 4, days1, "uds");
    const dishQty = await layer.shopping.setShoppingItemQuantity(asA, week(1), lineOf(view1, "merluza"), 600, days1);
    const refusedRemove = await editShoppingItemsInSupabase({ isoYear: YEAR, isoWeek: 1, listId: before.id, ops: { add: [], set_quantity: [], remove: [{ id: item(1, "merluza").id }] } });
    const badQuantity = await editShoppingItemsInSupabase({ isoYear: YEAR, isoWeek: 1, listId: before.id,
      ops: { add: [], set_quantity: [{ id: item(1, "merluza").id, quantity: null, unit: "g", origins: [] }], remove: [] } }).catch((error) => error.message);
    observed = { manualQty: manualQty.status, dishQty: dishQty.status, papel: item(1, "Papel de cocina"), merluza: item(1, "merluza"), refusedRemove: refusedRemove.results, badQuantity };
    check("D5 quantities: manual items take amount and unit; dish items keep their unit and record user_adjust; dish items are never removed by hand", () => {
      assert.equal(manualQty.status, "synced");
      assert.equal(Number(item(1, "Papel de cocina").quantity), 4);
      assert.equal(item(1, "Papel de cocina").unit, "uds");
      assert.deepEqual(item(1, "Papel de cocina").origins, [{ kind: "manual", quantity: 4 }]);
      assert.equal(dishQty.status, "synced");
      assert.equal(Number(item(1, "merluza").quantity), 600);
      assert.equal(item(1, "merluza").unit, "g");
      assert.deepEqual(item(1, "merluza").origins.at(-1), { kind: "user_adjust", quantity: 600 });
      assert.equal(item(1, "merluza").origins[0].kind, "ai_title");
      assert.deepEqual(refusedRemove.results.map((entry) => entry.result), ["not_manual"]);
      assert.ok(item(1, "merluza"));
      assert.match(badQuantity, /invalid/);
      assert.equal(listsOf(1)[0].signature, before.signature);
    });

    // 3. The guard: the owner's direct DELETE / UPDATE of an item added by hand is skipped (marks
    // still work); a cascade from the week or the list removes it.
    const manualId = item(1, "Papel de cocina").id;
    const exists = "SELECT EXISTS (SELECT 1 FROM public.shopping_items WHERE id='" + manualId + "' AND name='Papel de cocina' AND quantity=4)";
    const directDelete = outcome(1, "DELETE FROM public.shopping_items WHERE id='" + manualId + "'", exists);
    const directRename = outcome(1, "UPDATE public.shopping_items SET name='Otro', removed_at=now() WHERE id='" + manualId + "'", exists + " AND NOT EXISTS (SELECT 1 FROM public.shopping_items WHERE id='" + manualId + "' AND removed_at IS NOT NULL)");
    const directMark = outcome(1, "UPDATE public.shopping_items SET checked=true WHERE id='" + manualId + "'",
      "SELECT EXISTS (SELECT 1 FROM public.shopping_items WHERE id='" + manualId + "' AND checked AND checked_quantity=4)");
    const discard = outcome(1, "SELECT public.shopping_items_discard_unbought('" + before.id + "', ARRAY['" + manualId + "']::uuid[])", exists);
    const gone = "SELECT NOT EXISTS (SELECT 1 FROM public.shopping_items WHERE id='" + manualId + "')";
    const weekCascade = outcome(1, "DELETE FROM public.weeks WHERE id='" + weekId(1) + "'", gone);
    const listCascade = outcome(1, "DELETE FROM public.shopping_lists WHERE id='" + before.id + "'", gone);
    observed = { directDelete, directRename, directMark, discard, weekCascade, listCascade };
    check("D5 guard: deleting or changing an item added by hand outside edit_shopping_items is skipped; marks are applied", () => {
      assert.equal(directDelete, "accepted");
      assert.equal(directRename, "accepted");
      assert.equal(directMark, "accepted");
      assert.equal(discard, "accepted");
    });
    check("D5 guard: deleting the week or the list still removes the items added by hand (cascade)", () => {
      assert.equal(weekCascade, "accepted");
      assert.equal(listCascade, "accepted");
    });

    // 4. Permissions and validation.
    const otherUser = createClient(api.url, api.key, options);
    await otherUser.auth.signInWithPassword({ email: "fixture-2@example.invalid", password: "Local-fixture-only-2026!" });
    const foreign = await otherUser.rpc("edit_shopping_items", { p_iso_year: YEAR, p_iso_week: 1, p_list_id: before.id, p_ops: { remove: [{ id: manualId }] } });
    const foreignDelete = await otherUser.from("shopping_items").delete().eq("id", manualId).select("id");
    await otherUser.auth.signOut({ scope: "local" });
    const anon = createClient(api.url, api.key, options);
    const anonCall = await anon.rpc("edit_shopping_items", { p_iso_year: YEAR, p_iso_week: 1, p_list_id: before.id, p_ops: { remove: [{ id: manualId }] } });
    const call = (ops) => editShoppingItemsInSupabase({ isoYear: YEAR, isoWeek: 1, listId: before.id, ops: { add: [], set_quantity: [], remove: [], ...ops } }).catch((error) => error.message);
    const add = (overrides = {}) => ({ id: crypto.randomUUID(), name: "Pan", quantity: 1, unit: "ud", category: "despensa", item_key: "manual|pan", ...overrides });
    const tooMany = await call({ add: Array.from({ length: 51 }, (_, n) => add({ item_key: "manual|pan" + n })) });
    const notManualKey = await call({ add: [add({ item_key: "despensa|pan|count" })] });
    const badCategory = await call({ add: [add({ category: "bebidas" })] });
    const empty = await call({});
    const repeated = await call({ add: [add(), add()] });
    observed = { foreign: foreign.data ?? foreign.error?.code, foreignDelete: foreignDelete.data, anonCall: anonCall.error?.code, tooMany, notManualKey, badCategory, empty, repeated };
    check("D5 edit_shopping_items: another user sees no week and cannot delete; anon cannot call it; invalid operations are refused (22023)", () => {
      assert.equal(foreign.error, null);
      assert.equal(foreign.data.status, "no_week");
      assert.deepEqual(foreignDelete.data, []);
      assert.equal(anonCall.error?.code, "42501");
      for (const message of [tooMany, notManualKey, badCategory, empty, repeated]) assert.match(String(message), /invalid/);
      assert.ok(item(1, "Papel de cocina"));
    });

    // 5. Two devices adding the same item at once: one row. Each device keeps its own storage across
    // awaits (AsyncLocalStorage, as in the B7 pantry tests): with one global window the second device
    // replaced the first one's storage mid-flight, so both could read the other's pending add and
    // answer «existing» locally (flaky under load, never a database defect).
    const devices = new AsyncLocalStorage();
    const windowBefore = Object.getOwnPropertyDescriptor(global, "window");
    const idleWindow = global.window;
    Object.defineProperty(global, "window", { configurable: true, get: () => devices.getStore() ?? idleWindow });
    let one;
    let two;
    try {
      [one, two] = await Promise.all([1, 2].map(() => {
        const storage = createDevice();
        const deviceWindow = { localStorage: storage.localStorage, sessionStorage: storage.sessionStorage, addEventListener() {}, removeEventListener() {} };
        return devices.run(deviceWindow, async () => {
          const device = freshLayer();
          await device.shopping.loadShoppingList(asA, week(1), days1);
          return device.shopping.addManualShoppingItem(asA, week(1), { name: "Servilletas", quantity: 1, unit: "paquete", category: "otros" }, days1);
        });
      }));
    } finally {
      if (windowBefore) Object.defineProperty(global, "window", windowBefore);
      else delete global.window;
    }
    observed = { statuses: [one.status, two.status], rows: listsOf(1)[0].items.filter((row) => row.name === "Servilletas").length };
    check("D5 manual: two devices adding the same item at once end with one row", () => {
      assert.deepEqual([one.status, two.status].sort(), ["existing", "synced"]);
      assert.equal(listsOf(1)[0].items.filter((row) => row.name === "Servilletas").length, 1);
    });

    // 6. The new client: a change of dishes keeps the items added by hand (bought or not) and an
    // adjusted quantity whose dishes did not change; when they change it is recomputed and reported.
    newDevice();
    layer = freshLayer();
    const days2 = [{ day: "Lunes", date: "", lunch: "Arroz", dinner: "Merluza" }, { day: "Martes", date: "", lunch: "Tortilla", dinner: "LIBRE" }];
    await layer.repos.saveWeek(asA, week(2), days2, { overwrite: true });
    await layer.shopping.ensureShoppingList(asA, week(2), days2);
    const leche = await layer.shopping.addManualShoppingItem(asA, week(2), { name: "Leche", quantity: 2, unit: "l", category: "lácteos" }, days2);
    await layer.shopping.addManualShoppingItem(asA, week(2), papel, days2);
    await layer.shopping.setShoppingItemChecked(asA, week(2), leche.view.items.find((line) => line.name === "Leche").id, true);
    await layer.shopping.setShoppingItemQuantity(asA, week(2), leche.view.items.find((line) => line.name === "merluza").id, 600, days2);
    const days2b = days2.map((day) => (day.day === "Martes" ? { ...day, lunch: "Garbanzos" } : day));
    await layer.repos.saveWeek(asA, week(2), days2b, { overwrite: true });
    const kept = await freshLayer().shopping.ensureShoppingList(asA, week(2), days2b);
    const afterKept = listsOf(2);
    const days2c = [{ day: "Lunes", date: "", lunch: "Merluza", dinner: "Merluza" }, { day: "Martes", date: "", lunch: "Garbanzos", dinner: "LIBRE" }];
    await layer.repos.saveWeek(asA, week(2), days2c, { overwrite: true });
    const recomputed = await freshLayer().shopping.ensureShoppingList(asA, week(2), days2c);
    observed = { kept: kept.status, dropped: [kept.view?.discardedAdjustments, recomputed.view?.discardedAdjustments], items: listsOf(2)[0].items.map((row) => [row.name, row.quantity, row.checked, row.removed]) };
    check("D5 reconcile (new client): items added by hand stay, bought or not; an adjusted quantity stays while its dishes are the same", () => {
      assert.equal(kept.status, "ready");
      assert.equal(afterKept.length, 1);
      const rows = Object.fromEntries(afterKept[0].items.map((row) => [row.name, row]));
      assert.ok(rows["Papel de cocina"]);
      assert.equal(rows.Leche.checked, true);
      assert.equal(rows.Leche.removed, false);
      assert.equal(Number(rows.merluza.quantity), 600);
      assert.ok(rows.garbanzos);
      assert.deepEqual(kept.view.discardedAdjustments, []);
    });
    check("D5 reconcile (new client): when the dishes of an adjusted item change, it is recomputed and reported", () => {
      assert.equal(recomputed.status, "ready");
      assert.equal(Number(item(2, "merluza").quantity), 800);
      assert.equal(item(2, "merluza").origins.some((origin) => origin.kind === "user_adjust"), false);
      assert.deepEqual(recomputed.view.discardedAdjustments, ["merluza"]);
      assert.ok(item(2, "Papel de cocina") && item(2, "Leche"));
    });

    // 7. Rollout: the client deployed before D5 (f810818) with this migration applied.
    newDevice();
    layer = freshLayer();
    const days3 = [{ day: "Lunes", date: "", lunch: "Arroz", dinner: "Merluza" }];
    await layer.repos.saveWeek(asA, week(3), days3, { overwrite: true });
    await layer.shopping.ensureShoppingList(asA, week(3), days3);
    const added3 = await layer.shopping.addManualShoppingItem(asA, week(3), papel, days3);
    await layer.shopping.addManualShoppingItem(asA, week(3), { name: "Leche", quantity: 2, unit: "l", category: "lácteos" }, days3);
    await layer.shopping.setShoppingItemQuantity(asA, week(3), added3.view.items.find((line) => line.name === "merluza").id, 700, days3);
    const errors = [];
    const attempt = async (fn) => { try { return await fn(); } catch (error) { errors.push(error.message); return null; } };
    const legacyRead = await attempt(() => legacy.getLatestShoppingListForWeekFromSupabase(weekId(3)));
    const legacyLeche = legacyRead?.items.find((row) => row.name === "Leche");
    const legacyMark = await attempt(() => legacy.setShoppingItemsCheckedInSupabase([legacyLeche.id], true));
    // The deployed client's reconciliation after a change of dishes: its diff asks to remove the
    // items added by hand (they are not needed by any dish).
    const days3b = [{ day: "Lunes", date: "", lunch: "Arroz", dinner: "Pisto" }];
    await layer.repos.saveWeek(asA, week(3), days3b, { overwrite: true });
    const context = json("SELECT coalesce((SELECT json_build_object('servings',servings,'version',context_version) FROM public.week_food_contexts WHERE week_id='" + weekId(3) + "'),'null');");
    const current3 = await attempt(() => legacy.getLatestShoppingListForWeekFromSupabase(weekId(3)));
    const dishes = build.plannedDishes(days3b);
    const aiItems = new Map(dishes.map((dish) => [build.slotKey(dish.day, dish.meal), AI[dish.title.toLowerCase()]]));
    const desired = build.buildDesiredList({ dishes, servings: context?.servings ?? 2, cards: new Map(), aiItems });
    const ops = legacyDiff.diffShoppingList(current3.items.map((row) => ({ id: row.id, name: row.name, quantity: row.quantity, unit: row.unit, category: row.category,
      checked: row.checked, itemKey: row.itemKey ?? null, origins: row.origins ?? null, removedAt: row.removedAt ?? null })), desired.items);
    const manualIds = current3.items.filter((row) => row.itemKey?.startsWith("manual|")).map((row) => row.id);
    const legacyReconcile = await attempt(() => legacy.reconcileShoppingListInSupabase({ isoYear: YEAR, isoWeek: 3, listId: current3.id,
      fromSignature: current3.weekSignature, toSignature: getShoppingSignature(week(3), days3b, context), ops, expectedWeekVersion: null }));
    const after3 = listsOf(3);
    const legacyAfter = await attempt(() => legacy.getLatestShoppingListForWeekFromSupabase(weekId(3)));
    observed = { errors, ops: { remove: ops.remove.length, manual: manualIds.filter((m) => ops.remove.some((op) => op.id === m)).length }, reconcile: legacyReconcile?.status, summary: legacyReconcile?.summary,
      after: after3.map((l) => l.items.map((row) => [row.name, row.checked, row.removed])) };
    check("D5 rollout: the deployed client (f810818) reads items added by hand as normal items and can mark them", () => {
      assert.deepEqual(errors, []);
      assert.ok(legacyLeche);
      assert.deepEqual(legacyLeche.origins, [], "its parser drops the manual origin");
      assert.equal(legacyMark.status, "applied");
      assert.equal(item(3, "Leche").checked, true);
    });
    check("D5 rollout: when the deployed client reconciles, its removal of the items added by hand is skipped (bought or not)", () => {
      assert.equal(manualIds.length, 2);
      assert.equal(manualIds.filter((m) => ops.remove.some((op) => op.id === m)).length, 2, "its diff does ask to remove them");
      assert.equal(legacyReconcile.status, "applied");
      assert.equal(after3.length, 1);
      assert.ok(item(3, "Papel de cocina"));
      assert.equal(item(3, "Leche").checked, true);
      assert.equal(item(3, "Leche").removed, false, "not «ya no hace falta»");
      assert.equal(item(3, "merluza"), undefined, "the dish items it no longer needs do go");
      assert.ok(item(3, "calabacín"));
      assert.equal(legacyAfter.items.filter((row) => row.itemKey?.startsWith("manual|")).length, 2);
    });

    // Known limit (documented): if the deployed client falls back to a new list, the items added by
    // hand stay in the previous one; an edit sent to that previous list is stale.
    const legacySaved = await attempt(() => legacy.saveShoppingListInSupabase({ isoYear: YEAR, isoWeek: 3, weekSignature: "shop1:d5-fallback", expectedWeekVersion: null, items: AI.arroz }));
    const lists3 = listsOf(3);
    const staleEdit = await editShoppingItemsInSupabase({ isoYear: YEAR, isoWeek: 3, listId: lists3[0].id, ops: { add: [], set_quantity: [], remove: [{ id: manualIds[0] }] } });
    observed = { legacySaved: legacySaved?.status, lists: lists3.map((l) => l.items.length), staleEdit };
    check("D5 rollout (known limit): a new list made by the deployed client leaves the items added by hand in the previous list; edits of that list are stale", () => {
      assert.equal(legacySaved.status, "created");
      assert.equal(lists3.length, 2);
      assert.equal(lists3[0].items.filter((row) => row.key?.startsWith("manual|")).length, 2);
      assert.equal(lists3[1].items.filter((row) => row.key?.startsWith("manual|")).length, 0);
      assert.equal(staleEdit.status, "stale");
      assert.equal(staleEdit.currentListId, lists3[1].id);
    });
  } finally {
    global.fetch = realFetch;
    cleanup();
    restoreDevice();
    freshLayer();
  }
}

module.exports = { runShoppingManualTests };
