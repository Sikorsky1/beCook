// C1 (roadmap step 16) against the real local Supabase: each week freezes the food context it was
// planned with (servings + restrictions version) right after apply_week, through the application's
// own repositories; the server reads the profile with the caller's session; RLS and grants.
// Scenario weeks live in 2032 and are removed afterwards; fixture A's profile is restored.
const assert = require("node:assert/strict");
const path = require("node:path");

const YEAR = 2032;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const fullWeek = (dish) => DAY_NAMES.map((day) => ({ day, date: "", lunch: dish + " " + day, dinner: "LIBRE" }));

function freshRepos() {
  for (const key of Object.keys(require.cache)) {
    if (/src[\\/]lib[\\/](data[\\/](repositories|sync)|supabase[\\/]weeks)\.ts$/.test(key)) delete require.cache[key];
  }
  return require("../src/lib/data/repositories.ts");
}

async function runFoodContextTests({ check, sql, id, api, createClient, supabase }) {
  const { createDevice, useDevice } = require(path.join(__dirname, "../tests/helpers/fake-browser.cjs"));
  const serverContext = require("../src/lib/server/food-context.ts");
  const { getShoppingSignature } = require("../src/lib/shoppingListStorage.ts");
  const legacyWeeks = require("../tests/fixtures/legacy-week-client-806738e.ts");
  const userA = id("0", 1);
  const profileA = id("1", 1);
  const asA = { scope: "u_" + userA, userId: userA };
  const week = (n) => ({ isoYear: YEAR, isoWeek: n });
  const profileSnapshot = sql("SELECT row_to_json(p) FROM public.profiles p WHERE id='" + profileA + "';").trim();
  const contextRow = (n) => JSON.parse(sql(
    "SELECT coalesce((SELECT row_to_json(c) FROM public.week_food_contexts c JOIN public.weeks w ON w.id=c.week_id " +
    "WHERE w.user_id='" + userA + "' AND w.iso_year=" + YEAR + " AND w.iso_week=" + n + "), 'null');").trim());
  const weekVersion = (n) => Number(sql("SELECT version FROM public.weeks WHERE user_id='" + userA + "' AND iso_year=" + YEAR + " AND iso_week=" + n + ";").trim());
  const cleanup = () => {
    sql("DELETE FROM public.weeks WHERE user_id='" + userA + "' AND iso_year=" + YEAR + ";");
    sql("DELETE FROM public.menu_generation_requests WHERE user_id='" + userA + "' AND free_text_prompt='c1-db-test';");
  };
  const restoreProfile = () => sql(
    "UPDATE public.profiles p SET household_size=s.household_size, dietary_restrictions=s.dietary_restrictions, allergies=s.allergies, " +
    "other_allergies=s.other_allergies, disliked_foods=s.disliked_foods FROM json_populate_record(NULL::public.profiles, '" +
    profileSnapshot.replace(/'/g, "''") + "'::json) s WHERE p.id=s.id;");
  const userB = createClient(api.url, api.key, options);
  const anon = createClient(api.url, api.key, options);
  const restoreDevice = useDevice(createDevice());

  try {
    await supabase.auth.signOut({ scope: "local" });
    await supabase.auth.signInWithPassword({ email: "fixture-1@example.invalid", password: "Local-fixture-only-2026!" });
    await userB.auth.signInWithPassword({ email: "fixture-2@example.invalid", password: "Local-fixture-only-2026!" });
    const token = (await supabase.auth.getSession()).data.session.access_token;
    cleanup();

    // 1. Generated menu: «Usar este menú» → apply_week + freeze, servings of the generation request.
    const requestId = sql("INSERT INTO public.menu_generation_requests (user_id, profile_id, people_count, status, free_text_prompt) VALUES ('" +
      userA + "','" + profileA + "',4,'generated','c1-db-test') RETURNING id;").trim().split("\n")[0];
    let repos = freshRepos();
    const applied = await repos.saveWeek(asA, week(1), fullWeek("Generado"), { overwrite: true, generationRequestId: requestId, requestKey: "c1c1c1c1-0000-4000-8000-000000000001" });
    const generated = contextRow(1);
    check("C1 freeze: a generated menu keeps its servings and the saved profile's restrictions", () => {
      assert.equal(applied.status, "synced");
      assert.equal(generated.servings, 4);
      assert.equal(generated.servings_source, "generation");
      assert.equal(generated.household_size, 1);
      assert.deepEqual(generated.restrictions, { allergies: ["nuts"], dislikedFoods: ["rábano ficticio"], otherAllergies: "", dietaryRestrictions: ["vegetarian"] });
      assert.match(generated.context_version, /^fc1:[0-9a-f]{32}$/);
      assert.equal(generated.request_key, "c1c1c1c1-0000-4000-8000-000000000001");
    });
    check("C1 freeze: never bumps weeks.version (B4 versions and idempotency unchanged)", () => assert.equal(weekVersion(1), 1));

    // 2. Imported menu (no generation request): servings from the profile's household.
    repos = freshRepos();
    await repos.saveWeek(asA, week(2), fullWeek("Importado"), { overwrite: true });
    check("C1 freeze: an imported menu takes the household of the saved profile", () => {
      const row = contextRow(2);
      assert.equal(row.servings, 1);
      assert.equal(row.servings_source, "profile");
      assert.equal(row.context_version, generated.context_version, "same profile, same version");
    });

    // 3. Dish edit: the week keeps its context.
    const before = contextRow(1);
    repos = freshRepos();
    await repos.loadWeek(asA, week(1));
    const edited = fullWeek("Generado").map((day) => (day.day === "Martes" ? { ...day, lunch: "Pisto con huevo" } : day));
    const slot = await repos.saveWeekSlot(asA, week(1), edited, { day: "Martes", meal: "lunch" });
    check("C1 freeze: editing one dish keeps the frozen context", () => {
      assert.equal(slot.status, "synced");
      assert.deepEqual(contextRow(1), before);
    });

    // 4. Idempotency and order of freezes (called directly as the client does).
    const rpcFreeze = (key, client = supabase, n = 1) => client.rpc("freeze_week_food_context", { p_iso_year: YEAR, p_iso_week: n, p_request_key: key, p_generation_request_id: null });
    const repeat = await rpcFreeze("c1c1c1c1-0000-4000-8000-000000000001");
    const unknown = await rpcFreeze("c1c1c1c1-0000-4000-8000-0000000000ff");
    repos = freshRepos();
    await repos.saveWeek(asA, week(1), fullWeek("Nuevo"), { overwrite: true, requestKey: "c1c1c1c1-0000-4000-8000-000000000002" });
    const late = await rpcFreeze("c1c1c1c1-0000-4000-8000-000000000001");
    check("C1 freeze: repeated → duplicate; foreign key → not_applied; a late older apply never replaces a newer one", () => {
      assert.equal(repeat.data.status, "duplicate");
      assert.equal(unknown.data.status, "not_applied");
      assert.equal(late.data.status, "superseded");
      const row = contextRow(1);
      assert.equal(row.request_key, "c1c1c1c1-0000-4000-8000-000000000002");
      assert.equal(row.servings, 1, "replaced by an apply without generation request: household");
    });

    // 5. Status: the profile changes after the week is frozen.
    const status = async () => (await supabase.rpc("week_food_context_status", { p_iso_year: YEAR, p_iso_week: 2 })).data;
    const unchanged = await status();
    sql("UPDATE public.profiles SET allergies=ARRAY['nuts','gluten'] WHERE id='" + profileA + "';");
    const allergyAdded = await status();
    sql("UPDATE public.profiles SET allergies=ARRAY['nuts'], household_size=3 WHERE id='" + profileA + "';");
    const household = await status();
    sql("UPDATE public.profiles SET disliked_foods='RÁBANO  ficticio', household_size=1 WHERE id='" + profileA + "';");
    const sameCanonical = await status();
    check("C1 status: restrictions and household changes are detected; spacing and case are not changes", () => {
      assert.deepEqual([unchanged.restrictionsChanged, unchanged.householdChanged], [false, false]);
      assert.equal(unchanged.frozen.servings, 1);
      assert.deepEqual([allergyAdded.restrictionsChanged, allergyAdded.householdChanged], [true, false]);
      assert.deepEqual([household.restrictionsChanged, household.householdChanged], [false, true]);
      assert.equal(household.current.householdSize, 3);
      assert.deepEqual([sameCanonical.restrictionsChanged, sameCanonical.householdChanged], [false, false]);
    });
    restoreProfile();

    // 6. Server side: the AI routes read the same context with the caller's token.
    const current = await serverContext.readProfileFoodContext(token);
    const weekRead = await serverContext.readWeekFoodContext(token, week(1));
    check("C1 server: the profile and the week context are read with the caller's session", () => {
      assert.equal(current.ok, true);
      assert.equal(current.value.version, generated.context_version);
      assert.deepEqual(current.value.restrictions.allergies, ["nuts"]);
      assert.equal(weekRead.ok, true);
      assert.equal(weekRead.value.frozen.version, generated.context_version);
    });

    // 7. Shopping: the account week carries its context; the signature changes with it.
    const shoppingState = await freshRepos().shoppingRemote(asA, week(1)).fetch();
    check("C1 shopping: the account week gives its frozen servings and version for the signature", () => {
      assert.deepEqual(shoppingState.week.foodContext, { servings: 1, version: generated.context_version });
      assert.notEqual(getShoppingSignature(week(1), shoppingState.week.days, shoppingState.week.foodContext), getShoppingSignature(week(1), shoppingState.week.days));
    });

    // 8. Permissions.
    const bRead = await userB.from("week_food_contexts").select("week_id").in("week_id", [generated.week_id]);
    const bFreeze = await rpcFreeze("c1c1c1c1-0000-4000-8000-000000000002", userB);
    const bStatus = (await userB.rpc("week_food_context_status", { p_iso_year: YEAR, p_iso_week: 1 })).data;
    const anonRead = await anon.from("week_food_contexts").select("week_id");
    const anonRpc = await anon.rpc("current_food_context");
    const direct = await supabase.from("week_food_contexts").update({ servings: 6 }).eq("week_id", generated.week_id).select("week_id");
    const insert = await supabase.from("week_food_contexts").insert({ week_id: id("9", 9), user_id: userA, servings: 2, servings_source: "default", context_version: "x", request_key: id("9", 9) });
    check("C1 RLS: another user sees and freezes nothing of A; anon has no access; no direct writes", () => {
      assert.deepEqual(bRead.data, []);
      assert.equal(bFreeze.data.status, "not_applied");
      assert.equal(bStatus.week, false);
      assert.equal(bStatus.frozen, null);
      assert.ok(anonRead.error, "anon cannot read the table");
      assert.ok(anonRpc.error, "anon cannot call current_food_context");
      assert.ok(direct.error || direct.data.length === 0, "authenticated cannot update");
      assert.ok(insert.error, "authenticated cannot insert");
      assert.equal(contextRow(1).servings, 1);
    });

    // 9. Rollout: the client of main (no freeze) keeps applying weeks; they read as weeks before C1.
    let legacyError = null;
    try {
      await legacyWeeks.saveWeekToSupabase({ title: "", isoYear: YEAR, isoWeek: 3, days: fullWeek("Legado").map((day) => ({
        dayName: day.day, lunch: { status: "planned", dishName: day.lunch }, dinner: { status: "free", dishName: "" } })) }, { userId: userA });
    } catch (error) { legacyError = error; }
    const legacyStatus = (await supabase.rpc("week_food_context_status", { p_iso_year: YEAR, p_iso_week: 3 })).data;
    check("C1 rollout: main's client still saves weeks; without a context they keep the legacy behaviour", () => {
      assert.equal(legacyError, null);
      assert.equal(legacyStatus.week, true);
      assert.equal(legacyStatus.frozen, null);
      assert.equal(legacyStatus.restrictionsChanged, false);
    });
  } finally {
    restoreProfile();
    cleanup();
    restoreDevice();
    await userB.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
}

module.exports = { runFoodContextTests };
