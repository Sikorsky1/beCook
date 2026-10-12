const {test, beforeEach, afterEach} = require("node:test");
const assert = require("node:assert/strict");
const {installFakeBackends, aiRequest, userId} = require("./helpers/fake-backends.cjs");

// A4: quota/budget ledger integration with synthetic Supabase RPCs and OpenAI. No network.
const dish = "Lentejas estofadas secretas";
// C6: prose with a day name, so the local parser leaves it to the AI.
const pastedText = `El lunes comemos ${dish} y cenamos libre`;
const importedMenu = {week: "Semana importada", days: [{dayName: "Lunes", lunch: {status: "planned", dishName: dish}, dinner: {status: "free", dishName: ""}}]};
const shoppingList = {items: [{name: "lentejas", quantity: 500, unit: "g", category: "despensa"}]};
const week = [{day: "Lunes", date: "5 oct", lunch: dish, dinner: "LIBRE"}];
const selection = {
 lunches: ["Pollo asado con batata", "Lentejas estofadas", "Arroz meloso de sepia", "Espaguetis con setas", "Garbanzos con espinacas", "Merluza al horno", "Paella de pollo"],
 dinners: ["Tortilla de patata", "Ensalada de tomate y queso fresco", "Salmón a la plancha", "Crema de calabaza", "Revuelto de champiñones", "Bacalao al pilpil", "Tosta de aguacate"],
};
const routes = {
 "generate-menu": {flow: "menu", body: {peopleCount: 2, freeTextPrompt: "algo con " + dish}},
 "import-menu": {flow: "import", body: {text: pastedText}},
 "generate-shopping-list": {flow: "shopping", body: {week}},
};

let fakes;
let script = [];
let logs = [];
const originals = {info: console.info, warn: console.warn, error: console.error, log: console.log};

function openAI(url, init) {
 const step = script.length ? script.shift() : "ok";
 if (step === "network") throw new TypeError("synthetic network failure");
 if (typeof step === "number") return Response.json({error: {message: "synthetic", type: "test"}}, {status: step});
 if (url.endsWith("/responses")) {
  return Response.json({id: "resp_test", object: "response", status: "completed", model: "gpt-5.6-sol", output: [{type: "message", id: "msg_test", role: "assistant", status: "completed", content: [{type: "output_text", text: JSON.stringify(shoppingList), annotations: []}]}], usage: {input_tokens: 1000, output_tokens: 200, total_tokens: 1200, input_tokens_details: {cached_tokens: 0}}});
 }
 const content = JSON.parse(init.body).response_format?.json_schema?.name === "imported_menu" ? importedMenu : selection;
 return Response.json({model: "gpt-5.6-sol", choices: [{finish_reason: "stop", message: {content: JSON.stringify(content)}}], usage: {prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200}});
}

beforeEach(() => {
 script = [];
 logs = [];
 fakes = installFakeBackends(openAI);
 for (const level of ["info", "warn", "error", "log"]) console[level] = (...args) => logs.push([level, JSON.stringify(args)]);
});
afterEach(() => {
 Object.assign(console, originals);
 fakes.restore();
});

const routeModule = path => require(`../src/app/api/${path}/route.ts`);

for (const [path, spec] of Object.entries(routes)) {
 const {POST} = routeModule(path);

 test(`${path}: begin receives flow, D3 limits, request id and a hashed IP`, async () => {
  const response = await POST(aiRequest(path, spec.body));
  assert.equal(response.status, 200);
  const [begin] = fakes.begin;
  assert.equal(begin.p_user_id, userId);
  assert.equal(begin.p_flow, spec.flow);
  assert.match(begin.p_ip_hash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(begin).includes("203.0.113.7"), "raw IP is never sent");
  assert.equal(begin.p_request_id, response.headers.get("X-Request-Id"));
  const expected = {menu: [4, 20], import: [10, null], shopping: [10, null]}[spec.flow];
  assert.deepEqual(begin.p_limits, {daily: expected[0], monthly: expected[1], max_concurrent: 1, ip_hourly: 30, monthly_budget_usd: 25});
  assert.ok(fakes.rpcAuth.every(key => key === "synthetic-service-key"), "ledger RPCs use the server-only key");
 });

 test(`${path}: success closes the record with model, tokens, cost and latency`, async () => {
  assert.equal((await POST(aiRequest(path, spec.body))).status, 200);
  const [finish] = fakes.finish;
  assert.equal(finish.p_id, fakes.beginResult.id);
  assert.equal(finish.p_status, "succeeded");
  assert.equal(finish.p_model, "gpt-5.6-sol");
  assert.equal(finish.p_prompt_tokens, 1000);
  assert.equal(finish.p_completion_tokens, 200);
  assert.ok(finish.p_cost_usd > 0);
  assert.ok(Number.isInteger(finish.p_latency_ms));
 });

 for (const [reason, message] of [["concurrency", /generación en curso/], ["daily_quota", /por hoy/], ["monthly_quota", /este mes/], ["ip_rate", /esta red/]]) {
  test(`${path}: ${reason} -> 429 with Retry-After, no OpenAI call`, async () => {
   fakes.beginResult = {allowed: false, id: "10000000-0000-4000-8000-000000000002", reason, retry_after_seconds: 3600};
   const response = await POST(aiRequest(path, spec.body));
   assert.equal(response.status, 429);
   assert.equal(response.headers.get("Retry-After"), "3600");
   assert.ok(response.headers.get("X-Request-Id"));
   const body = await response.json();
   assert.match(body.error, message);
   assert.equal(body.reason, reason);
   assert.equal(fakes.openAICalls, 0);
   assert.equal(fakes.finish.length, 0);
  });
 }

 test(`${path}: exhausted monthly budget -> 503 with Retry-After`, async () => {
  fakes.beginResult = {allowed: false, id: "10000000-0000-4000-8000-000000000003", reason: "budget_exhausted", retry_after_seconds: 86400};
  const response = await POST(aiRequest(path, spec.body));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "86400");
  assert.match((await response.json()).error, /no está disponible/);
  assert.equal(fakes.openAICalls, 0);
 });

 test(`${path}: fails closed (503) without service key, salt, valid limits or ledger`, async () => {
  for (const setup of [
   () => delete process.env.SUPABASE_SERVICE_ROLE_KEY,
   () => delete process.env.AI_IP_HASH_SALT,
   () => { process.env.AI_MAX_CONCURRENT = "uno"; },
   () => { fakes.rpcMode = "down"; },
  ]) {
   const saved = {key: process.env.SUPABASE_SERVICE_ROLE_KEY, salt: process.env.AI_IP_HASH_SALT};
   setup();
   assert.equal((await POST(aiRequest(path, spec.body))).status, 503);
   process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
   process.env.AI_IP_HASH_SALT = saved.salt;
   delete process.env.AI_MAX_CONCURRENT;
   fakes.rpcMode = "ok";
  }
  assert.equal(fakes.openAICalls, 0);
 });

 test(`${path}: OpenAI 400 is not retried and is recorded as failed`, async () => {
  script = [400];
  assert.equal((await POST(aiRequest(path, spec.body))).status, 502);
  assert.equal(fakes.openAICalls, 1);
  assert.equal(fakes.finish[0].p_status, "failed");
  assert.equal(fakes.finish[0].p_reason, "openai_400");
 });

 test(`${path}: logs carry no dishes, free text, IP or user id`, async () => {
  await POST(aiRequest(path, spec.body));
  script = [400];
  await POST(aiRequest(path, spec.body));
  const text = logs.map(([, line]) => line).join("\n");
  assert.ok(text.includes("ai_usage"));
  for (const secret of ["Lentejas", "algo con", "203.0.113.7", userId]) assert.ok(!text.includes(secret), secret);
 });
}

for (const path of ["import-menu", "generate-shopping-list"]) {
 const {POST} = routeModule(path);
 const {body} = routes[path];

 test(`${path}: one retry after a 5xx or lost connection, then success`, async () => {
  for (const failure of [500, "network"]) {
   fakes.openAICalls = 0;
   fakes.finish = [];
   script = [failure];
   assert.equal((await POST(aiRequest(path, body))).status, 200);
   assert.equal(fakes.openAICalls, 2);
   assert.equal(fakes.finish[0].p_status, "succeeded");
  }
 });

 test(`${path}: at most one retry`, async () => {
  script = [503, 503, 503];
  assert.equal((await POST(aiRequest(path, body))).status, 502);
  assert.equal(fakes.openAICalls, 2);
  assert.equal(fakes.finish[0].p_status, "failed");
 });

 test(`${path}: rate limit from OpenAI (429) is not retried`, async () => {
  script = [429];
  await POST(aiRequest(path, body));
  assert.equal(fakes.openAICalls, 1);
 });

 test(`${path}: client abort is recorded, not promised as cancelled`, async () => {
  const controller = new AbortController();
  controller.abort();
  const response = await POST(aiRequest(path, body, {signal: controller.signal}));
  assert.equal(response.status, 502);
  assert.equal(fakes.finish[0].p_status, "failed");
  assert.equal(fakes.finish[0].p_reason, "client_aborted");
 });
}

test("budget warnings fire once when crossing 50 % and 80 %", async () => {
 const {POST} = routeModule("import-menu");
 for (const [before, after, expected] of [[12, 12.6, ["50%"]], [12.6, 13, []], [19.9, 20.1, ["80%"]], [10, 21, ["50%", "80%"]]]) {
  logs = [];
  fakes.finishResult = {updated: true, month_cost_usd: after, previous_month_cost_usd: before};
  await POST(aiRequest("import-menu", routes["import-menu"].body));
  const warnings = logs.filter(([level, line]) => level === "warn" && line.includes("ai_budget_threshold")).map(([, line]) => JSON.parse(line)[1].threshold);
  assert.deepEqual(warnings, expected, `${before} -> ${after}`);
 }
});
