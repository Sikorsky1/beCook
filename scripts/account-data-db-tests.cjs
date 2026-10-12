// P37 (step 37) against the real local Supabase: export and deletion of an account through the
// application's own routes (/api/account/export and /api/account/delete), with a temporary user
// that has rows in every table. The AI usage ledger keeps the rows without owner, and the budget,
// the per-IP limit and the RPCs keep working. Weeks live in 2035; every row created is removed.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const YEAR = 2035;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const limits = (overrides = {}) => "'" + JSON.stringify({ daily: 4, monthly: 20, max_concurrent: 1, ip_hourly: 30, monthly_budget_usd: 25, ...overrides }) + "'::jsonb";
const card = {
  baseServings: 2,
  totalMinutes: 40,
  ingredients: [{ name: "lentejas", quantity: 200, unit: "g", category: "despensa", optional: false }],
  steps: ["Cocer las lentejas con la verdura."],
  possibleAllergens: [],
};

function request(path, { token, method = "GET", body } = {}) {
  const headers = new Headers();
  if (token) headers.set("authorization", "Bearer " + token);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request("http://localhost/api/account/" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function runAccountDataTests({ check, sql, id, api, createClient }) {
  const exportRoute = require("../src/app/api/account/export/route.ts");
  const deleteRoute = require("../src/app/api/account/delete/route.ts");
  const { exportTables } = require("../src/lib/server/account.ts");
  const recipes = require("../src/lib/supabase/recipes.ts");
  const admin = createClient(api.url, api.serviceKey, options);
  const savedServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = api.serviceKey;
  const userB = id("0", 2);
  const countsFor = (user) => sql(
    "SELECT concat_ws(',', (SELECT count(*) FROM public.profiles WHERE user_id='" + user + "'), (SELECT count(*) FROM public.weeks WHERE user_id='" + user + "'), " +
    "(SELECT count(*) FROM public.week_days d JOIN public.weeks w ON w.id=d.week_id WHERE w.user_id='" + user + "'), " +
    "(SELECT count(*) FROM public.shopping_items i JOIN public.shopping_lists l ON l.id=i.shopping_list_id JOIN public.weeks w ON w.id=l.week_id WHERE w.user_id='" + user + "'), " +
    "(SELECT count(*) FROM public.pantry_items WHERE user_id='" + user + "'), (SELECT count(*) FROM public.menu_generation_requests WHERE user_id='" + user + "'), " +
    "(SELECT count(*) FROM public.onboarding_progress WHERE user_id='" + user + "'), (SELECT count(*) FROM public.week_food_contexts WHERE user_id='" + user + "'), " +
    "(SELECT count(*) FROM public.recipes WHERE owner_user_id='" + user + "'), (SELECT count(*) FROM public.ai_usage_events WHERE user_id='" + user + "'));").trim();
  const bBefore = countsFor(userB);
  const requestIds = [randomUUID(), randomUUID()];
  let tempId = null;
  let deleted = false;

  try {
    // 1. A temporary account with rows in every table, written through the app's RPCs.
    const email = "p37-account-" + Date.now() + "@example.invalid";
    const password = "Local-account-only-2026!";
    const temp = createClient(api.url, api.key, options);
    const signup = await temp.auth.signUp({ email, password });
    tempId = signup.data.user?.id ?? null;
    const token = signup.data.session?.access_token;
    const profile = await temp.from("profiles").insert({ user_id: tempId, goal: "healthy_eating", goals: ["healthy_eating"], household_size: 2, allergies: ["nuts"] }).select("id").single();
    const onboarding = await temp.rpc("advance_onboarding", { p_step: "about" });
    const generation = await temp.from("menu_generation_requests").insert({ user_id: tempId, profile_id: profile.data?.id, people_count: 2, status: "draft", free_text_prompt: "Petición sintética P37" }).select("id").single();
    const saved = await recipes.saveInferredRecipeInSupabase(temp, { title: "Lentejas estofadas", card, model: null, requestKey: randomUUID() });
    const applyKey = randomUUID();
    const applied = await temp.rpc("apply_week", {
      p_iso_year: YEAR, p_iso_week: 1, p_request_key: applyKey, p_expected_version: null,
      p_days: [{ position: 0, day_name: "Lunes", lunch_status: "planned", lunch_dish_name: "Lentejas estofadas", lunch_recipe_version_id: saved.versionId, dinner_status: "free", dinner_dish_name: "" }],
    });
    const frozen = await temp.rpc("freeze_week_food_context", { p_iso_year: YEAR, p_iso_week: 1, p_request_key: applyKey, p_generation_request_id: null });
    const shopping = await temp.rpc("save_shopping_list", { p_iso_year: YEAR, p_iso_week: 1, p_week_signature: "shop1:p37", p_items: [{ name: "lentejas", quantity: 200, unit: "g", category: "despensa" }] });
    const pantry = await temp.rpc("add_pantry_items", { p_items: [{ id: randomUUID(), name: "Sal sintética P37", category: "básicos", active: true }] });
    // Ledger: one finished request and one still open when the account is deleted.
    const ledger = sql("BEGIN; SET LOCAL ROLE service_role;" +
      "SELECT public.ai_finish_request((public.ai_begin_request('" + tempId + "','menu','p37-ip','" + requestIds[0] + "'," + limits() + ")->>'id')::uuid,'succeeded','gpt-test',10,10,0.5,100)->>'updated';" +
      "SELECT public.ai_begin_request('" + tempId + "','import','p37-ip','" + requestIds[1] + "'," + limits({ daily: 10, monthly: null }) + ")->>'allowed'; COMMIT;");
    const weekIds = sql("SELECT string_agg(id::text, ',') FROM public.weeks WHERE user_id='" + tempId + "';").trim();
    check("P37 account: a temporary account has rows in every table", () => {
      assert.ok(tempId && token);
      for (const result of [profile, onboarding, generation, applied, frozen, shopping, pantry]) assert.equal(result.error, null);
      assert.ok(saved.versionId);
      assert.match(ledger, /true[\s\S]*true/);
      assert.deepEqual(countsFor(tempId).split(",").map(Number).map((n) => n > 0), Array(10).fill(true));
    });

    // 2. Export: every table of the user, the ledger without ip_hash, nothing of other users.
    const exported = await exportRoute.GET(request("export", { token }));
    const text = await exported.text();
    const data = JSON.parse(text);
    const bRows = sql("SELECT string_agg(id::text, ',') FROM (SELECT id FROM public.weeks WHERE user_id='" + userB + "' UNION ALL SELECT id FROM public.profiles WHERE user_id='" + userB + "' UNION ALL SELECT id FROM public.pantry_items WHERE user_id='" + userB + "') x;").trim().split(",");
    check("P37 export: 200, downloadable JSON with every table of the user", () => {
      assert.equal(exported.status, 200);
      assert.match(exported.headers.get("content-disposition"), /^attachment; filename="becook-datos-\d{4}-\d{2}-\d{2}\.json"$/);
      assert.equal(exported.headers.get("cache-control"), "no-store");
      assert.equal(data.account.id, tempId);
      assert.equal(data.account.email, email);
      for (const spec of exportTables) assert.ok(data.tables[spec.table].length >= 1, spec.table);
      assert.equal(data.tables.recipe_versions.length, 1, "own card version, no catalogue versions");
      assert.ok(data.tables.recipes.every((row) => row.owner_user_id === tempId), "no catalogue recipes");
      assert.ok(data.tables.weeks.every((row) => row.user_id === tempId));
      assert.ok(data.tables.week_days.every((row) => weekIds.split(",").includes(row.week_id)));
    });
    check("P37 export: the AI ledger without ip_hash and no row of another user", () => {
      assert.equal(data.aiUsage.length, 2);
      assert.deepEqual(data.aiUsage.map((row) => row.request_id).sort(), [...requestIds].sort());
      assert.ok(!text.includes("ip_hash") && !text.includes("p37-ip"));
      assert.ok(!text.includes(userB));
      for (const rowId of bRows) assert.ok(!text.includes(rowId), "row of B");
    });

    // 3. Deletion: guards first, then the account and its rows go; the ledger stays without owner.
    const noToken = await deleteRoute.POST(request("delete", { method: "POST", body: { confirmation: "ELIMINAR" } }));
    const wrong = await deleteRoute.POST(request("delete", { token, method: "POST", body: { confirmation: "eliminar" } }));
    check("P37 delete: no session → 401; wrong confirmation → 400 and nothing deleted", () => {
      assert.equal(noToken.status, 401);
      assert.equal(wrong.status, 400);
      assert.equal(sql("SELECT count(*) FROM auth.users WHERE id='" + tempId + "';").trim(), "1");
    });
    const removal = await deleteRoute.POST(request("delete", { token, method: "POST", body: { confirmation: "ELIMINAR" } }));
    deleted = removal.status === 200;
    const ledgerAfter = sql("SELECT count(*) || ':' || count(*) FILTER (WHERE user_id IS NULL) FROM public.ai_usage_events WHERE request_id IN ('" + requestIds.join("','") + "');").trim();
    const weekRows = weekIds ? sql("SELECT (SELECT count(*) FROM public.week_days WHERE week_id IN ('" + weekIds.split(",").join("','") + "')) + (SELECT count(*) FROM public.shopping_lists WHERE week_id IN ('" + weekIds.split(",").join("','") + "'));").trim() : "0";
    check("P37 delete: ELIMINAR removes the Auth user and every row of the account", () => {
      assert.equal(removal.status, 200);
      assert.equal(sql("SELECT count(*) FROM auth.users WHERE id='" + tempId + "';").trim(), "0");
      assert.equal(sql("SELECT count(*) FROM auth.identities WHERE user_id='" + tempId + "';").trim(), "0");
      assert.equal(countsFor(tempId), "0,0,0,0,0,0,0,0,0,0");
      assert.equal(weekRows, "0");
      assert.equal(sql("SELECT count(*) FROM public.recipe_versions WHERE id='" + saved.versionId + "';").trim(), "0");
    });
    check("P37 delete: the AI usage rows stay, without owner", () => assert.equal(ledgerAfter, "2:2"));

    const stale = await exportRoute.GET(request("export", { token }));
    const relogin = await createClient(api.url, api.key, options).auth.signInWithPassword({ email, password });
    check("P37 delete: the old session and the password no longer work", () => {
      assert.equal(stale.status, 401);
      assert.ok(relogin.error);
    });

    // 4. The ledger keeps working with rows without owner.
    const finishAfter = sql("BEGIN; SET LOCAL ROLE service_role; SELECT public.ai_finish_request((SELECT id FROM public.ai_usage_events WHERE request_id='" + requestIds[1] + "'),'succeeded','gpt-test',5,5,0.25,50)->>'updated'; COMMIT;");
    check("P37 ledger: a request open when its account was deleted can still be finished", () => {
      assert.match(finishAfter, /^true$/m);
      assert.equal(sql("SELECT status || ':' || cost_usd FROM public.ai_usage_events WHERE request_id='" + requestIds[1] + "';").trim(), "succeeded:0.250000");
    });
    // Inside the rolled-back transaction the ledger starts empty, whatever other local runs left.
    const scenario = (setup, expression) => sql("BEGIN;\nDELETE FROM public.ai_usage_events;\n" + setup + "\nSET LOCAL ROLE service_role;\nSELECT 'R:' || (" + expression + ");\nROLLBACK;")
      .split("\n").find((line) => line.startsWith("R:"))?.slice(2);
    const orphanRows = (count, { flow = "menu", cost = 0.01, ip = "orphan-ip" } = {}) =>
      "INSERT INTO public.ai_usage_events (user_id, flow, status, prompt_tokens, completion_tokens, cost_usd, request_id, ip_hash, finished_at) " +
      "SELECT NULL, '" + flow + "', 'succeeded', 1, 1, " + cost + ", gen_random_uuid(), '" + ip + "', now() FROM generate_series(1," + count + ");";
    const u1 = id("0", 1);
    check("P37 ledger: rows without owner count for the global budget", () =>
      assert.equal(scenario(orphanRows(1, { cost: 25 }), "public.ai_begin_request('" + u1 + "','menu','fresh-ip',gen_random_uuid()," + limits() + ")->>'reason'"), "budget_exhausted"));
    check("P37 ledger: rows without owner count for the per-IP limit", () =>
      assert.equal(scenario(orphanRows(30, { ip: "shared-ip", cost: 0 }), "public.ai_begin_request('" + u1 + "','menu','shared-ip',gen_random_uuid()," + limits({ daily: null }) + ")->>'reason'"), "ip_rate"));
    check("P37 ledger: rows without owner count for no user's quota", () =>
      assert.equal(scenario(orphanRows(5, { cost: 0 }), "public.ai_begin_request('" + u1 + "','menu','fresh-ip',gen_random_uuid()," + limits() + ")->>'allowed'"), "true"));
    check("P37 ledger: begin still requires a user", () =>
      assert.throws(() => scenario("", "public.ai_begin_request(NULL,'menu','x',gen_random_uuid()," + limits() + ")->>'allowed'")));
    check("P37 schema: user_id nullable and FK ON DELETE SET NULL, validated", () => {
      assert.equal(sql("SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_usage_events' AND column_name='user_id';").trim(), "YES");
      assert.equal(sql("SELECT confdeltype::text || ':' || convalidated::text FROM pg_constraint WHERE conname='ai_usage_events_user_id_fkey';").trim(), "n:true");
    });
  } finally {
    sql("DELETE FROM public.ai_usage_events WHERE request_id IN ('" + requestIds.join("','") + "');");
    if (tempId && !deleted) await admin.auth.admin.deleteUser(tempId).catch(() => undefined);
    if (savedServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = savedServiceKey;
  }
  check("P37: the other user is intact and the temporary rows are gone", () => {
    assert.equal(countsFor(userB), bBefore);
    // Only this suite's rows: other local runs (e2e) may leave rows without owner on purpose.
    assert.equal(sql("SELECT count(*) FROM public.ai_usage_events WHERE ip_hash='p37-ip';").trim(), "0");
    assert.equal(sql("SELECT count(*) FROM public.weeks WHERE iso_year=" + YEAR + ";").trim(), "0");
  });
}

module.exports = { runAccountDataTests };
