// B7: the pantry written item by item against the real local Supabase (Auth + RLS + functions).
// Every scenario goes through the application's own data layer and Supabase client. A "device" is
// a fresh copy of the data layer (own queue) with its own storage, kept across awaits, so two
// devices really run in parallel. Fixture A's pantry is saved first and restored afterwards.
const assert = require("node:assert/strict");
const path = require("node:path");
const { AsyncLocalStorage } = require("node:async_hooks");

const RPC = "/rest/v1/rpc/";

function freshLayer() {
  for (const key of Object.keys(require.cache)) {
    if (/src[\\/]lib[\\/](data[\\/](repositories|sync|pantry)|supabase[\\/]pantry)\.ts$/.test(key)) delete require.cache[key];
  }
  return require("../src/lib/data/pantry.ts");
}

async function runPantryTests({ check: baseCheck, sql, id, supabase, api, createClient }) {
  // B7_DEBUG=1 prints what was observed (synthetic rows only) when a scenario fails.
  let observed = null;
  const check = (name, fn) => baseCheck(name, () => {
    try { fn(); } catch (error) {
      if (process.env.B7_DEBUG) console.error("  observed:", JSON.stringify(observed), error.message.split("\n")[0]);
      throw error;
    }
  });
  const { createDevice } = require(path.join(__dirname, "../tests/helpers/fake-browser.cjs"));
  const userA = id("0", 1);
  const userB = id("0", 2);
  const asA = { scope: "u_" + userA, userId: userA };
  const json = (statement) => JSON.parse(sql(statement).trim());
  const rowsOf = (user = userA) => json(
    "SELECT coalesce(json_agg(json_build_object('id',id,'name',name,'category',category,'active',active,'version',version,'profile_id',profile_id)" +
    " ORDER BY name, created_at, id),'[]') FROM public.pantry_items WHERE user_id='" + user + "';");
  const summary = (rows) => rows.map((row) => row.name + ":" + row.active);
  const snapshot = sql("SELECT coalesce(json_agg(p),'[]') FROM public.pantry_items p WHERE user_id='" + userA + "';").trim();
  const setPantry = (items) => {
    sql("DELETE FROM public.pantry_items WHERE user_id='" + userA + "';");
    for (const [name, category, active] of items) {
      sql("INSERT INTO public.pantry_items (user_id,profile_id,name,category,active) VALUES ('" + userA + "','" + id("1", 1) + "','" + name + "','" + category + "'," + active + ");");
    }
  };
  const BASE = [["Sal", "básicos", true], ["Pimienta", "especias", true], ["Aceite", "aceites y vinagres", true]];

  // Each device: own storage (kept across awaits) and own copy of the data layer.
  const devices = new AsyncLocalStorage();
  const previousWindow = Object.getOwnPropertyDescriptor(global, "window");
  const idle = { localStorage: createDevice().localStorage, sessionStorage: createDevice().sessionStorage, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(global, "window", { configurable: true, get: () => devices.getStore()?.window ?? idle });
  const newDevice = () => {
    const storage = createDevice();
    const device = { window: { localStorage: storage.localStorage, sessionStorage: storage.sessionStorage, addEventListener() {}, removeEventListener() {} } };
    device.layer = devices.run(device, freshLayer);
    device.run = (fn) => devices.run(device, () => fn(device.layer));
    return device;
  };

  // Network faults on chosen functions: "before" (never sent) or "after" (applied, answer lost).
  const realFetch = global.fetch;
  const faults = new Map();
  global.fetch = async (input, init) => {
    const url = String(input);
    const fault = [...faults.entries()].find(([name]) => url.includes(RPC + name));
    if (fault?.[1] === "before") throw new TypeError("fetch failed");
    const response = await realFetch(input, init);
    if (fault?.[1] === "after") {
      faults.delete(fault[0]);
      throw new TypeError("fetch failed");
    }
    return response;
  };

  try {
    await supabase.auth.signOut({ scope: "local" });
    await supabase.auth.signInWithPassword({ email: "fixture-1@example.invalid", password: "Local-fixture-only-2026!" });

    // 1. The reproduced defect: the connection drops in the middle of a change. Before B7 the
    //    account pantry was left empty (DELETE sent, INSERT lost). Now nothing is lost, and the
    //    change is sent on the next load.
    setPantry(BASE);
    let phone = newDevice();
    await phone.run((p) => p.loadPantry(asA));
    const before = rowsOf();
    faults.set("set_pantry_items_active", "before");
    const offline = await phone.run((p) => p.setPantryItemActive(asA, "básicos", "Sal", false));
    const duringOutage = rowsOf();
    faults.clear();
    const reload = await phone.run((p) => p.loadPantry(asA));
    const after = rowsOf();
    observed = { offline: offline.status, duringOutage: summary(duringOutage), reload: reload.pending, after: summary(after) };
    check("B7 pantry: a change that cannot reach the account loses nothing; it is sent on the next load", () => {
      assert.equal(offline.status, "pending");
      assert.deepEqual(duringOutage, before);
      assert.equal(reload.pending, false);
      assert.deepEqual(after.map((row) => row.id), before.map((row) => row.id));
      assert.deepEqual(summary(after), ["Aceite:true", "Pimienta:true", "Sal:false"]);
    });
    check("B7 pantry: a change writes only that item (same rows; only its version moves)", () => {
      assert.deepEqual(after.map((row) => row.version), [1, 1, 2]);
    });

    // 2. Two devices change different items at the same time (the defect: duplicated or lost).
    for (let round = 0; round < 3; round++) {
      setPantry(BASE);
      const one = newDevice();
      const two = newDevice();
      await Promise.all([one.run((p) => p.loadPantry(asA)), two.run((p) => p.loadPantry(asA))]);
      const results = await Promise.all([
        one.run((p) => p.addPantryItem(asA, "especias", "Comino")),
        two.run((p) => p.setPantryItemActive(asA, "especias", "Pimienta", false)),
      ]);
      const rows = rowsOf();
      observed = { round, results: results.map((r) => r.status), rows: summary(rows) };
      check("B7 pantry: two devices changing different items at once keep both, no duplicate (round " + (round + 1) + ")", () => {
        assert.deepEqual(results.map((r) => r.status), ["synced", "synced"]);
        assert.deepEqual(summary(rows), ["Aceite:true", "Comino:true", "Pimienta:false", "Sal:true"]);
      });
    }

    // 3. Two devices add the same item at once (other case and accents): one row.
    for (let round = 0; round < 3; round++) {
      setPantry(BASE);
      const one = newDevice();
      const two = newDevice();
      await Promise.all([one.run((p) => p.loadPantry(asA)), two.run((p) => p.loadPantry(asA))]);
      const results = await Promise.all([
        one.run((p) => p.addPantryItem(asA, "especias", "Azafrán")),
        two.run((p) => p.addPantryItem(asA, "especias", "  AZAFRAN ")),
      ]);
      const rows = rowsOf().filter((row) => row.category === "especias" && row.name !== "Pimienta");
      observed = { round, results: results.map((r) => r.status), rows: summary(rows) };
      check("B7 pantry: two devices adding the same item at once → one row (round " + (round + 1) + ")", () => {
        assert.deepEqual(results.map((r) => r.status), ["synced", "synced"]);
        assert.equal(rows.length, 1);
      });
    }

    // 4. The same item changed on two devices: the second, based on an old version, is refused.
    setPantry(BASE);
    const laptop = newDevice();
    phone = newDevice();
    await laptop.run((p) => p.loadPantry(asA));
    await phone.run((p) => p.loadPantry(asA));
    const first = await laptop.run((p) => p.setPantryItemActive(asA, "básicos", "Sal", false));
    const second = await phone.run((p) => p.deletePantryItem(asA, "básicos", "Sal"));
    const sal = rowsOf().filter((row) => row.name === "Sal");
    observed = { first: first.status, second: second.status, sal };
    check("B7 pantry: the same item changed on another device since it was read → conflict, the account wins", () => {
      assert.equal(first.status, "synced");
      assert.equal(second.status, "conflict");
      assert.deepEqual(summary(sal), ["Sal:false"]);
      assert.deepEqual(second.items.filter((item) => item.name === "Sal").map((item) => item.active), [false]);
    });

    // 5. The add arrives but its answer is lost: sent again on the next load, no duplicate.
    setPantry(BASE);
    phone = newDevice();
    await phone.run((p) => p.loadPantry(asA));
    faults.set("add_pantry_items", "after");
    const lost = await phone.run((p) => p.addPantryItem(asA, "otros", "Garbanzos"));
    const resent = await phone.run((p) => p.loadPantry(asA));
    const garbanzos = rowsOf().filter((row) => row.name === "Garbanzos");
    observed = { lost: lost.status, resent: resent.pending, garbanzos };
    check("B7 pantry: an add whose answer was lost is sent again without a second row", () => {
      assert.equal(lost.status, "pending");
      assert.equal(resent.pending, false);
      assert.equal(garbanzos.length, 1);
      assert.equal(garbanzos[0].profile_id, id("1", 1), "linked to the user's own profile");
    });

    // 6. An empty account: the default items appear and the first change adds them, once.
    sql("DELETE FROM public.pantry_items WHERE user_id='" + userA + "';");
    phone = newDevice();
    const empty = await phone.run((p) => p.loadPantry(asA));
    const firstChange = await phone.run((p) => p.setPantryItemActive(asA, "salsas", "Mostaza", false));
    const seeded = rowsOf();
    const otherDevice = await newDevice().run((p) => p.loadPantry(asA));
    observed = { empty: empty.data, firstChange: firstChange.status, seeded: summary(seeded) };
    check("B7 pantry: an empty account shows the defaults and the first change stores them once", () => {
      assert.equal(empty.data, null);
      assert.equal(firstChange.status, "synced");
      assert.equal(seeded.length, 6);
      assert.ok(summary(seeded).includes("Mostaza:false"));
      assert.equal(otherDevice.data.length, 6);
    });

    // 7. Permissions and validation, as another user and as anon.
    setPantry(BASE);
    const target = rowsOf()[0];
    const ref = JSON.stringify([{ id: target.id, version: target.version }]);
    const clientB = createClient(api.url, api.key, { auth: { persistSession: false, autoRefreshToken: false } });
    await clientB.auth.signInWithPassword({ email: "fixture-2@example.invalid", password: "Local-fixture-only-2026!" });
    const bSet = await clientB.rpc("set_pantry_items_active", { p_rows: JSON.parse(ref), p_active: false });
    const bDelete = await clientB.rpc("delete_pantry_items", { p_rows: JSON.parse(ref) });
    const bAdd = await clientB.rpc("add_pantry_items", { p_items: [{ id: target.id, name: "Intruso", category: "otros", active: true }] });
    const bOwn = await clientB.rpc("add_pantry_items", { p_items: [{ id: crypto.randomUUID(), name: "Lenteja sintética", category: "básicos", active: true }] });
    const anon = createClient(api.url, api.key, { auth: { persistSession: false, autoRefreshToken: false } });
    const anonAdd = await anon.rpc("add_pantry_items", { p_items: [{ id: crypto.randomUUID(), name: "Anónimo", category: "otros", active: true }] });
    const tooLong = await supabase.rpc("add_pantry_items", { p_items: [{ id: crypto.randomUUID(), name: "x".repeat(81), category: "otros", active: true }] });
    const badCategory = await supabase.rpc("add_pantry_items", { p_items: [{ id: crypto.randomUUID(), name: "Sal", category: "frutería", active: true }] });
    const untouched = rowsOf().find((row) => row.id === target.id);
    observed = { bSet: bSet.data, bDelete: bDelete.data, bAdd: bAdd.error?.code, bOwn: bOwn.data?.items?.[0]?.result, anon: anonAdd.error?.code, tooLong: tooLong.error?.code, badCategory: badCategory.error?.code };
    check("B7 pantry: another user can neither change, delete nor take over A's items", () => {
      assert.equal(bSet.data.status, "missing");
      assert.equal(bDelete.data.status, "applied");
      assert.ok(bAdd.error, "an id of another user's row is refused");
      assert.deepEqual(untouched, target);
      assert.equal(bOwn.data.items[0].result, "existing", "B's own item of the same name is B's, not A's");
      assert.equal(rowsOf(userB).length, 2);
    });
    check("B7 pantry: anon cannot call the functions; invalid items are refused", () => {
      assert.equal(anonAdd.error?.code, "42501");
      assert.equal(tooLong.error?.code, "22023");
      assert.equal(badCategory.error?.code, "22023");
    });
    await clientB.auth.signOut({ scope: "local" });

    // 8. Rollout: migration applied while main still serves the previous client (DELETE all +
    //    INSERT all on every change). It keeps working; the new client's ids it replaced are
    //    "missing" (re-read, never re-created), and new adds never duplicate its rows.
    setPantry(BASE);
    const legacy = require("../tests/fixtures/legacy-pantry-client-ab2433b.ts");
    phone = newDevice();
    await phone.run((p) => p.loadPantry(asA));
    const legacyErrors = [];
    const attempt = async (fn) => { try { return await fn(); } catch (error) { legacyErrors.push(error.message); return null; } };
    await attempt(() => legacy.replacePantryItemsInSupabase(
      [...BASE.map(([name, category, active]) => ({ name, category, active: name === "Aceite" ? false : active })), { name: "Comino", category: "especias", active: true }],
      id("1", 1), userA));
    const legacyRead = await attempt(() => legacy.getPantryForUserFromSupabase(userA));
    const replaced = await phone.run((p) => p.setPantryItemActive(asA, "básicos", "Sal", false));
    const added = await phone.run((p) => p.addPantryItem(asA, "especias", "comino"));
    const rolloutRows = rowsOf();
    const legacyAfter = await attempt(() => legacy.getPantryForUserFromSupabase(userA));
    observed = { legacyErrors, replaced: replaced.status, added: added.status, rows: summary(rolloutRows) };
    check("B7 rollout: the previous client (ab2433b) still replaces and reads the pantry after the migration", () => {
      assert.deepEqual(legacyErrors, []);
      assert.equal(legacyRead.items.length, 4);
      assert.ok(legacyRead.version);
      assert.equal(legacyAfter.items.length, 4);
    });
    check("B7 rollout: the new client re-reads items the previous client replaced and never duplicates them", () => {
      assert.equal(replaced.status, "conflict");
      assert.deepEqual(replaced.items.find((item) => item.name === "Sal")?.active, true);
      assert.equal(added.status, "synced");
      assert.deepEqual(summary(rolloutRows), ["Aceite:false", "Comino:true", "Pimienta:true", "Sal:true"]);
    });

    // The section «Aceites y vinagres» was removed: a client still sending it gets the item in Básicos.
    setPantry([["Aceite de oliva", "básicos", true]]);
    const legacyAdd = await supabase.rpc("add_pantry_items", { p_items: [
      { id: crypto.randomUUID(), name: "aceite de oliva", category: "aceites y vinagres", active: true },
      { id: crypto.randomUUID(), name: "Vinagre", category: "aceites y vinagres", active: true },
    ] });
    observed = legacyAdd;
    check("pantry: an item sent with «aceites y vinagres» is stored and matched in «básicos»", () => {
      assert.equal(legacyAdd.error, null);
      assert.deepEqual(legacyAdd.data.items.map((item) => [item.result, item.row.category]), [["existing", "básicos"], ["created", "básicos"]]);
      assert.deepEqual(rowsOf().map((row) => row.name + ":" + row.category), ["Aceite de oliva:básicos", "Vinagre:básicos"]);
    });
  } finally {
    global.fetch = realFetch;
    if (previousWindow) Object.defineProperty(global, "window", previousWindow);
    else delete global.window;
    sql("DELETE FROM public.pantry_items WHERE user_id='" + userA + "';" +
      "INSERT INTO public.pantry_items SELECT * FROM json_populate_recordset(NULL::public.pantry_items, $snapshot$" + snapshot + "$snapshot$);");
    freshLayer();
  }
}

module.exports = { runPantryTests };
