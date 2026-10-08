// B4: week writes against the real local Supabase (Auth + RLS + constraints).
// Every scenario goes through the application's own repositories and Supabase client.
// Two "devices" are two independent copies of the data layer (own save queue), signed in as the
// same user, writing in parallel. Scenario weeks live in 2031 and are removed afterwards.
const assert = require("node:assert/strict");
const path = require("node:path");

const YEAR = 2031;
const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const FAULT = "FALLO-SIMULADO";
const fullWeek = (dish) => DAY_NAMES.map((day) => ({ day, date: "", lunch: dish + " " + day, dinner: "LIBRE" }));

// A fresh copy of the data layer behaves like another tab or device: its own save queue.
function freshRepos() {
  for (const key of Object.keys(require.cache)) {
    if (/src[\\/]lib[\\/](data[\\/](repositories|sync)|supabase[\\/]weeks)\.ts$/.test(key)) delete require.cache[key];
  }
  return require("../src/lib/data/repositories.ts");
}

async function runWeekWriteTests({ check: baseCheck, sql, id, supabase }) {
  // B4_DEBUG=1 prints what was observed (synthetic rows only) when a scenario fails.
  let observed = null;
  const check = (name, fn) => baseCheck(name, () => {
    try { fn(); } catch (error) {
      if (process.env.B4_DEBUG) console.error("  observed:", JSON.stringify(observed), error.message.split("\n")[0]);
      throw error;
    }
  });
  const { createDevice, useDevice } = require(path.join(__dirname, "../tests/helpers/fake-browser.cjs"));
  const userA = id("0", 1);
  const asA = { scope: "u_" + userA, userId: userA };
  const week = (n) => ({ isoYear: YEAR, isoWeek: n });
  const remoteRows = (n) => JSON.parse(sql(
    "SELECT coalesce(json_agg(json_build_object('id',d.id,'position',d.position,'day',d.day_name,'lunch',d.lunch_dish_name) ORDER BY d.position, d.id),'[]') " +
    "FROM public.weeks w JOIN public.week_days d ON d.week_id=w.id WHERE w.user_id='" + userA + "' AND w.iso_year=" + YEAR + " AND w.iso_week=" + n + ";").trim());
  const weekCount = (n) => Number(sql("SELECT count(*) FROM public.weeks WHERE user_id='" + userA + "' AND iso_year=" + YEAR + " AND iso_week=" + n + ";").trim());
  const sameDishFamily = (rows) => new Set(rows.map((row) => row.lunch.split(" ")[0])).size === 1;
  const cleanup = () => sql("DELETE FROM public.weeks WHERE user_id='" + userA + "' AND iso_year=" + YEAR + ";");
  const restoreDevice = useDevice(createDevice());
  const freshDevice = () => window.localStorage.clear();

  try {
    await supabase.auth.signOut({ scope: "local" });
    await supabase.auth.signInWithPassword({ email: "fixture-1@example.invalid", password: "Local-fixture-only-2026!" });
    cleanup();

    // 1. A failure between removing the old days and writing the new ones keeps the previous week.
    // Simulated inside the database: a temporary trigger rejects one dish of the new week.
    sql("CREATE OR REPLACE FUNCTION public.b4_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN " +
      "IF NEW.lunch_dish_name LIKE '" + FAULT + "%' THEN RAISE EXCEPTION 'b4 simulated failure'; END IF; RETURN NEW; END $$;" +
      "CREATE TRIGGER b4_test_fault BEFORE INSERT OR UPDATE ON public.week_days FOR EACH ROW EXECUTE FUNCTION public.b4_test_fault();");
    try {
      freshDevice();
      let repos = freshRepos();
      const first = await repos.saveWeek(asA, week(10), fullWeek("Base"), { overwrite: true });
      const broken = fullWeek("Nuevo").map((day) => (day.day === "Jueves" ? { ...day, lunch: FAULT } : day));
      repos = freshRepos();
      const failed = await repos.saveWeek(asA, week(10), broken, { overwrite: true });
      const rows = remoteRows(10);
      observed = { first: first.status, failed: failed.status, days: rows.length };
      check("B4 writes: a failure halfway through replacing a week leaves the previous week intact", () => {
        assert.equal(first.status, "synced");
        assert.notEqual(failed.status, "synced");
        assert.equal(rows.length, 7);
        assert.ok(rows.every((row) => row.lunch.startsWith("Base ")));
      });
    } finally {
      sql("DROP TRIGGER IF EXISTS b4_test_fault ON public.week_days; DROP FUNCTION IF EXISTS public.b4_test_fault();");
    }

    // 2. Two devices save the same week in parallel, both based on the same version.
    for (let round = 0; round < 3; round++) {
      freshDevice();
      const base = freshRepos();
      await base.saveWeek(asA, week(11), fullWeek("Base"), { overwrite: true });
      await base.loadWeek(asA, week(11));
      const [one, two] = await Promise.all([
        freshRepos().saveWeek(asA, week(11), fullWeek("Uno")),
        freshRepos().saveWeek(asA, week(11), fullWeek("Dos")),
      ]);
      const rows = remoteRows(11);
      observed = { statuses: [one.status, two.status], days: rows.length, lunches: rows.map((row) => row.lunch.split(" ")[0]) };
      check("B4 writes: two parallel saves on the same version → one wins, the other conflicts, never a mix (round " + (round + 1) + ")", () => {
        assert.deepEqual([one.status, two.status].sort(), ["conflict", "synced"]);
        assert.equal(rows.length, 7);
        assert.deepEqual(rows.map((row) => row.position), [0, 1, 2, 3, 4, 5, 6]);
        assert.ok(sameDishFamily(rows));
        assert.equal(rows[0].lunch.split(" ")[0], one.status === "synced" ? "Uno" : "Dos");
      });
    }

    // 3. Double click on «Usar este menú» (two tabs, same request): one week, seven days, both succeed.
    for (let round = 0; round < 3; round++) {
      freshDevice();
      await freshRepos().saveWeek(asA, week(12), fullWeek("Base"), { overwrite: true });
      const requestKey = require("node:crypto").randomUUID();
      const results = await Promise.all([1, 2].map(() =>
        freshRepos().saveWeek(asA, week(12), fullWeek("Menu"), { overwrite: true, requestKey })));
      const rows = remoteRows(12);
      observed = { statuses: results.map((result) => result.status), weeks: weekCount(12), days: rows.length };
      check("B4 writes: double click on «Usar este menú» applies the menu once (round " + (round + 1) + ")", () => {
        assert.deepEqual(results.map((result) => result.status), ["synced", "synced"]);
        assert.equal(weekCount(12), 1);
        assert.equal(rows.length, 7);
        assert.deepEqual(rows.map((row) => row.position), [0, 1, 2, 3, 4, 5, 6]);
        assert.ok(rows.every((row) => row.lunch.startsWith("Menu ")));
      });
    }

    // 4. Two devices create the same, still empty, calendar week at once.
    for (let round = 0; round < 3; round++) {
      cleanup();
      freshDevice();
      const [one, two] = await Promise.all([
        freshRepos().saveWeek(asA, week(13), fullWeek("Uno")),
        freshRepos().saveWeek(asA, week(13), fullWeek("Dos")),
      ]);
      const rows = remoteRows(13);
      observed = { statuses: [one.status, two.status], weeks: weekCount(13), days: rows.length };
      check("B4 writes: concurrent creation of the same week → one week, the other device gets a conflict (round " + (round + 1) + ")", () => {
        assert.deepEqual([one.status, two.status].sort(), ["conflict", "synced"]);
        assert.equal(weekCount(13), 1);
        assert.equal(rows.length, 7);
        assert.ok(sameDishFamily(rows));
      });
    }

    // 5. Editing one dish touches only that slot: the other days keep their rows.
    freshDevice();
    let repos = freshRepos();
    await repos.saveWeek(asA, week(14), fullWeek("Base"), { overwrite: true });
    const loaded = await repos.loadWeek(asA, week(14));
    const before = remoteRows(14);
    const edited = loaded.data.map((day) => (day.day === "Martes" ? { ...day, lunch: "Lentejas" } : day));
    const editResult = repos.saveWeekSlot
      ? await repos.saveWeekSlot(asA, week(14), edited, { day: "Martes", meal: "lunch" })
      : await repos.saveWeek(asA, week(14), edited);
    const after = remoteRows(14);
    observed = { status: editResult.status, keptRowIds: after.filter((row) => before.some((old) => old.id === row.id)).length };
    check("B4 writes: editing one dish updates only that slot and keeps every other day row", () => {
      assert.equal(editResult.status, "synced");
      assert.equal(after.find((row) => row.day === "Martes").lunch, "Lentejas");
      assert.deepEqual(after.map((row) => row.id), before.map((row) => row.id));
      assert.deepEqual(after.filter((row) => row.day !== "Martes"), before.filter((row) => row.day !== "Martes"));
    });

    // 6. A generation request of another user is an error, never silently dropped (old insert retry).
    cleanup();
    freshDevice();
    const foreign = await freshRepos().saveWeek(asA, week(15), fullWeek("Ajeno"), { overwrite: true, generationRequestId: id("6", 2) });
    observed = { status: foreign.status, weeks: weekCount(15) };
    check("B4 writes: a week linked to another user's generation request is refused, not saved unlinked", () => {
      assert.notEqual(foreign.status, "synced");
      assert.equal(weekCount(15), 0);
    });

    // 7. Rollout: migration applied while main still serves the previous client (delete → insert
    // directly on week_days). That frozen client keeps creating and replacing weeks, every write
    // bumps the version, and a new-client tab holding an older version gets a conflict.
    cleanup();
    freshDevice();
    const legacy = require("../tests/fixtures/legacy-week-client-806738e.ts");
    const { weekDaysToSupabaseWeek } = require("../src/lib/weekStorage.ts");
    const legacySave = (dish, days = fullWeek(dish)) => legacy.saveWeekToSupabase(
      { ...weekDaysToSupabaseWeek(days), isoYear: YEAR, isoWeek: 16 },
      { userId: userA, isoYear: YEAR, isoWeek: 16, replaceExisting: true });
    const versionOf = () => Number(sql("SELECT version FROM public.weeks WHERE user_id='" + userA + "' AND iso_year=" + YEAR + " AND iso_week=16;").trim());
    const legacyErrors = [];
    const attempt = async (fn) => { try { return await fn(); } catch (error) { legacyErrors.push(error.message); return null; } };
    const createdId = await attempt(() => legacySave("Viejo"));
    const afterCreate = { rows: remoteRows(16), version: versionOf() };
    repos = freshRepos();
    const newTab = await repos.loadWeek(asA, week(16));
    const replacedId = await attempt(() => legacySave("Reemplazo", fullWeek("Reemplazo").filter((day) => day.day === "Miércoles")));
    const afterReplace = { rows: remoteRows(16), version: versionOf() };
    const staleSave = await repos.saveWeek(asA, week(16), fullWeek("Pestaña"));
    const reloaded = await freshRepos().loadWeek(asA, week(16));
    const freshSave = await freshRepos().saveWeek(asA, week(16), fullWeek("Nuevo"));
    const afterNew = remoteRows(16);
    const legacyAgainId = await attempt(() => legacySave("Otra vez"));
    observed = { legacyErrors, afterCreate, afterReplace, staleSave: staleSave.status, freshSave: freshSave.status, afterNew: afterNew.length };
    check("B4 rollout: the previous client (806738e) still creates and replaces weeks after the migration", () => {
      assert.deepEqual(legacyErrors, []);
      assert.ok(createdId && replacedId === createdId && legacyAgainId === createdId);
      assert.equal(afterCreate.rows.length, 7);
      assert.equal(afterCreate.version, 1);
      assert.deepEqual(afterReplace.rows.map((row) => [row.position, row.day, row.lunch]), [[2, "Miércoles", "Reemplazo Miércoles"]]);
      assert.ok(afterReplace.version > afterCreate.version);
      assert.equal(remoteRows(16).length, 7);
      assert.ok(remoteRows(16).every((row) => row.lunch.startsWith("Otra vez ")));
    });
    check("B4 rollout: a previous-client write is a new version; a tab loaded before it gets a conflict, a reloaded one saves", () => {
      assert.equal(newTab.data.length, 7);
      assert.equal(staleSave.status, "conflict");
      assert.equal(reloaded.data.length, 1);
      assert.equal(freshSave.status, "synced");
      assert.ok(afterNew.every((row) => row.lunch.startsWith("Nuevo ")));
    });
  } finally {
    cleanup();
    restoreDevice();
    freshRepos();
  }
}

module.exports = { runWeekWriteTests };
