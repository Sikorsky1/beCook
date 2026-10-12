const {test, beforeEach, afterEach} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// P37: export and deletion of an account. Synthetic Auth, PostgREST and admin API; no network.
const supabaseUrl = "http://supabase.test";
const userToken = "header.synthetic-user.signature";
const userId = "0000000a-0000-4000-8000-00000000000a";
const anonKey = "synthetic-anon-key";
const serviceKey = "synthetic-service-key";
const env = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "OPS_ALERT_WEBHOOK_URL"];
const root = path.resolve(__dirname, "..");
const account = require("../src/lib/server/account.ts");
const {GET} = require("../src/app/api/account/export/route.ts");
const {POST} = require("../src/app/api/account/delete/route.ts");
const client = require("../src/lib/account/client.ts");

let state;
const saved = {};
let originals;

function rowsFor(table, n = 1) {
 return Array.from({length: n}, (_, i) => table === "recipe_versions"
  ? {id: `v${i}`, recipe_id: "r1", recipes: {owner_user_id: userId}}
  : {id: `${table}-${i}`, user_id: userId});
}

beforeEach(() => {
 for (const key of env) saved[key] = process.env[key];
 Object.assign(process.env, {NEXT_PUBLIC_SUPABASE_URL: supabaseUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: serviceKey});
 delete process.env.OPS_ALERT_WEBHOOK_URL;
 originals = {fetch: global.fetch, info: console.info, warn: console.warn};
 console.info = () => {};
 console.warn = () => {};
 state = {authMode: "ok", reads: [], deletes: [], alerts: [], adminMode: "ok", tables: {}, failTable: null, ai: [{id: "a1", flow: "menu", cost_usd: 0.01}]};
 global.fetch = async (input, init = {}) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  if (url.origin === "https://hooks.example.test") { state.alerts.push(JSON.parse(init.body)); return new Response(null, {status: 204}); }
  if (url.pathname === "/auth/v1/user") {
   if (state.authMode === "down") throw new TypeError("fetch failed");
   if (headers.get("authorization") !== `Bearer ${userToken}`) return Response.json({code: 403, msg: "invalid JWT"}, {status: 403});
   return Response.json({id: userId, aud: "authenticated", role: "authenticated", email: "persona@example.test", created_at: "2026-01-01T00:00:00Z", last_sign_in_at: "2026-10-01T00:00:00Z", email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: {}, user_metadata: {}});
  }
  if (url.pathname.startsWith("/auth/v1/admin/users/")) {
   state.deletes.push({id: url.pathname.split("/").pop(), method: init.method ?? input.method, key: headers.get("apikey"), authorization: headers.get("authorization")});
   if (state.adminMode === "fail") return Response.json({code: 500, msg: "boom with persona@example.test"}, {status: 500});
   return Response.json({});
  }
  if (url.pathname.startsWith("/rest/v1/")) {
   const table = url.pathname.slice("/rest/v1/".length);
   const range = headers.get("range") ?? null;
   state.reads.push({table, query: url.searchParams.toString(), select: url.searchParams.get("select"), authorization: headers.get("authorization"), apikey: headers.get("apikey"), range, offset: url.searchParams.get("offset"), limit: url.searchParams.get("limit")});
   // 500, not 503: supabase-js retries 503 reads with back-off (slow, same final result).
   if (state.failTable === table) return Response.json({message: "unavailable"}, {status: 500});
   const all = table === "ai_usage_events" ? state.ai : (state.tables[table] ?? rowsFor(table));
   const offset = Number(url.searchParams.get("offset") ?? 0);
   const limit = Number(url.searchParams.get("limit") ?? all.length);
   return Response.json(all.slice(offset, offset + limit));
  }
  throw new Error("unexpected request " + url);
 };
});
afterEach(() => {
 for (const key of env) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
 global.fetch = originals.fetch;
 console.info = originals.info;
 console.warn = originals.warn;
});

const get = (token = userToken) => new Request("http://localhost/api/account/export", {headers: token ? {authorization: `Bearer ${token}`} : {}});
const post = (body, {token = userToken, contentType = "application/json", raw} = {}) => {
 const headers = {};
 if (token) headers.authorization = `Bearer ${token}`;
 if (contentType) headers["content-type"] = contentType;
 return new Request("http://localhost/api/account/delete", {method: "POST", headers, body: raw ?? JSON.stringify(body)});
};

test("every table with user data in the migrations is exported (the ledger separately)", () => {
 const sources = [path.join(root, "supabase/baseline/20260923103650_local_baseline.sql"),
  ...fs.readdirSync(path.join(root, "supabase/migrations")).map(file => path.join(root, "supabase/migrations", file))];
 const created = new Set();
 for (const file of sources) for (const match of fs.readFileSync(file, "utf8").matchAll(/CREATE TABLE public\."?(\w+)"?/g)) created.add(match[1]);
 const exported = new Set(account.exportTables.map(spec => spec.table));
 for (const table of created) {
  if (table === "ai_usage_events") continue;
  assert.ok(exported.has(table), `${table} is missing from exportTables`);
 }
 assert.ok(!account.aiUsageExportColumns.includes("ip_hash"));
});

test("export: 200 attachment with every table, read with the user's session; ledger with the service key, filtered and without ip_hash", async () => {
 const response = await GET(get());
 assert.equal(response.status, 200);
 assert.match(response.headers.get("content-disposition"), /^attachment; filename="becook-datos-\d{4}-\d{2}-\d{2}\.json"$/);
 assert.equal(response.headers.get("cache-control"), "no-store");
 const data = await response.json();
 assert.equal(data.format, "becook-account-export");
 assert.deepEqual(data.account, {id: userId, email: "persona@example.test", createdAt: "2026-01-01T00:00:00Z", lastSignInAt: "2026-10-01T00:00:00Z", emailConfirmedAt: "2026-01-01T00:00:00Z"});
 assert.deepEqual(Object.keys(data.tables).sort(), account.exportTables.map(spec => spec.table).sort());
 assert.deepEqual(data.aiUsage, state.ai);
 assert.equal(data.tables.recipe_versions[0].recipes, undefined, "join helper removed");
 for (const read of state.reads) {
  if (read.table === "ai_usage_events") {
   assert.equal(read.authorization, `Bearer ${serviceKey}`);
   assert.ok(!read.select.includes("ip_hash"));
   assert.match(read.query, new RegExp(`user_id=eq.${userId}`));
  } else {
   assert.equal(read.authorization, `Bearer ${userToken}`, read.table);
   assert.equal(read.apikey, anonKey);
  }
 }
 const owner = Object.fromEntries(account.exportTables.filter(spec => spec.owner).map(spec => [spec.table, spec.owner]));
 for (const [table, column] of Object.entries(owner)) {
  assert.ok(state.reads.some(read => read.table === table && read.query.includes(`${column}=eq.${userId}`)), table);
 }
 assert.ok(state.reads.some(read => read.table === "recipe_versions" && read.query.includes(`recipes.owner_user_id=eq.${userId}`)));
});

test("export: pages of 1000 rows are joined; more than the cap is refused", async () => {
 state.tables.shopping_items = Array.from({length: 1003}, (_, i) => ({id: `item-${i}`}));
 const data = await (await GET(get())).json();
 assert.equal(data.tables.shopping_items.length, 1003);
 assert.equal(state.reads.filter(read => read.table === "shopping_items").length, 2);
 state.tables.shopping_items = Array.from({length: account.accountLimits.pageSize * account.accountLimits.maxPagesPerTable}, (_, i) => ({id: `x-${i}`}));
 assert.equal((await GET(get())).status, 503);
});

test("export: all or nothing — a table that cannot be read or a missing service key → 503", async () => {
 state.failTable = "pantry_items";
 const failed = await GET(get());
 assert.equal(failed.status, 503);
 assert.match((await failed.json()).error, /No hemos podido preparar/);
 state.failTable = null;
 delete process.env.SUPABASE_SERVICE_ROLE_KEY;
 assert.equal((await GET(get())).status, 503);
});

test("export and delete: no token or invalid token → 401; Auth down → 503", async () => {
 assert.equal((await GET(get(null))).status, 401);
 assert.equal((await GET(get("forged.token.value"))).status, 401);
 assert.equal((await POST(post({confirmation: "ELIMINAR"}, {token: null}))).status, 401);
 state.authMode = "down";
 assert.equal((await GET(get())).status, 503);
 assert.equal((await POST(post({confirmation: "ELIMINAR"}))).status, 503);
 assert.equal(state.deletes.length, 0);
});

test("delete: only the exact word ELIMINAR deletes", async () => {
 for (const body of [{}, {confirmation: "eliminar"}, {confirmation: "ELIMINAR "}, {confirmation: true}]) {
  const response = await POST(post(body));
  assert.equal(response.status, 400, JSON.stringify(body));
  assert.equal((await response.json()).reason, "confirmation_required");
 }
 assert.equal((await POST(post(null, {contentType: "text/plain", raw: "ELIMINAR"}))).status, 415);
 assert.equal((await POST(post(null, {raw: JSON.stringify({confirmation: "ELIMINAR", pad: "x".repeat(2000)})}))).status, 413);
 assert.equal((await POST(post(null, {raw: "{oops"}))).status, 400);
 assert.equal(state.deletes.length, 0);
});

test("delete: ELIMINAR deletes the verified user with the service key", async () => {
 const response = await POST(post({confirmation: "ELIMINAR"}));
 assert.equal(response.status, 200);
 assert.deepEqual(await response.json(), {deleted: true});
 assert.equal(state.deletes.length, 1);
 assert.equal(state.deletes[0].id, userId);
 assert.equal(state.deletes[0].method, "DELETE");
 assert.equal(state.deletes[0].authorization, `Bearer ${serviceKey}`);
});

test("delete: a failure → 503 and an alert without the user or the provider's message", async () => {
 process.env.OPS_ALERT_WEBHOOK_URL = "https://hooks.example.test/ops";
 require("../src/lib/server/ops-alert.ts").resetOpsAlertLimiter();
 state.adminMode = "fail";
 const response = await POST(post({confirmation: "ELIMINAR"}));
 assert.equal(response.status, 503);
 assert.equal(state.alerts.length, 1);
 assert.equal(state.alerts[0].event, "account_delete_failed");
 const raw = JSON.stringify(state.alerts);
 assert.ok(!raw.includes(userId) && !raw.includes("persona@example.test") && !raw.includes("boom"));
 delete process.env.SUPABASE_SERVICE_ROLE_KEY;
 assert.equal((await POST(post({confirmation: "ELIMINAR"}))).status, 503);
});

// Browser side: requests, messages and what the device forgets after a deletion.
function memoryStorage(entries = {}) {
 const map = new Map(Object.entries(entries));
 return {
  get length() { return map.size; },
  key: index => [...map.keys()][index] ?? null,
  getItem: key => (map.has(key) ? map.get(key) : null),
  setItem: (key, value) => map.set(key, String(value)),
  removeItem: key => map.delete(key),
  dump: () => Object.fromEntries(map),
 };
}

test("client: export downloads the server's file; errors explain what happened", async () => {
 const calls = [];
 const ok = await client.requestAccountExport({getToken: async () => "t", fetchImpl: async (url, init) => {
  calls.push({url, init});
  return new Response("{}", {headers: {"content-disposition": "attachment; filename=\"becook-datos-2026-10-15.json\""}});
 }});
 assert.equal(ok.ok, true);
 assert.equal(ok.fileName, "becook-datos-2026-10-15.json");
 assert.equal(calls[0].url, "/api/account/export");
 assert.equal(calls[0].init.headers.authorization, "Bearer t");
 assert.deepEqual(await client.requestAccountExport({getToken: async () => null}), {ok: false, message: "Tu sesión ha caducado. Vuelve a iniciar sesión para continuar.", status: 401});
 const offline = await client.requestAccountExport({getToken: async () => "t", fetchImpl: async () => { throw new TypeError("offline"); }});
 assert.match(offline.message, /conectar/);
 const busy = await client.requestAccountExport({getToken: async () => "t", fetchImpl: async () => Response.json({error: "Mensaje del servidor"}, {status: 503})});
 assert.deepEqual(busy, {ok: false, message: "Mensaje del servidor", status: 503});
});

test("client: deletion needs ELIMINAR before any request and sends only the confirmation", async () => {
 const calls = [];
 const fetchImpl = async (url, init) => { calls.push({url, init}); return Response.json({deleted: true}); };
 assert.equal((await client.requestAccountDeletion({getToken: async () => "t", fetchImpl, confirmation: "borrar"})).ok, false);
 assert.equal(calls.length, 0);
 assert.equal(client.isDeleteConfirmation("  ELIMINAR "), true);
 assert.equal(client.isDeleteConfirmation("Eliminar"), false);
 assert.deepEqual(await client.requestAccountDeletion({getToken: async () => "t", fetchImpl, confirmation: "ELIMINAR"}), {ok: true});
 assert.equal(calls[0].url, "/api/account/delete");
 assert.equal(calls[0].init.method, "POST");
 assert.equal(calls[0].init.body, JSON.stringify({confirmation: "ELIMINAR"}));
 const failed = await client.requestAccountDeletion({getToken: async () => "t", fetchImpl: async () => new Response("x", {status: 500}), confirmation: "ELIMINAR"});
 assert.match(failed.message, /No hemos podido eliminar la cuenta/);
});

test("client: after a deletion the device forgets that identity and its drafts, keeps guest data and shows the notice once", () => {
 const scope = `u_${userId}`;
 const local = memoryStorage({[`becook:${scope}:week:2026-W41`]: "{}", [`becook:${scope}:profile`]: "{}", "becook:guest:week:2026-W41": "{}", "becook:u_other:profile": "{}", "otra-app": "1"});
 const session = memoryStorage({"becook-create-menu-draft": "{}", [`becook:onboarding-dismissed:${userId}`]: "1", "otra-app": "1"});
 client.clearDeviceDataAfterDeletion(scope, {local, session});
 assert.deepEqual(Object.keys(local.dump()).sort(), ["becook:guest:week:2026-W41", "becook:u_other:profile", "otra-app"]);
 assert.deepEqual(Object.keys(session.dump()).sort(), [client.ACCOUNT_DELETED_FLAG, "otra-app"]);
 assert.equal(client.consumeAccountDeletedNotice(session), true);
 assert.equal(client.consumeAccountDeletedNotice(session), false);
});

test("«Tus datos» screen: one link from Perfil, 44 px controls, 16 px field, written confirmation and accessible notices", () => {
 const page = fs.readFileSync(path.join(root, "src/app/profile/data/page.tsx"), "utf8");
 const profile = fs.readFileSync(path.join(root, "src/app/profile/page.tsx"), "utf8");
 assert.equal((profile.match(/href="\/profile\/data"/g) ?? []).length, 1);
 assert.match(page, /<h1[^>]*>Tus datos<\/h1>/);
 assert.match(page, /role="alert"/);
 assert.match(page, /role="status"/);
 assert.match(page, /htmlFor="delete-confirmation"/);
 assert.match(page, /disabled=\{deleting \|\| !confirmed\}/);
 assert.match(page, /signOut\(\{ localOnly: true \}\)/);
 assert.match(page, /router\.replace\("\/week"\)/);
 assert.doesNotMatch(page, /style=\{/);
 assert.doesNotMatch(page, /text-\[(1[01]|[0-9])px\]|text-\[0\.[0-6]/, "no text under 12 px");
 for (const link of page.matchAll(/<Link\b[^>]*?className="([^"]+)"[^>]*>/g)) assert.match(link[1], /min-h-11/);
 assert.match(fs.readFileSync(path.join(root, "src/components/ui/TextInput.tsx"), "utf8"), /text-base/);
});
