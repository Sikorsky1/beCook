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

test("OPENAI_BASE_URL is refused only in Vercel production", () => {
  assert.equal(openAIBaseUrlBlocked({ VERCEL_ENV: "production", OPENAI_BASE_URL: mockUrl }), true);
  assert.equal(openAIBaseUrlBlocked({ VERCEL_ENV: " production ", OPENAI_BASE_URL: ` ${mockUrl} ` }), true);
  assert.equal(openAIBaseUrlBlocked({ VERCEL_ENV: "preview", OPENAI_BASE_URL: mockUrl }), false);
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

test("allowed endpoint -> null and no log (local E2E, Preview, production without override)", () => {
  for (const env of [{ OPENAI_BASE_URL: mockUrl }, { VERCEL_ENV: "preview", OPENAI_BASE_URL: mockUrl }, { VERCEL_ENV: "production" }]) {
    const { result, lines } = captureErrors(() => blockedOpenAIEndpointResponse("shopping", env));
    assert.equal(result, null);
    assert.equal(lines.length, 0);
  }
});
