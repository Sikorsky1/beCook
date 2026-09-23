const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, sql, verifiedContainer, localApi } = require("./local-supabase.cjs");
const { fingerprintSql, probeSql } = require("./db-test-probe.cjs");
const { runOwnershipTests } = require("./reference-ownership-tests.cjs");
const { createClient } = require("@supabase/supabase-js");
const id = (prefix, n) => prefix + "0000000-0000-4000-8000-00000000000" + n;
let failures = 0, passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log("PASS " + name); }
  catch { failures++; console.error("FAIL " + name); }
}
function asUser(n, statement) {
  return "BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', " +
    "'{\"sub\":\"" + id("0", n) + "\",\"role\":\"authenticated\"}', true);\n" +
    statement + "\nROLLBACK;";
}
function query(n, statement) {
  // Last data line before ROLLBACK, not command tags or JWT claims.
  return sql(asUser(n, statement)).trim().split("\n").at(-2);
}
const tables = [
  ["profiles","1"],["weeks","2"],["week_days","3"],["shopping_lists","4"],
  ["shopping_items","5"],["menu_generation_requests","6"],["pantry_items","7"],
];
const fixtureId = (prefix,n) => ["5","7"].includes(prefix) ? prefix + "0000000-0000-4000-8000-0000000000" + n + "1" : id(prefix,n);
function sorted(rows) { return (rows || []).map(row => JSON.stringify(row)).sort(); }
async function main() {
  verifiedContainer();
  const expected = JSON.parse(fs.readFileSync(path.join(ROOT,"supabase/baseline/remote-metadata.json"),"utf8"));
  const initialState = sql(fingerprintSql);
  const delta = JSON.parse(fs.readFileSync(path.join(ROOT,"supabase/expectations/20260923194029_enforce_reference_ownership.json"),"utf8"));
  for (const key of ["constraints","indexes"]) expected[key].push(...delta[key]);
  const current = JSON.parse(sql(fs.readFileSync(path.join(ROOT,"supabase/baseline/inspect.sql"),"utf8")));
  for (const key of ["columns","tables","constraints","indexes","policies","functions","triggers","grants","other_relations","enums"]) {
    check("schema metadata: " + key, () => assert.deepEqual(sorted(current[key]), sorted(expected[key])));
  }
  const events = JSON.parse(sql("SELECT json_agg(x) FROM (SELECT evtname,evtevent,evtenabled,evttags,evtfoid::regproc::text AS function_name FROM pg_event_trigger WHERE evtname='ensure_rls') x;"));
  check("schema event trigger ensure_rls", () => assert.deepEqual(sorted(events),sorted(expected.events)));
  const functionGrants = JSON.parse(sql("SELECT json_agg(x) FROM (SELECT routine_name,grantee,privilege_type FROM information_schema.routine_privileges WHERE specific_schema='public') x;"));
  check("schema function grants", () => assert.deepEqual(sorted(functionGrants),sorted(expected.function_grants)));
  for (const [table,prefix] of tables) {
    check("synthetic fixture count: " + table, () =>
      assert.equal(sql("SELECT count(*) FROM public." + table + ";").trim(), ["5","7"].includes(prefix) ? "4" : "2"));
  }
  // Every policy is tested using SET LOCAL ROLE + JWT claims, never service_role.
  for (const n of [1,2]) for (const [table,prefix] of tables) {
    check("user " + n + " reads own " + table, () => assert.equal(query(n, "SELECT count(*) FROM public." + table + " WHERE id='" + fixtureId(prefix,n) + "';"),"1"));
    check("user " + n + " cannot read other " + table + " (zero rows)", () => assert.equal(query(n, "SELECT count(*) FROM public." + table + " WHERE id='" + fixtureId(prefix,3-n) + "';"),"0"));
    check("user " + n + " cannot update other " + table + " (zero rows)", () => assert.equal(query(n, "WITH changed AS (UPDATE public." + table + " SET id=id WHERE id='" + fixtureId(prefix,3-n) + "' RETURNING id) SELECT count(*) FROM changed;"),"0"));
    check("user " + n + " cannot delete other " + table + " (zero rows)", () => assert.equal(query(n, "WITH changed AS (DELETE FROM public." + table + " WHERE id='" + fixtureId(prefix,3-n) + "' RETURNING id) SELECT count(*) FROM changed;"),"0"));
  }
  for (const [table] of tables) {
    check("anon cannot read " + table + " (zero rows)", () => assert.equal(sql("BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM public." + table + "; ROLLBACK;").trim().split("\n").at(-2),"0"));
  }
  // Check atomicity after an error, and observe successful writes before rollback.
  function outcome(n, statement, verification = null) {
    const verifyArg = verification === null ? "NULL" : "$verify$" + verification + "$verify$";
    const result = JSON.parse(query(n, probeSql + "SELECT pg_temp.probe($probe$" + statement + "$probe$, " + verifyArg + ");"));
    assert.equal(result.unchanged, true, "Probe left partial or persistent changes");
    return result.outcome;
  }
  for (const n of [1,2]) {
    const other = 3-n;
    check("authenticated role and auth.uid for user " + n, () => assert.equal(query(n,"SELECT current_user || ':' || auth.uid()::text;"),"authenticated:" + id("0",n)));
    check("own valid insert is permitted for user " + n, () => assert.equal(outcome(n,"INSERT INTO public.weeks (user_id,title) VALUES ('" + id("0",n) + "','synthetic valid probe')"),"accepted"));
    const denied = [
      ["week_days parent", "INSERT INTO public.week_days (week_id,day_name,position,lunch_status,dinner_status) VALUES ('" + id("2",other) + "','Martes',1,'free','free')"],
      ["shopping_lists parent", "INSERT INTO public.shopping_lists (week_id) VALUES ('" + id("2",other) + "')"],
      ["shopping_items parent", "INSERT INTO public.shopping_items (shopping_list_id,name) VALUES ('" + id("4",other) + "','synthetic probe')"],
      ["week_days reparent", "UPDATE public.week_days SET week_id='" + id("2",other) + "' WHERE id='" + id("3",n) + "'"],
      ["shopping_lists reparent", "UPDATE public.shopping_lists SET week_id='" + id("2",other) + "' WHERE id='" + id("4",n) + "'"],
      ["shopping_items reparent", "UPDATE public.shopping_items SET shopping_list_id='" + id("4",other) + "' WHERE id='" + fixtureId("5",n) + "'"],
      ["weeks owner", "INSERT INTO public.weeks (user_id,title) VALUES ('" + id("0",other) + "','synthetic probe')"],
    ];
    for (const [label,statement] of denied) check("user " + n + " " + label + " denied by RLS", () => assert.equal(outcome(n,statement),"rls:42501"));
    // Original twelve regressions: FK 23503 replaces RLS 42501; probe verifies no partial write.
    const references = [
      ["weeks","1","profile_id","2"], ["weeks","6","generation_request_id","2"],
      ["pantry_items","1","profile_id","7"], ["menu_generation_requests","1","profile_id","6"],
      ["menu_generation_requests","2","created_week_id","6"], ["profiles","2","active_week_id","1"],
    ];
    for (const [table,parentPrefix,column,ownPrefix] of references) {
      const result = outcome(n,"UPDATE public." + table + " SET " + column + "='" + id(parentPrefix,other) + "' WHERE id='" + fixtureId(ownPrefix,n) + "'");
      check("user " + n + " cross-owner " + table + "." + column + " denied (observed " + result + ")", () => assert.equal(result,"constraint:23503"));
    }
    check("invalid profile training days is schema error 23514", () => assert.equal(outcome(n,"UPDATE public.profiles SET weekly_training_days=7 WHERE id='" + id("1",n) + "'"),"constraint:23514"));
  }
  runOwnershipTests({check, outcome, query, id, fixtureId});
  check("all new constraints validated and immediate", () => {
    const names = delta.constraints.map(c => "'" + c.conname + "'").join(",");
    assert.equal(sql("SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname IN (" + names + ") AND convalidated AND NOT condeferrable;").trim(), String(delta.constraints.length));
  });
  check("all public fixtures unchanged after SQL probes", () => assert.equal(sql(fingerprintSql), initialState));
  // Auth + Data API and the actual application's singleton/mapper contracts.
  const api = localApi();
  process.env.NEXT_PUBLIC_SUPABASE_URL = api.url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = api.key;
  require("./register-typescript.cjs");
  const { supabase } = require("../src/lib/supabase/client.ts");
  for (const n of [1,2]) {
    verifiedContainer();
    const client = createClient(api.url,api.key,{auth:{persistSession:false,autoRefreshToken:false}});
    const auth = await client.auth.signInWithPassword({email:"fixture-" + n + "@example.invalid",password:"Local-fixture-only-2026!"});
    check("Auth fixture " + n, () => { assert.equal(auth.error,null); assert.equal(auth.data.user?.id,id("0",n)); });
    if (auth.error) continue;
    const own = await client.from("weeks").select("id").eq("id",id("2",n));
    const other = await client.from("weeks").select("id").eq("id",id("2",3-n));
    check("Data API own / other " + n, () => { assert.equal(own.error,null); assert.equal(own.data.length,1); assert.equal(other.error,null); assert.equal(other.data.length,0); });
    await supabase.auth.setSession({access_token:auth.data.session.access_token,refresh_token:auth.data.session.refresh_token});
    const week = await require("../src/lib/supabase/weeks.ts").getLatestWeekFromSupabase();
    check("application week mapper " + n, () => assert.equal(week.title,"Semana sintética " + n));
    const profile = await require("../src/lib/supabase/profiles.ts").getLatestProfileFromSupabase();
    check("application profile mapper " + n, () => assert.equal(profile.id,id("1",n)));
    const pantry = await require("../src/lib/supabase/pantry.ts").getLatestPantryItemsFromSupabase(id("1",n));
    check("application pantry mapper " + n, () => assert.equal(pantry.length,2));
    const shopping = await require("../src/lib/supabase/shopping-lists.ts").getLatestShoppingListForWeekFromSupabase(id("2",n));
    check("application shopping mapper " + n, () => { assert.equal(shopping.items.length,2); assert.equal(shopping.items.filter(i => i.checked).length,1); });
    await client.auth.signOut({scope:"local"});
  }
  await supabase.auth.signOut({scope:"local"});
  console.log(passed + " passed; " + failures + " failed. No production connection; SQL probes rolled back.");
  process.exitCode = failures ? 1 : 0;
}
main().catch(() => { console.error("Local database integration could not complete; credentials and row contents suppressed."); process.exitCode=1; });
