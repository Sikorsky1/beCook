// C2 (roadmap step 17) against the real local Supabase: versioned dish cards, week slot links,
// RLS and grants, the RPCs through the application's own adapters, and the rollout with the client
// deployed before C2. Scenario weeks live in 2034 and every recipe created here is removed after.
const assert = require("node:assert/strict");
const path = require("node:path");

const YEAR = 2034;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const TEST_CATALOG_KEY = "c2-db-test";
const card = (steps = ["Cocer las lentejas con la verdura."]) => ({
  baseServings: 2,
  totalMinutes: 50,
  ingredients: [
    { name: "lentejas", quantity: 200, unit: "g", category: "despensa", optional: false },
    { name: "zanahoria", quantity: 2, unit: "unidades", category: "frutería", optional: false },
  ],
  steps,
  possibleAllergens: [],
});

function freshRepos() {
  for (const key of Object.keys(require.cache)) {
    if (/src[\\/]lib[\\/](data[\\/](repositories|sync)|supabase[\\/](weeks|recipes)|applyWeek)\.ts$/.test(key)) delete require.cache[key];
  }
  return require("../src/lib/data/repositories.ts");
}

async function runRecipeCardTests({ check, sql, id, api, createClient, supabase, outcome }) {
  const { createDevice, useDevice } = require(path.join(__dirname, "../tests/helpers/fake-browser.cjs"));
  const recipes = require("../src/lib/supabase/recipes.ts");
  const legacyWeeks = require("../tests/fixtures/legacy-week-client-02aa5b8.ts");
  const userA = id("0", 1);
  const userBId = id("0", 2);
  const asA = { scope: "u_" + userA, userId: userA };
  const week = (n) => ({ isoYear: YEAR, isoWeek: n });
  const days = (lunch, dinner = "LIBRE") => DAY_NAMES.slice(0, 2).map((day) => ({ day, date: "", lunch: day === "Lunes" ? lunch : "Pisto " + day, dinner }));
  const slotRow = (n, user = userA) => JSON.parse(sql(
    "SELECT coalesce((SELECT json_build_object('lunch', d.lunch_dish_name, 'lunchRecipe', d.lunch_recipe_version_id, 'dinnerRecipe', d.dinner_recipe_version_id, 'version', w.version) " +
    "FROM public.weeks w JOIN public.week_days d ON d.week_id=w.id WHERE w.user_id='" + user + "' AND w.iso_year=" + YEAR + " AND w.iso_week=" + n + " AND d.position=0), 'null');").trim());
  const cleanup = () => {
    sql("DELETE FROM public.weeks WHERE user_id IN ('" + userA + "','" + userBId + "') AND iso_year=" + YEAR + ";");
    // Cascade from the recipe is the only way a version is ever removed (the guard allows it).
    sql("DELETE FROM public.recipes WHERE owner_user_id IN ('" + userA + "','" + userBId + "') OR catalog_key='" + TEST_CATALOG_KEY + "';");
  };
  const userB = createClient(api.url, api.key, options);
  const anon = createClient(api.url, api.key, options);
  const admin = createClient(api.url, api.serviceKey, options);
  const restoreDevice = useDevice(createDevice());
  const newUsers = [];

  try {
    await supabase.auth.signOut({ scope: "local" });
    await supabase.auth.signInWithPassword({ email: "fixture-1@example.invalid", password: "Local-fixture-only-2026!" });
    await userB.auth.signInWithPassword({ email: "fixture-2@example.invalid", password: "Local-fixture-only-2026!" });
    cleanup();

    // 1. Catalogue identities: readable by everyone, 27 of them, no reviewed version invented.
    const anonCatalog = await anon.from("recipes").select("catalog_key,title,origin");
    const anonVersions = await anon.from("recipe_versions").select("id");
    const catalogIndex = await recipes.getCatalogReviewedVersionsFromSupabase(anon);
    check("C2 catalogue: 27 identities readable by guests, without any reviewed card", () => {
      assert.equal(anonCatalog.error, null);
      assert.equal(anonCatalog.data.length, 27);
      assert.ok(anonCatalog.data.every((row) => row.origin === "catalog" && row.catalog_key.startsWith("nutri-")));
      assert.deepEqual(anonVersions.data, []);
      assert.equal(catalogIndex.size, 0);
    });

    // 2. save_inferred_recipe through the application adapter (the route uses the same one).
    const first = await recipes.saveInferredRecipeInSupabase(supabase, { title: "Lentejas  estofadas", card: card(), model: "test-model", requestKey: "c2c2c2c2-0000-4000-8000-000000000001" });
    const same = await recipes.saveInferredRecipeInSupabase(supabase, { title: "lentejas estofadas", card: card(), model: null, requestKey: "c2c2c2c2-0000-4000-8000-000000000002" });
    const changed = await recipes.saveInferredRecipeInSupabase(supabase, { title: "Lentejas estofadas", card: card(["Sofreír.", "Cocer."]), model: null, requestKey: "c2c2c2c2-0000-4000-8000-000000000003" });
    const repeated = await recipes.saveInferredRecipeInSupabase(supabase, { title: "Otra cosa", card: card(), model: null, requestKey: "c2c2c2c2-0000-4000-8000-000000000001" });
    const stored = JSON.parse(sql("SELECT json_agg(json_build_object('owner', r.owner_user_id, 'origin', r.origin, 'version', v.version, 'status', v.review_status, 'model', v.inferred_model, 'hash', v.content_hash) ORDER BY v.version) " +
      "FROM public.recipe_versions v JOIN public.recipes r ON r.id=v.recipe_id WHERE r.owner_user_id='" + userA + "';").trim());
    check("C2 save_inferred_recipe: always the caller's own inferred card; same title reused, same content not duplicated", () => {
      assert.equal(first.status, "created");
      assert.equal(same.status, "existing");
      assert.equal(same.versionId, first.versionId);
      assert.equal(changed.status, "new_version");
      assert.equal(repeated.status, "duplicate");
      assert.equal(repeated.versionId, first.versionId);
      assert.equal(stored.length, 2);
      assert.ok(stored.every((row) => row.owner === userA && row.origin === "ai" && row.status === "inferred"));
      assert.equal(stored[0].model, "test-model");
      assert.match(stored[0].hash, /^rc1:[0-9a-f]{32}$/);
      assert.notEqual(stored[0].hash, stored[1].hash);
    });

    // 2b. The route's lookup of an own card by title, through the real PostgREST; limits and labels.
    const ownLookup = await recipes.getOwnRecipeCardByTitleFromSupabase(supabase, userA, "LENTEJAS  estofadas");
    const bLookup = await recipes.getOwnRecipeCardByTitleFromSupabase(userB, userBId, "Lentejas estofadas");
    const bAsA = await recipes.getOwnRecipeCardByTitleFromSupabase(userB, userA, "Lentejas estofadas");
    const noCard = await recipes.getOwnRecipeCardByTitleFromSupabase(supabase, userA, "Pollo al limón");
    const extra = [];
    for (let n = 3; n <= 6; n++) {
      extra.push(await supabase.rpc("save_inferred_recipe", { p_title: "Lentejas estofadas", p_card: { ...card(["Paso " + n + "."]), model: n === 3 ? "<b>no es un modelo</b>" : "gpt-test" }, p_request_key: "c2c2c2c2-0000-4000-8000-00000000009" + n }));
    }
    const badModel = sql("SELECT inferred_model IS NULL FROM public.recipe_versions WHERE request_key='c2c2c2c2-0000-4000-8000-000000000093';").trim();
    check("C2 own card by title via PostgREST: latest version of the caller's recipe only; 5 versions per recipe; odd model labels ignored", () => {
      assert.equal(ownLookup?.versionId, changed.versionId);
      assert.equal(ownLookup.version, 2);
      assert.equal(bLookup, null);
      assert.equal(bAsA, null, "RLS: B never reads A's card even asking for it");
      assert.equal(noCard, null);
      assert.deepEqual(extra.slice(0, 3).map((r) => r.data?.version), [3, 4, 5]);
      assert.equal(extra[3].error?.code, "54000");
      assert.equal(badModel, "t");
    });

    // 3. Permissions: other users and guests read nothing of A; nobody writes the tables directly.
    const bRead = await userB.from("recipe_versions").select("id").eq("id", first.versionId);
    const anonRead = await anon.from("recipe_versions").select("id").eq("id", first.versionId);
    const anonSave = await anon.rpc("save_inferred_recipe", { p_title: "Pisto", p_card: card(), p_request_key: "c2c2c2c2-0000-4000-8000-0000000000a1" });
    const anonLink = await anon.rpc("update_week_slot_recipe", { p_iso_year: YEAR, p_iso_week: 1, p_position: 0, p_meal: "lunch", p_recipe_version_id: null, p_expected_version: 1, p_request_key: "c2c2c2c2-0000-4000-8000-0000000000a2" });
    const directInsert = await supabase.from("recipes").insert({ title: "Directo", origin: "ai", owner_user_id: userA });
    const directVersion = await supabase.from("recipe_versions").insert({ recipe_id: id("9", 9), version: 9, base_servings: 2, ingredients: card().ingredients, steps: card().steps, review_status: "reviewed", content_hash: "x" });
    const directUpdate = await supabase.from("recipes").update({ title: "Cambiado" }).eq("owner_user_id", userA).select("id");
    const badCard = await supabase.rpc("save_inferred_recipe", { p_title: "Pisto", p_card: { ...card(), possibleAllergens: ["chocolate"] }, p_request_key: "c2c2c2c2-0000-4000-8000-0000000000a3" });
    const reviewedField = await supabase.rpc("save_inferred_recipe", { p_title: "Pisto", p_card: { ...card(), review_status: "reviewed" }, p_request_key: "c2c2c2c2-0000-4000-8000-0000000000a4" });
    check("C2 RLS: own cards are private; guests cannot write; no direct writes; a user can never create a reviewed card", () => {
      assert.deepEqual(bRead.data, []);
      assert.deepEqual(anonRead.data, []);
      assert.equal(anonSave.error?.code, "42501");
      assert.equal(anonLink.error?.code, "42501");
      assert.ok(directInsert.error, "no INSERT grant on recipes");
      assert.ok(directVersion.error, "no INSERT grant on recipe_versions");
      assert.ok(directUpdate.error || directUpdate.data.length === 0, "no UPDATE");
      assert.equal(badCard.error?.code, "22023");
      assert.equal(reviewedField.error?.code, "22023", "an unknown key (review_status) is refused, never honoured");
    });

    // 4. Versions are immutable, reviewed only for the catalogue (even for the database owner).
    const userRecipe = sql("SELECT recipe_id FROM public.recipe_versions WHERE id='" + first.versionId + "';").trim();
    const guarded = (statement) => {
      try { sql(statement); return "accepted"; } catch { return "refused"; }
    };
    check("C2 versions: no UPDATE or direct DELETE; reviewed only for catalogue recipes, inferred only for users'", () => {
      assert.equal(guarded("UPDATE public.recipe_versions SET base_servings=3 WHERE id='" + first.versionId + "';"), "refused");
      assert.equal(guarded("DELETE FROM public.recipe_versions WHERE id='" + first.versionId + "';"), "refused");
      assert.equal(guarded("UPDATE public.recipes SET title='Otro' WHERE id='" + userRecipe + "';"), "refused");
      assert.equal(guarded("INSERT INTO public.recipe_versions (recipe_id, version, base_servings, ingredients, steps, review_status, content_hash) VALUES ('" +
        userRecipe + "', 9, 2, '" + JSON.stringify(card().ingredients) + "', '[\"x\"]', 'reviewed', 'x');"), "refused");
      assert.equal(guarded("INSERT INTO public.recipe_versions (recipe_id, version, base_servings, ingredients, steps, review_status, content_hash) SELECT id, 1, 2, '" +
        JSON.stringify(card().ingredients) + "', '[\"x\"]', 'inferred', 'x' FROM public.recipes WHERE catalog_key='nutri-c34';"), "refused");
      assert.equal(sql("SELECT count(*) FROM public.recipe_versions WHERE id='" + first.versionId + "';").trim(), "1");
    });

    // 5. Linking through the application: a whole week, then one card link (version + 1), read back.
    let repos = freshRepos();
    await repos.saveWeek(asA, week(1), days("Lentejas estofadas", "Sopa"), { overwrite: true });
    const beforeLink = slotRow(1);
    repos = freshRepos();
    await repos.loadWeek(asA, week(1));
    const linkResult = await repos.saveWeekRecipe(asA, week(1), repos.readCachedWeek(asA, week(1)), { day: "Lunes", meal: "lunch" }, { versionId: changed.versionId });
    const afterLink = slotRow(1);
    repos = freshRepos();
    const reloaded = await repos.loadWeek(asA, week(1));
    const readCard = await recipes.getRecipeCardFromSupabase(changed.versionId, supabase);
    check("C2 link: update_week_slot_recipe links only that meal, bumps the week version and reads back as a card", () => {
      assert.equal(beforeLink.lunchRecipe, null, "a new menu without catalogue cards has none");
      assert.equal(linkResult.status, "synced");
      assert.equal(afterLink.lunchRecipe, changed.versionId);
      assert.equal(afterLink.dinnerRecipe, null);
      assert.equal(afterLink.version, beforeLink.version + 1);
      assert.deepEqual(reloaded.data.find((day) => day.day === "Lunes").lunchRecipe, { versionId: changed.versionId });
      assert.equal(readCard.reviewStatus, "inferred");
      assert.equal(readCard.version, 2);
      assert.deepEqual(readCard.steps, ["Sofreír.", "Cocer."]);
    });

    // 6. Dish edits: same title (spacing, case) keeps the card; another title clears it.
    repos = freshRepos();
    await repos.loadWeek(asA, week(1));
    let current = repos.readCachedWeek(asA, week(1));
    await repos.saveWeekSlot(asA, week(1), current.map((day) => (day.day === "Lunes" ? { ...day, lunch: "LENTEJAS  estofadas" } : day)), { day: "Lunes", meal: "lunch" });
    const keptRow = slotRow(1);
    current = repos.readCachedWeek(asA, week(1));
    await repos.saveWeekSlot(asA, week(1), current.map((day) => (day.day === "Lunes" ? { ...day, lunch: "Garbanzos con espinacas" } : day)), { day: "Lunes", meal: "lunch" });
    const clearedRow = slotRow(1);
    check("C2 edit: the card stays for the same dish and is cleared when the title changes (update_week_slot unchanged)", () => {
      assert.equal(keptRow.lunch, "LENTEJAS  estofadas");
      assert.equal(keptRow.lunchRecipe, changed.versionId);
      assert.equal(clearedRow.lunch, "Garbanzos con espinacas");
      assert.equal(clearedRow.lunchRecipe, null);
    });

    // 7. update_week_slot_recipe refuses a card for another dish, a stale version and another user's card.
    const rpcLink = (client, versionId, expected, key, n = 1) => client.rpc("update_week_slot_recipe", {
      p_iso_year: YEAR, p_iso_week: n, p_position: 0, p_meal: "lunch", p_recipe_version_id: versionId, p_expected_version: expected, p_request_key: key });
    const otherDish = await rpcLink(supabase, changed.versionId, clearedRow.version, "c2c2c2c2-0000-4000-8000-0000000000b1");
    const stale = await rpcLink(supabase, null, clearedRow.version - 1, "c2c2c2c2-0000-4000-8000-0000000000b2");
    await userB.rpc("apply_week", { p_iso_year: YEAR, p_iso_week: 1, p_days: [{ position: 0, day_name: "Lunes", lunch_status: "planned", lunch_dish_name: "Lentejas estofadas", dinner_status: "free", dinner_dish_name: "" }], p_request_key: "c2c2c2c2-0000-4000-8000-0000000000b4", p_expected_version: null });
    const bLinksA = await rpcLink(userB, changed.versionId, 1, "c2c2c2c2-0000-4000-8000-0000000000b5");
    const bApplyA = await userB.rpc("apply_week", { p_iso_year: YEAR, p_iso_week: 1, p_days: [{ position: 0, day_name: "Lunes", lunch_status: "planned", lunch_dish_name: "Lentejas estofadas", lunch_recipe_version_id: changed.versionId, dinner_status: "free", dinner_dish_name: "" }], p_request_key: "c2c2c2c2-0000-4000-8000-0000000000b6", p_expected_version: 1 });
    const bDirect = outcome(2, "UPDATE public.week_days d SET lunch_recipe_version_id='" + changed.versionId + "' FROM public.weeks w WHERE w.id=d.week_id AND w.user_id='" + userBId + "' AND w.iso_year=" + YEAR + " AND d.position=0");
    check("C2 link checks: another dish (22023), stale version (conflict), another user's card (23503, also directly)", () => {
      assert.equal(otherDish.error?.code, "22023");
      assert.equal(stale.data?.status, "conflict");
      assert.equal(bLinksA.error?.code, "22023", "B cannot even see A's card");
      assert.equal(bApplyA.error?.code, "23503");
      assert.equal(bDirect, "constraint:23503");
      assert.equal(slotRow(1, userBId).lunchRecipe, null);
    });

    // 8. apply_week: an explicit stale link for another title is dropped, not attached; free meals never keep one.
    const applied = await supabase.rpc("apply_week", { p_iso_year: YEAR, p_iso_week: 2, p_days: [
      { position: 0, day_name: "Lunes", lunch_status: "planned", lunch_dish_name: "Pisto manchego", lunch_recipe_version_id: changed.versionId, dinner_status: "free", dinner_dish_name: "", dinner_recipe_version_id: changed.versionId },
    ], p_request_key: "c2c2c2c2-0000-4000-8000-0000000000c1", p_expected_version: null });
    const freeCheck = outcome(1, "UPDATE public.week_days d SET dinner_status='free', dinner_dish_name='', dinner_recipe_version_id='" + changed.versionId + "' FROM public.weeks w WHERE w.id=d.week_id AND w.user_id='" + userA + "' AND w.iso_year=" + YEAR + " AND w.iso_week=2 AND d.position=0",
      "SELECT dinner_recipe_version_id IS NULL FROM public.week_days d JOIN public.weeks w ON w.id=d.week_id WHERE w.user_id='" + userA + "' AND w.iso_year=" + YEAR + " AND w.iso_week=2 AND d.position=0");
    const freeMeal = await supabase.rpc("update_week_slot_recipe", { p_iso_year: YEAR, p_iso_week: 2, p_position: 0, p_meal: "dinner", p_recipe_version_id: null, p_expected_version: slotRow(2).version, p_request_key: "c2c2c2c2-0000-4000-8000-0000000000b3" });
    check("C2 apply_week: a link for another title or a free meal is cleared, never attached to the wrong dish", () => {
      assert.equal(applied.error, null);
      assert.equal(freeMeal.data?.status, "conflict", "a free meal has no card to link");
      assert.equal(slotRow(2).lunchRecipe, null);
      assert.equal(slotRow(2).dinnerRecipe, null);
      assert.equal(freeCheck, "accepted");
    });

    // 9. A catalogue card with a reviewed version (inserted here by the database owner, as a future
    //    reviewed migration would): guests read it, «Usar receta del catálogo» links it, menus link it by exact title.
    sql("INSERT INTO public.recipes (catalog_key, title, origin) VALUES ('" + TEST_CATALOG_KEY + "', 'Prueba C2 revisada', 'catalog');" +
      "INSERT INTO public.recipe_versions (recipe_id, version, base_servings, total_minutes, ingredients, steps, possible_allergens, review_status, content_hash) " +
      "SELECT id, 1, 2, 30, '" + JSON.stringify(card().ingredients) + "', '[\"Paso revisado.\"]', '{celery}', 'reviewed', '' FROM public.recipes WHERE catalog_key='" + TEST_CATALOG_KEY + "';");
    const reviewedId = sql("SELECT v.id FROM public.recipe_versions v JOIN public.recipes r ON r.id=v.recipe_id WHERE r.catalog_key='" + TEST_CATALOG_KEY + "';").trim();
    const guestCard = await recipes.getRecipeCardFromSupabase(reviewedId, anon);
    const index = await recipes.getCatalogReviewedVersionsFromSupabase(anon);
    repos = freshRepos();
    const { applyMenuToWeek, resolveApplyWeekAttempt } = require("../src/lib/applyWeek.ts");
    const menu = days("prueba c2  revisada", "Sopa");
    const attempt = resolveApplyWeekAttempt(null, menu, "w3", () => "c2c2c2c2-0000-4000-8000-0000000000d1");
    await applyMenuToWeek({ identity: asA, isoWeek: week(3), weekDays: menu, attempt, confirmReplace: () => true, prepareShopping: async () => ({ status: "ready" }) });
    check("C2 catalogue card: readable by guests, indexed by title, linked by exact title when a menu is applied", () => {
      assert.equal(guestCard.reviewStatus, "reviewed");
      assert.deepEqual(guestCard.possibleAllergens, ["celery"]);
      assert.deepEqual(index.get("prueba c2 revisada"), { versionId: reviewedId });
      assert.equal(slotRow(3).lunchRecipe, reviewedId);
    });

    // 10. Rollout: the client deployed before C2 (02aa5b8) applies weeks without the new keys and edits dishes.
    let legacyError = null;
    const legacyDays = (lunch) => [{ dayName: "Lunes", lunch: { status: "planned", dishName: lunch }, dinner: { status: "planned", dishName: "Sopa" } },
      { dayName: "Martes", lunch: { status: "planned", dishName: "Pisto Martes" }, dinner: { status: "free", dishName: "" } }];
    const v3 = slotRow(3).version;
    let sameTitle, otherTitle;
    try {
      sameTitle = await legacyWeeks.applyWeekInSupabase({ isoYear: YEAR, isoWeek: 3, week: { days: legacyDays("prueba c2  revisada") }, requestKey: "c2c2c2c2-0000-4000-8000-0000000000e1", expectedVersion: v3 });
    } catch (error) { legacyError = error; }
    const keptByLegacy = slotRow(3);
    try {
      otherTitle = await legacyWeeks.updateWeekSlotInSupabase({ isoYear: YEAR, isoWeek: 3, dayName: "Lunes", meal: "lunch", slot: { status: "planned", dishName: "Pisto" }, expectedVersion: keptByLegacy.version, requestKey: "c2c2c2c2-0000-4000-8000-0000000000e2" });
    } catch (error) { legacyError = error; }
    const clearedByLegacy = slotRow(3);
    check("C2 rollout: the previous client keeps working; it never drops a card of an unchanged dish nor leaves one on another dish", () => {
      assert.equal(legacyError, null);
      assert.equal(sameTitle.status, "applied");
      assert.equal(keptByLegacy.lunchRecipe, reviewedId);
      assert.equal(otherTitle.status, "applied");
      assert.equal(clearedByLegacy.lunchRecipe, null);
    });

    // 11. A version in use is never deleted, but deleting its owner's account still works.
    const email = `c2-cards-${Date.now()}@example.invalid`;
    const password = "Local-recipes-only-2026!";
    const temp = createClient(api.url, api.key, options);
    const signup = await temp.auth.signUp({ email, password });
    const tempId = signup.data.user?.id;
    if (tempId) newUsers.push(tempId);
    const tempSaved = await recipes.saveInferredRecipeInSupabase(temp, { title: "Lentejas estofadas", card: card(), model: null, requestKey: "c2c2c2c2-0000-4000-8000-0000000000f1" });
    await temp.rpc("apply_week", { p_iso_year: YEAR, p_iso_week: 5, p_days: [{ position: 0, day_name: "Lunes", lunch_status: "planned", lunch_dish_name: "Lentejas estofadas", lunch_recipe_version_id: tempSaved.versionId, dinner_status: "free", dinner_dish_name: "" }], p_request_key: "c2c2c2c2-0000-4000-8000-0000000000f2", p_expected_version: null });
    const linkedTemp = sql("SELECT count(*) FROM public.week_days WHERE lunch_recipe_version_id='" + tempSaved.versionId + "';").trim();
    const recipeDelete = guarded("DELETE FROM public.recipes WHERE owner_user_id='" + tempId + "';");
    const deleted = await admin.auth.admin.deleteUser(tempId);
    if (!deleted.error) newUsers.pop();
    check("C2 integrity: a card in use is kept (RESTRICT); deleting the account removes its weeks and cards", () => {
      assert.equal(linkedTemp, "1");
      assert.equal(recipeDelete, "refused");
      assert.equal(deleted.error, null);
      assert.equal(sql("SELECT count(*) FROM public.recipes WHERE owner_user_id='" + tempId + "';").trim(), "0");
    });
    await temp.auth.signOut({ scope: "local" }).catch(() => undefined);
  } finally {
    cleanup();
    for (const userId of newUsers) await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    restoreDevice();
    await userB.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
}

module.exports = { runRecipeCardTests };
