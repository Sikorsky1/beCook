const {test, beforeEach, afterEach} = require("node:test");
const assert = require("node:assert/strict");
const {installFakeBackends, aiRequest, userId} = require("./helpers/fake-backends.cjs");

// P37: operational alerts. Synthetic webhook and backends only; nothing leaves the process.
const alerts = require("../src/lib/server/ops-alert.ts");
const webhook = "https://hooks.example.test/becook";
const alertEnv = ["OPS_ALERT_WEBHOOK_URL", "OPS_ALERT_WEBHOOK_TOKEN", "OPS_ALERT_EMAIL_TO", "OPS_ALERT_EMAIL_FROM", "VERCEL_ENV", "VERCEL_GIT_COMMIT_SHA"];
const saved = {};
let sent;
let originalFetch;
let silenced;

function captureFetch(respond = () => new Response(null, {status: 204})) {
 const previous = global.fetch;
 global.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://hooks.example.test") || url.startsWith("https://api.resend.com") || url.startsWith("http://127.0.0.1:9")) {
   sent.push({url, init, body: JSON.parse(init.body)});
   return respond(url, init);
  }
  return previous(input, init);
 };
}

beforeEach(() => {
 sent = [];
 originalFetch = global.fetch;
 for (const key of alertEnv) { saved[key] = process.env[key]; delete process.env[key]; }
 alerts.resetOpsAlertLimiter();
 silenced = {info: console.info, warn: console.warn};
 console.info = () => {};
 console.warn = () => {};
});
afterEach(() => {
 global.fetch = originalFetch;
 for (const key of alertEnv) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
 Object.assign(console, silenced);
});

test("without OPS_ALERT_WEBHOOK_URL nothing is sent", async () => {
 captureFetch();
 assert.equal(await alerts.sendOpsAlert("server_error", {route: "/week"}), false);
 assert.equal(sent.length, 0);
});

test("only https (or local http) targets are used", async () => {
 captureFetch();
 process.env.OPS_ALERT_WEBHOOK_URL = "http://hooks.example.test/becook";
 assert.equal(await alerts.sendOpsAlert("server_error", {route: "/week"}), false);
 process.env.OPS_ALERT_WEBHOOK_URL = "not a url";
 assert.equal(await alerts.sendOpsAlert("server_error", {route: "/week"}), false);
 assert.equal(sent.length, 0);
});

test("webhook: allowed fields only, environment and commit, no personal data", async () => {
 captureFetch();
 process.env.OPS_ALERT_WEBHOOK_URL = webhook;
 process.env.OPS_ALERT_WEBHOOK_TOKEN = "synthetic-token";
 process.env.VERCEL_ENV = "production";
 process.env.VERCEL_GIT_COMMIT_SHA = "abcdef1234567890";
 const ok = await alerts.sendOpsAlert("ai_budget_exhausted", {
  flow: "menu", requestId: "11111111-2222-4333-8444-555555555555", monthlyBudgetUsd: 25,
  email: "persona@example.com", prompt: "algo con lentejas", userId, dish: "Lentejas", profile: {allergies: ["nuts"]},
 });
 assert.equal(ok, true);
 assert.equal(sent.length, 1);
 const [{init, body}] = sent;
 assert.equal(init.method, "POST");
 assert.equal(init.headers.authorization, "Bearer synthetic-token");
 assert.ok(init.signal, "request has a timeout signal");
 assert.equal(body.event, "ai_budget_exhausted");
 assert.equal(body.env, "production");
 assert.equal(body.commit, "abcdef1");
 assert.deepEqual(body.fields, {flow: "menu", requestId: "11111111-2222-4333-8444-555555555555", monthlyBudgetUsd: 25});
 assert.match(body.text, /^\[beCook production\] ai_budget_exhausted/);
 assert.equal(body.content, body.text);
 const raw = JSON.stringify(body);
 for (const secret of ["persona@example.com", "lentejas", "Lentejas", userId, "nuts"]) assert.ok(!raw.includes(secret), secret);
});

test("routes lose query, fragment, identifiers and e-mails", () => {
 assert.equal(alerts.sanitizeRoute("/week?week=2026-W41&email=a@b.c#x"), "/week");
 assert.equal(alerts.sanitizeRoute("/api/x/0f0e0d0c-0b0a-4908-8706-050403020100/y"), "/api/x/:id/y");
 assert.equal(alerts.sanitizeRoute("/u/persona@example.com"), "/u/:id");
 assert.equal(alerts.sanitizeRoute("/n/123456"), "/n/:id");
 assert.deepEqual(alerts.sanitizeAlertFields({route: "/shopping/list?week=2026-W41", status: 503, other: "x"}), {route: "/shopping/list", status: 503});
});

test("one alert per event and route per minute in an instance", async () => {
 captureFetch();
 process.env.OPS_ALERT_WEBHOOK_URL = webhook;
 assert.equal(await alerts.sendOpsAlert("server_error", {route: "/week?week=1"}), true);
 assert.equal(await alerts.sendOpsAlert("server_error", {route: "/week?week=2"}), false);
 assert.equal(await alerts.sendOpsAlert("server_error", {route: "/profile"}), true);
 assert.equal(await alerts.sendOpsAlert("ai_budget_threshold", {threshold: "50%"}), true);
 assert.equal(await alerts.sendOpsAlert("ai_budget_threshold", {threshold: "80%"}), true);
 assert.equal(sent.length, 4);
});

test("global ceiling: at most 10 alerts per minute per instance, then again after the window", async () => {
 captureFetch();
 process.env.OPS_ALERT_WEBHOOK_URL = webhook;
 const realNow = Date.now;
 let now = realNow();
 Date.now = () => now;
 try {
  const results = [];
  for (let i = 0; i < 15; i += 1) results.push(await alerts.sendOpsAlert("server_error", {route: `/ruta-${String.fromCharCode(97 + i)}`}));
  assert.equal(results.filter(Boolean).length, alerts.opsAlertLimits.maxAlertsPerWindow);
  assert.deepEqual(results.slice(10), [false, false, false, false, false]);
  now += alerts.opsAlertLimits.minIntervalMs;
  assert.equal(await alerts.sendOpsAlert("server_error", {route: "/ruta-z"}), true);
  assert.equal(sent.length, 11);
 } finally {
  Date.now = realNow;
 }
});

test("the per-key map stays bounded: expired keys are dropped", async () => {
 captureFetch();
 process.env.OPS_ALERT_WEBHOOK_URL = webhook;
 const realNow = Date.now;
 let now = realNow();
 Date.now = () => now;
 try {
  for (let minute = 0; minute < 30; minute += 1) {
   for (let i = 0; i < 10; i += 1) await alerts.sendOpsAlert("server_error", {route: `/m${minute}-r${i}`});
   now += alerts.opsAlertLimits.minIntervalMs;
  }
  await alerts.sendOpsAlert("server_error", {route: "/final"});
  assert.equal(alerts.trackedOpsAlertKeys(), 1);
  assert.ok(alerts.trackedOpsAlertKeys() <= alerts.opsAlertLimits.maxTrackedKeys);
 } finally {
  Date.now = realNow;
 }
});

test("notifyOps outside a request scope sends before returning (after() needs a request)", async () => {
 captureFetch();
 process.env.OPS_ALERT_WEBHOOK_URL = webhook;
 await alerts.notifyOps("ai_usage_finish_failed", {flow: "menu", requestId: "req-1"});
 assert.equal(sent.length, 1);
 assert.equal(sent[0].body.event, "ai_usage_finish_failed");
});

test("a failing or slow channel never throws and gives up after 3 s", async () => {
 process.env.OPS_ALERT_WEBHOOK_URL = webhook;
 captureFetch(() => { throw new TypeError("synthetic network failure"); });
 assert.equal(await alerts.sendOpsAlert("server_error", {route: "/a"}), false);
 global.fetch = originalFetch;
 captureFetch(() => new Response("no", {status: 500}));
 assert.equal(await alerts.sendOpsAlert("server_error", {route: "/b"}), false);
 global.fetch = originalFetch;
 captureFetch((url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))));
 const startedAt = Date.now();
 assert.equal(await alerts.sendOpsAlert("server_error", {route: "/c"}), false);
 const elapsed = Date.now() - startedAt;
 assert.ok(elapsed >= 2900 && elapsed < 4500, String(elapsed));
});

test("Resend: an e-mail with the API key, recipients and sender; incomplete configuration sends nothing", async () => {
 captureFetch(() => Response.json({id: "synthetic"}));
 process.env.OPS_ALERT_WEBHOOK_URL = "https://api.resend.com/emails";
 assert.equal(await alerts.sendOpsAlert("server_error", {route: "/a"}), false, "no key");
 process.env.OPS_ALERT_WEBHOOK_TOKEN = "re_synthetic";
 assert.equal(await alerts.sendOpsAlert("server_error", {route: "/b"}), false, "no recipient");
 process.env.OPS_ALERT_EMAIL_TO = "ops@example.test, otra@example.test";
 assert.equal(await alerts.sendOpsAlert("server_error", {route: "/c", digest: "12345"}), true);
 assert.equal(sent.length, 1);
 const [{init, body}] = sent;
 assert.equal(init.headers.authorization, "Bearer re_synthetic");
 assert.deepEqual(body.to, ["ops@example.test", "otra@example.test"]);
 assert.equal(body.from, "beCook alertas <no-reply@becook.xyz>");
 assert.match(body.subject, /server_error/);
 assert.match(body.text, /route: \/c/);
 assert.deepEqual(Object.keys(body).sort(), ["from", "subject", "text", "to"]);
});

test("onRequestError: route without query, method, type and digest; never the message", async () => {
 captureFetch();
 process.env.OPS_ALERT_WEBHOOK_URL = webhook;
 const {onRequestError} = require("../src/instrumentation.ts");
 const error = Object.assign(new Error("fallo con lentejas de persona@example.com"), {digest: "2817381"});
 await onRequestError(error, {path: "/shopping/list?week=2026-W41", method: "GET", headers: {cookie: "sb=secret", authorization: "Bearer t"}},
  {routerKind: "App Router", routePath: "/shopping/list", routeType: "render", renderSource: "server-rendering", revalidateReason: undefined, renderType: "dynamic"});
 assert.equal(sent.length, 1);
 assert.deepEqual(sent[0].body.fields, {route: "/shopping/list", method: "GET", routeType: "render", digest: "2817381"});
 const raw = JSON.stringify(sent[0].body);
 for (const secret of ["lentejas", "persona@example.com", "secret", "Bearer t"]) assert.ok(!raw.includes(secret), secret);
});

// The ledger raises the alerts: budget exhausted, thresholds, finish failures, ledger down.
for (const scenario of [
 {name: "budget exhausted → ai_budget_exhausted", event: "ai_budget_exhausted", status: 503,
  setup: fakes => { fakes.beginResult = {allowed: false, id: "10000000-0000-4000-8000-000000000003", reason: "budget_exhausted", retry_after_seconds: 86400}; }},
 {name: "crossing 50 % → ai_budget_threshold", event: "ai_budget_threshold", status: 200,
  setup: fakes => { fakes.finishResult = {updated: true, month_cost_usd: 12.6, previous_month_cost_usd: 12.4}; }},
 {name: "finish fails → ai_usage_finish_failed", event: "ai_usage_finish_failed", status: 200,
  setup: fakes => { fakes.finishResult = null; }},
 {name: "ledger down → ai_ledger_unavailable", event: "ai_ledger_unavailable", status: 503,
  setup: fakes => { fakes.rpcMode = "down"; }},
]) {
 test(`AI ledger: ${scenario.name}, without user, profile or dishes`, async () => {
  const fakes = installFakeBackends((url) => url.endsWith("/responses")
   ? Response.json({id: "r", object: "response", status: "completed", model: "gpt-5.6-sol", output: [{type: "message", id: "m", role: "assistant", status: "completed", content: [{type: "output_text", text: JSON.stringify({items: [{name: "lentejas", quantity: 1, unit: "kg", category: "despensa"}]}), annotations: []}]}], usage: {input_tokens: 10, output_tokens: 10, total_tokens: 20}})
   : Response.json({}));
  try {
   process.env.OPS_ALERT_WEBHOOK_URL = webhook;
   scenario.setup(fakes);
   captureFetch();
   const {POST} = require("../src/app/api/generate-shopping-list/route.ts");
   const response = await POST(aiRequest("generate-shopping-list", {week: [{day: "Lunes", date: "5 oct", lunch: "Lentejas secretas", dinner: "LIBRE"}]}));
   assert.equal(response.status, scenario.status);
   const events = sent.map(entry => entry.body.event);
   assert.ok(events.includes(scenario.event), events.join(","));
   const raw = JSON.stringify(sent);
   for (const secret of [userId, "Lentejas secretas", "203.0.113.7"]) assert.ok(!raw.includes(secret), secret);
  } finally {
   fakes.restore();
  }
 });
}
