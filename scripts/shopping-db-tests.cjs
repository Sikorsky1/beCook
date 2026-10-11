// B6: shopping lists tied to their week against the real local Supabase (Auth + RLS + functions).
// Every scenario goes through the application's own data layer and Supabase client; only the AI
// route is replaced by a fixed answer. A "device" is a fresh copy of the data layer with its own
// storage. Scenario weeks live in 2032 and are removed afterwards.
const assert = require("node:assert/strict");
const path = require("node:path");

const YEAR = 2032;
const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const fullWeek = (dish) => DAY_NAMES.map((day) => ({ day, date: "", lunch: dish + " " + day, dinner: "LIBRE" }));
const AI_ITEMS = [
  { name: "lentejas", quantity: 500, unit: "g", category: "despensa" },
  { name: "tomate", quantity: 4, unit: "ud", category: "frutería" },
  { name: "cebolla", quantity: 2, unit: "ud", category: "frutería" },
  { name: "merluza", quantity: 400, unit: "g", category: "pescadería" },
];
const TOMATO = "frutería-tomate-ud";
const ONION = "frutería-cebolla-ud";

// A fresh copy of the data layer behaves like another tab or device (own queues and generations).
function freshLayer() {
  for (const key of Object.keys(require.cache)) {
    if (/src[\\/]lib[\\/](data[\\/](repositories|sync|shopping)|supabase[\\/](weeks|shopping-lists))\.ts$/.test(key)) delete require.cache[key];
  }
  return { repos: require("../src/lib/data/repositories.ts"), shopping: require("../src/lib/data/shopping.ts") };
}

async function runShoppingTests({ check: baseCheck, sql, id, supabase, api, createClient }) {
  // B6_DEBUG=1 prints what was observed (synthetic rows only) when a scenario fails.
  let observed = null;
  const check = (name, fn) => baseCheck(name, () => {
    try { fn(); } catch (error) {
      if (process.env.B6_DEBUG) console.error("  observed:", JSON.stringify(observed), error.message.split("\n")[0]);
      throw error;
    }
  });
  const { createDevice, useDevice } = require(path.join(__dirname, "../tests/helpers/fake-browser.cjs"));
  const userA = id("0", 1);
  const asA = { scope: "u_" + userA, userId: userA };
  const week = (n) => ({ isoYear: YEAR, isoWeek: n });
  const json = (statement) => JSON.parse(sql(statement).trim());
  const listsOf = (n) => json(
    "SELECT coalesce(json_agg(json_build_object('id',l.id,'signature',l.week_signature IS NOT NULL," +
    "'items',(SELECT json_agg(json_build_object('id',i.id,'name',i.name,'checked',i.checked) ORDER BY i.name) FROM public.shopping_items i WHERE i.shopping_list_id=l.id))" +
    " ORDER BY l.created_at, l.id),'[]') FROM public.shopping_lists l JOIN public.weeks w ON w.id=l.week_id" +
    " WHERE w.user_id='" + userA + "' AND w.iso_year=" + YEAR + " AND w.iso_week=" + n + ";");
  const checkedNames = (list) => list.items.filter((item) => item.checked).map((item) => item.name);
  const cleanup = () => sql("DELETE FROM public.weeks WHERE user_id='" + userA + "' AND iso_year=" + YEAR + ";");
  const restoreDevice = useDevice(createDevice());
  const onDevice = (device) => { useDevice(device); return device; };
  const newDevice = () => onDevice(createDevice());

  // The AI route answers with fixed items; Supabase requests go to the real local API.
  const realFetch = global.fetch;
  let aiCalls = 0;
  global.fetch = async (input, init) => {
    if (String(input) === "/api/generate-shopping-list") {
      aiCalls++;
      return Response.json({ items: AI_ITEMS });
    }
    return realFetch(input, init);
  };

  try {
    await supabase.auth.signOut({ scope: "local" });
    await supabase.auth.signInWithPassword({ email: "fixture-1@example.invalid", password: "Local-fixture-only-2026!" });
    cleanup();

    // 1. Generate, then mark two items: one list, the same rows updated, no AI call for marking.
    newDevice();
    let layer = freshLayer();
    await layer.repos.saveWeek(asA, week(1), fullWeek("Lentejas"), { overwrite: true });
    await layer.repos.loadWeek(asA, week(1));
    const generated = await layer.shopping.ensureShoppingList(asA, week(1), fullWeek("Lentejas"));
    const afterGenerate = listsOf(1);
    const marks = [
      await layer.shopping.setShoppingItemChecked(asA, week(1), TOMATO, true),
      await layer.shopping.setShoppingItemChecked(asA, week(1), ONION, true),
      await layer.shopping.setShoppingItemChecked(asA, week(1), ONION, false),
    ];
    const afterMarks = listsOf(1);
    observed = { generated: generated.status, aiCalls, marks: marks.map((m) => m.status), lists: afterMarks.length };
    check("B6 shopping: generating stores one list for its week; marking updates only that item, no new list, no AI", () => {
      assert.equal(generated.status, "ready");
      assert.equal(aiCalls, 1);
      assert.equal(afterGenerate.length, 1);
      assert.ok(afterGenerate[0].signature);
      assert.deepEqual(marks.map((m) => m.status), ["synced", "synced", "synced"]);
      assert.equal(afterMarks.length, 1);
      assert.deepEqual(afterMarks[0].items.map((item) => item.id), afterGenerate[0].items.map((item) => item.id));
      assert.deepEqual(checkedNames(afterMarks[0]), ["tomate"]);
    });

    // 2. Another device (empty storage) recovers the list and its marks without calling the AI.
    const phone = newDevice();
    const second = await freshLayer().shopping.ensureShoppingList(asA, week(1), fullWeek("Lentejas"));
    observed = { status: second.status, aiCalls, checked: second.view?.checkedItemIds };
    check("B6 shopping: a second device reads the account list of that week with its marks", () => {
      assert.equal(second.status, "ready");
      assert.equal(aiCalls, 1);
      assert.deepEqual(second.view.checkedItemIds, [TOMATO]);
      assert.equal(listsOf(1).length, 1);
    });

    // 3. Applying the same dishes again through apply_week (new week version) keeps list and marks.
    const reapplied = await freshLayer().repos.saveWeek(asA, week(1), fullWeek("Lentejas"), { overwrite: true });
    const versionAfter = Number(sql("SELECT version FROM public.weeks WHERE user_id='" + userA + "' AND iso_year=" + YEAR + " AND iso_week=1;").trim());
    const afterReapply = await freshLayer().shopping.ensureShoppingList(asA, week(1), fullWeek("Lentejas"));
    observed = { reapplied: reapplied.status, versionAfter, aiCalls, lists: listsOf(1).length };
    check("B6 shopping: re-applying the same menu (new week version) reuses the list and keeps its marks", () => {
      assert.equal(reapplied.status, "synced");
      assert.ok(versionAfter >= 2);
      assert.equal(aiCalls, 1);
      assert.equal(listsOf(1).length, 1);
      assert.deepEqual(afterReapply.view.checkedItemIds, [TOMATO]);
    });

    // 4. Changing a dish makes a new list; the old one is kept. A mark from a device still showing
    //    the old list is refused (stale) and writes nothing.
    newDevice();
    const editor = freshLayer();
    const loaded = await editor.repos.loadWeek(asA, week(1));
    const edited = loaded.data.map((day) => (day.day === "Martes" ? { ...day, lunch: "Garbanzos" } : day));
    await editor.repos.saveWeekSlot(asA, week(1), edited, { day: "Martes", meal: "lunch" });
    const regenerated = await editor.shopping.ensureShoppingList(asA, week(1), edited);
    onDevice(phone);
    const staleMark = await freshLayer().shopping.setShoppingItemChecked(asA, week(1), ONION, true);
    const afterEdit = listsOf(1);
    observed = { regenerated: regenerated.status, aiCalls, staleMark: staleMark.status, lists: afterEdit.map(checkedNames) };
    // C4: this route stub answers whole-week items only (no breakdown), so the client falls back to the
    // B6 behaviour; the in-place update is scripts/shopping-reconcile-db-tests.cjs.
    check("B6 shopping: a dish change (server without breakdown) makes a new list, the previous one is kept, and a mark on the old one is refused", () => {
      assert.equal(regenerated.status, "ready");
      assert.equal(aiCalls, 2);
      assert.equal(afterEdit.length, 2);
      assert.deepEqual(checkedNames(afterEdit[0]), ["tomate"], "history unchanged");
      assert.deepEqual(checkedNames(afterEdit[1]), [], "the stale mark wrote nothing");
      assert.equal(staleMark.status, "stale");
    });

    // 5. Marking in a past week changes only that week's list and never creates a list.
    newDevice();
    layer = freshLayer();
    await layer.repos.saveWeek(asA, week(2), fullWeek("Lentejas"), { overwrite: true });
    await layer.shopping.ensureShoppingList(asA, week(2), fullWeek("Lentejas"));
    const currentBefore = listsOf(2);
    const pastBefore = listsOf(1);
    const pastMark = await layer.shopping.setShoppingItemChecked(asA, week(1), TOMATO, true);
    observed = { pastMark: pastMark.status, current: listsOf(2), past: listsOf(1).length };
    check("B6 shopping: marking in a past week does not touch the current week nor create any list", () => {
      assert.deepEqual(listsOf(2), currentBefore);
      assert.equal(listsOf(1).length, pastBefore.length);
      assert.equal(sql("SELECT count(*) FROM public.shopping_lists l JOIN public.weeks w ON w.id=l.week_id WHERE w.user_id='" + userA + "' AND w.iso_year=" + YEAR + ";").trim(), "3");
    });

    // 6. Two devices save the list of the same, still listless, week in parallel: one list.
    for (let round = 0; round < 3; round++) {
      newDevice();
      await freshLayer().repos.saveWeek(asA, week(3 + round), fullWeek("Pollo"), { overwrite: true });
      // Separate copies of the data layer: neither waits for the other's generation.
      const [one, two] = await Promise.all([1, 2].map(() =>
        freshLayer().shopping.generateShoppingList(asA, week(3 + round), fullWeek("Pollo"))));
      const lists = listsOf(3 + round);
      observed = { statuses: [one.status, two.status], lists: lists.length };
      check("B6 shopping: two devices storing the same week's list at once → one list for both (round " + (round + 1) + ")", () => {
        assert.deepEqual([one.status, two.status], ["ready", "ready"]);
        assert.equal(lists.length, 1);
        assert.deepEqual(one.view.items, two.view.items);
      });
    }

    // 7. Database contract: version guard, ownership, permissions and validation.
    const { saveShoppingListInSupabase, setShoppingItemsCheckedInSupabase } = require("../src/lib/supabase/shopping-lists.ts");
    const items = AI_ITEMS.map(({ name, quantity, unit, category }) => ({ name, quantity, unit, category }));
    const stale = await saveShoppingListInSupabase({ isoYear: YEAR, isoWeek: 2, weekSignature: "shop1:other", items, expectedWeekVersion: 0 });
    const invalid = await saveShoppingListInSupabase({ isoYear: YEAR, isoWeek: 2, weekSignature: "shop1:other", items: [{ ...items[0], category: "bebidas" }], expectedWeekVersion: null }).catch((error) => error.message);
    const otherUser = createClient(api.url, api.key, { auth: { persistSession: false, autoRefreshToken: false } });
    await otherUser.auth.signInWithPassword({ email: "fixture-2@example.invalid", password: "Local-fixture-only-2026!" });
    const foreignSave = await otherUser.rpc("save_shopping_list", { p_iso_year: YEAR, p_iso_week: 2, p_week_signature: "shop1:x", p_items: items });
    const foreignMark = await otherUser.rpc("set_shopping_items_checked", { p_item_ids: [listsOf(2)[0].items[0].id], p_checked: true });
    await otherUser.auth.signOut({ scope: "local" });
    const anon = createClient(api.url, api.key, { auth: { persistSession: false, autoRefreshToken: false } });
    const anonSave = await anon.rpc("save_shopping_list", { p_iso_year: YEAR, p_iso_week: 2, p_week_signature: "shop1:x", p_items: items });
    const anonMark = await anon.rpc("set_shopping_items_checked", { p_item_ids: [listsOf(2)[0].items[0].id], p_checked: true });
    const mixed = await setShoppingItemsCheckedInSupabase([listsOf(2)[0].items[0].id, listsOf(1)[1].items[0].id], true);
    observed = { stale: stale.status, invalid: typeof invalid, foreignSave: foreignSave.data, foreignMark: foreignMark.data, anonSave: anonSave.error?.code, anonMark: anonMark.error?.code, mixed: mixed.status };
    check("B6 shopping: save is refused when the week moved on, and invalid items roll back", () => {
      assert.equal(stale.status, "week_changed");
      assert.match(invalid, /invalid item/);
      assert.equal(listsOf(2).length, 1);
    });
    check("B6 shopping: another user can neither save into nor mark this user's lists; anon cannot call the functions", () => {
      assert.equal(foreignSave.error, null);
      assert.equal(foreignSave.data.status, "no_week");
      assert.equal(foreignMark.error, null);
      assert.equal(foreignMark.data.status, "missing");
      assert.equal(anonSave.error?.code, "42501");
      assert.equal(anonMark.error?.code, "42501");
      assert.equal(mixed.status, "missing", "items of two lists in one call");
      assert.deepEqual(checkedNames(listsOf(2)[0]), []);
    });

    // 8. Rollout: migration applied while main still serves the previous client (one INSERT of a
    //    whole list per click, read of the newest list). It keeps working, and the new client
    //    treats its newest list as the current one (no signature: freshness rule).
    newDevice();
    layer = freshLayer();
    await layer.repos.saveWeek(asA, week(8), fullWeek("Arroz"), { overwrite: true });
    const legacy = require("../tests/fixtures/legacy-shopping-client-5a573ff.ts");
    const weekId = sql("SELECT id FROM public.weeks WHERE user_id='" + userA + "' AND iso_year=" + YEAR + " AND iso_week=8;").trim();
    const legacyErrors = [];
    const attempt = async (fn) => { try { return await fn(); } catch (error) { legacyErrors.push(error.message); return null; } };
    await attempt(() => legacy.saveShoppingListToSupabase(weekId, items.map((item) => ({ ...item, checked: false }))));
    await attempt(() => legacy.saveShoppingListToSupabase(weekId, items.map((item) => ({ ...item, checked: item.name === "tomate" }))));
    const legacyRead = await attempt(() => legacy.getLatestShoppingListForWeekFromSupabase(weekId));
    const aiBefore = aiCalls;
    const adopted = await layer.shopping.ensureShoppingList(asA, week(8), fullWeek("Arroz"));
    const adoptedMark = await layer.shopping.setShoppingItemChecked(asA, week(8), ONION, true);
    const legacyAfter = await attempt(() => legacy.getLatestShoppingListForWeekFromSupabase(weekId));
    observed = { legacyErrors, adopted: adopted.status, aiCalls: aiCalls - aiBefore, adoptedMark: adoptedMark.status };
    check("B6 rollout: the previous client (5a573ff) still saves and reads lists after the migration", () => {
      assert.deepEqual(legacyErrors, []);
      assert.equal(listsOf(8).length, 2);
      assert.equal(legacyRead.items.filter((item) => item.checked).length, 1);
    });
    check("B6 rollout: the new client reuses the newest previous-client list without AI and marks it in place", () => {
      assert.equal(adopted.status, "ready");
      assert.equal(aiCalls, aiBefore);
      assert.deepEqual(adopted.view.checkedItemIds, [TOMATO]);
      assert.equal(adoptedMark.status, "synced");
      assert.equal(listsOf(8).length, 2);
      assert.deepEqual(legacyAfter.items.filter((item) => item.checked).map((item) => item.name).sort(), ["cebolla", "tomate"]);
    });
  } finally {
    global.fetch = realFetch;
    cleanup();
    restoreDevice();
    freshLayer();
  }
}

module.exports = { runShoppingTests };
