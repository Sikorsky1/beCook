const {test} = require("node:test");
const assert = require("node:assert/strict");
const OpenAI = require("openai").default;
const {withOneRetry, shoppingTimeoutMs, shoppingReasoningEffort, shoppingQuickFailureMs} = require("../src/lib/openai/retry.ts");
const {installFakeBackends, aiRequest} = require("./helpers/fake-backends.cjs");

// A4.1: shopping is extraction. Low reasoning, one 55 s attempt, no retry after a timeout.
const timeoutError = () => new OpenAI.APIConnectionTimeoutError();
const connectionError = () => new OpenAI.APIConnectionError({message: "synthetic"});
const serverError = () => OpenAI.APIError.generate(503, {error: {message: "synthetic"}}, "synthetic", new Headers());

async function attemptsFor(failures, options) {
 let calls = 0;
 const result = await withOneRetry(async () => {
  const failure = failures[calls++];
  if (failure) throw failure();
  return "ok";
 }, options).catch(() => "failed");
 return {calls, result};
}

test("shopping settings: low reasoning, 55 s per attempt, quick-failure window of 10 s", () => {
 assert.equal(shoppingReasoningEffort, "low");
 assert.equal(shoppingTimeoutMs, 55_000);
 assert.equal(shoppingQuickFailureMs, 10_000);
});

test("default policy (import) still retries once after a timeout", async () => {
 assert.deepEqual(await attemptsFor([timeoutError]), {calls: 2, result: "ok"});
 assert.deepEqual(await attemptsFor([timeoutError, timeoutError]), {calls: 2, result: "failed"});
});

test("shopping policy: no retry after a timeout; one retry after a quick connection error or 5xx", async () => {
 const shopping = {retryOnTimeout: false, maxFailureMsForRetry: shoppingQuickFailureMs};
 assert.deepEqual(await attemptsFor([timeoutError], shopping), {calls: 1, result: "failed"});
 assert.deepEqual(await attemptsFor([connectionError], shopping), {calls: 2, result: "ok"});
 assert.deepEqual(await attemptsFor([serverError], shopping), {calls: 2, result: "ok"});
 assert.deepEqual(await attemptsFor([serverError, serverError], shopping), {calls: 2, result: "failed"});
});

test("shopping policy: a slow 5xx is not retried", async () => {
 let calls = 0;
 const result = await withOneRetry(async () => {
  calls++;
  await new Promise(resolve => setTimeout(resolve, 30));
  throw serverError();
 }, {retryOnTimeout: false, maxFailureMsForRetry: 10}).catch(() => "failed");
 assert.deepEqual({calls, result}, {calls: 1, result: "failed"});
});

test("shopping route sends reasoning effort low and the menu/import routes are unchanged", async () => {
 const bodies = [];
 const fakes = installFakeBackends((url, init) => {
  bodies.push({url, body: JSON.parse(init.body)});
  if (url.endsWith("/responses")) return Response.json({id: "r", object: "response", status: "completed", model: "gpt-5.6-sol", output: [{type: "message", id: "m", role: "assistant", status: "completed", content: [{type: "output_text", text: JSON.stringify({items: [{name: "lentejas", quantity: 500, unit: "g", category: "despensa"}]}), annotations: []}]}], usage: {input_tokens: 1, output_tokens: 1, total_tokens: 2}});
  return Response.json({choices: [{finish_reason: "stop", message: {content: JSON.stringify({week: "Semana importada", days: []})}}], usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2}});
 });
 const info = console.info; const log = console.log;
 console.info = () => {}; console.log = () => {};
 try {
  const shopping = require("../src/app/api/generate-shopping-list/route.ts");
  const importMenu = require("../src/app/api/import-menu/route.ts");
  assert.equal((await shopping.POST(aiRequest("generate-shopping-list", {week: [{day: "Lunes", date: "6 oct", lunch: "Lentejas", dinner: "LIBRE"}]}))).status, 200);
  await importMenu.POST(aiRequest("import-menu", {text: "Lunes\tLentejas\tLIBRE"}));
  assert.deepEqual(bodies[0].body.reasoning, {effort: "low"});
  assert.equal(bodies[1].body.reasoning, undefined);
  assert.equal(bodies[1].body.reasoning_effort, undefined);
  assert.ok(shopping.maxDuration >= (shoppingQuickFailureMs + shoppingTimeoutMs) / 1000 + 10, "maxDuration covers the worst case");
 } finally {
  console.info = info; console.log = log;
  fakes.restore();
 }
});
