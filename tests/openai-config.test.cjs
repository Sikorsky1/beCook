const { test } = require("node:test");
const assert = require("node:assert/strict");
const { openAIBaseUrlBlocked, blockedOpenAIEndpointResponse } = require("../src/lib/openai/config.ts");

// Synthetic values only: the base URL is the local E2E mock and nothing is contacted.
const mockUrl = "http://127.0.0.1:4010/v1";

function captureErrors(run) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args);
  try { return { result: run(), lines }; } finally { console.error = original; }
}

test("OPENAI_BASE_URL is refused in every Vercel environment", () => {
  assert.equal(openAIBaseUrlBlocked({ VERCEL_ENV: "production", OPENAI_BASE_URL: mockUrl }), true);
  assert.equal(openAIBaseUrlBlocked({ VERCEL_ENV: " production ", OPENAI_BASE_URL: ` ${mockUrl} ` }), true);
  assert.equal(openAIBaseUrlBlocked({ VERCEL_ENV: "preview", OPENAI_BASE_URL: mockUrl }), true);
  assert.equal(openAIBaseUrlBlocked({ VERCEL_ENV: "development", OPENAI_BASE_URL: mockUrl }), true);
  assert.equal(openAIBaseUrlBlocked({ VERCEL_ENV: "  ", OPENAI_BASE_URL: mockUrl }), false);
  assert.equal(openAIBaseUrlBlocked({ OPENAI_BASE_URL: mockUrl }), false);
  assert.equal(openAIBaseUrlBlocked({ VERCEL_ENV: "production" }), false);
  assert.equal(openAIBaseUrlBlocked({ VERCEL_ENV: "production", OPENAI_BASE_URL: "   " }), false);
});

test("blocked endpoint -> 503 and a log with the flow, never the URL", async () => {
  const { result, lines } = captureErrors(() =>
    blockedOpenAIEndpointResponse("menu", { VERCEL_ENV: "production", OPENAI_BASE_URL: mockUrl, OPENAI_API_KEY: "sk-test-e2e-local" }),
  );
  assert.ok(result);
  assert.equal(result.status, 503);
  assert.match((await result.json()).error, /no está disponible/);
  assert.deepEqual(lines, [["openai_base_url_blocked", { flow: "menu", vercelEnv: "production" }]]);
  assert.doesNotMatch(JSON.stringify(lines), /127\.0\.0\.1|sk-test/);
});

test("blocked in Preview too, with the environment in the log", () => {
  const { result, lines } = captureErrors(() => blockedOpenAIEndpointResponse("import-menu", { VERCEL_ENV: "preview", OPENAI_BASE_URL: mockUrl }));
  assert.equal(result.status, 503);
  assert.deepEqual(lines, [["openai_base_url_blocked", { flow: "import-menu", vercelEnv: "preview" }]]);
});

test("allowed endpoint -> null and no log (local E2E, CI, Vercel without override)", () => {
  for (const env of [{ OPENAI_BASE_URL: mockUrl }, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "production" }]) {
    const { result, lines } = captureErrors(() => blockedOpenAIEndpointResponse("shopping", env));
    assert.equal(result, null);
    assert.equal(lines.length, 0);
  }
});

// next.config.ts fails the build on Vercel (VERCEL is set in every Vercel build) when the variable exists.
test("next.config.ts refuses OPENAI_BASE_URL on Vercel and allows local and CI builds", () => {
  const { assertNoOpenAIBaseUrlOnVercel } = require("../next.config.ts");
  assert.throws(() => assertNoOpenAIBaseUrlOnVercel({ VERCEL: "1", OPENAI_BASE_URL: mockUrl }), /OPENAI_BASE_URL no está permitida en Vercel/);
  assert.throws(() => assertNoOpenAIBaseUrlOnVercel({ VERCEL: "1", VERCEL_ENV: "preview", OPENAI_BASE_URL: mockUrl }));
  assert.doesNotThrow(() => assertNoOpenAIBaseUrlOnVercel({ OPENAI_BASE_URL: mockUrl, CI: "true" }));
  assert.doesNotThrow(() => assertNoOpenAIBaseUrlOnVercel({ VERCEL: "1" }));
  assert.doesNotThrow(() => assertNoOpenAIBaseUrlOnVercel({ VERCEL: "1", OPENAI_BASE_URL: "  " }));
});
