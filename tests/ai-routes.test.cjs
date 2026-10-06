const {test, beforeEach, afterEach} = require("node:test");
const assert = require("node:assert/strict");
const {safeNextPath, loginHrefFor} = require("../src/lib/navigation.ts");

// Synthetic values only: no real Supabase project or OpenAI key is contacted.
const supabaseUrl = "http://supabase.test";
const validToken = "header.synthetic-valid.signature";
const selection = {
 lunches: ["Pollo asado con batata", "Lentejas estofadas", "Arroz meloso de sepia", "Espaguetis con setas", "Garbanzos con espinacas", "Merluza al horno", "Paella de pollo"],
 dinners: ["Tortilla de patata", "Ensalada de tomate y queso fresco", "Salmón a la plancha", "Crema de calabaza", "Revuelto de champiñones", "Bacalao al pilpil", "Tosta de aguacate"],
};
const importedMenu = {week: "Semana importada", days: [{dayName: "Lunes", lunch: {status: "planned", dishName: "Lentejas"}, dinner: {status: "free", dishName: ""}}]};
const shoppingList = {items: [{name: "lentejas", quantity: 500, unit: "g", category: "despensa"}]};

const routes = {
 "generate-menu": {valid: {peopleCount: 2}, invalidShape: {peopleCount: 9}, maxBytes: 64 * 1024},
 "import-menu": {valid: {text: "Lunes\tLentejas\tLIBRE"}, invalidShape: {text: 42}, maxBytes: 32 * 1024},
 "generate-shopping-list": {valid: {week: [{day: "Lunes", date: "5 oct", lunch: "Lentejas", dinner: "LIBRE"}]}, invalidShape: {week: [{day: "Lunes", date: "5 oct", lunch: {dish: "x"}, dinner: "LIBRE"}]}, maxBytes: 16 * 1024},
};

let openAICalls = 0;
let authCalls = 0;
let authMode = "ok";
const saved = {};

beforeEach(() => {
 openAICalls = 0;
 authCalls = 0;
 authMode = "ok";
 for (const key of ["OPENAI_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) saved[key] = process.env[key];
 saved.fetch = global.fetch;
 process.env.OPENAI_API_KEY = "synthetic-test-key";
 process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
 process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "synthetic-anon-key";
 global.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith(`${supabaseUrl}/auth/v1/user`)) {
   authCalls++;
   if (authMode === "down") throw new TypeError("fetch failed");
   const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
   if (headers.get("authorization") !== `Bearer ${validToken}`) {
    return Response.json({code: 403, error_code: "bad_jwt", msg: "invalid JWT"}, {status: 403});
   }
   return Response.json({id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "fixture-1@example.invalid", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z"});
  }
  openAICalls++;
  if (url.endsWith("/responses")) {
   return Response.json({id: "resp_test", object: "response", status: "completed", output: [{type: "message", id: "msg_test", role: "assistant", status: "completed", content: [{type: "output_text", text: JSON.stringify(shoppingList), annotations: []}]}]});
  }
  const content = JSON.parse(init.body).response_format?.json_schema?.name === "imported_menu" ? importedMenu : selection;
  return Response.json({choices: [{finish_reason: "stop", message: {content: JSON.stringify(content)}}], usage: {prompt_tokens: 10, completion_tokens: 10, total_tokens: 20}});
 };
});

afterEach(() => {
 global.fetch = saved.fetch;
 for (const key of ["OPENAI_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) {
  if (saved[key] === undefined) delete process.env[key];
  else process.env[key] = saved[key];
 }
});

function post(path, {body, token, contentType = "application/json", raw, contentLength} = {}) {
 const headers = new Headers();
 if (contentType) headers.set("content-type", contentType);
 if (token) headers.set("authorization", `Bearer ${token}`);
 if (contentLength !== undefined) headers.set("content-length", String(contentLength));
 return new Request(`http://localhost/api/${path}`, {method: "POST", headers, body: raw ?? JSON.stringify(body)});
}

// A body with no Content-Length, delivered in chunks, to exercise the streaming cap.
function streamedPost(path, text) {
 const bytes = new TextEncoder().encode(text);
 const stream = new ReadableStream({start(controller) {
  for (let i = 0; i < bytes.length; i += 4096) controller.enqueue(bytes.slice(i, i + 4096));
  controller.close();
 }});
 return new Request(`http://localhost/api/${path}`, {method: "POST", duplex: "half", body: stream, headers: {"content-type": "application/json", authorization: `Bearer ${validToken}`}});
}

for (const [path, spec] of Object.entries(routes)) {
 const {POST} = require(`../src/app/api/${path}/route.ts`);

 test(`${path}: no token -> 401 without contacting Auth or OpenAI`, async () => {
  const response = await POST(post(path, {body: spec.valid}));
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /Inicia sesión/);
  assert.equal(authCalls, 0);
  assert.equal(openAICalls, 0);
 });

 test(`${path}: invalid token -> 401 without OpenAI`, async () => {
  assert.equal((await POST(post(path, {body: spec.valid, token: "header.forged.signature"}))).status, 401);
  assert.equal(authCalls, 1);
  assert.equal(openAICalls, 0);
 });

 test(`${path}: Auth unreachable -> 503 without OpenAI`, async () => {
  authMode = "down";
  assert.equal((await POST(post(path, {body: spec.valid, token: validToken}))).status, 503);
  assert.equal(openAICalls, 0);
 });

 test(`${path}: wrong Content-Type -> 415`, async () => {
  assert.equal((await POST(post(path, {body: spec.valid, token: validToken, contentType: "text/plain"}))).status, 415);
  assert.equal(openAICalls, 0);
 });

 test(`${path}: oversized body -> 413 by header and by streamed size`, async () => {
  const big = JSON.stringify({padding: "x".repeat(spec.maxBytes)});
  assert.equal((await POST(post(path, {raw: big, token: validToken, contentLength: big.length}))).status, 413);
  assert.equal(authCalls, 0, "declared size is rejected before verifying the token");
  assert.equal((await POST(streamedPost(path, big))).status, 413);
  assert.equal(openAICalls, 0);
 });

 test(`${path}: malformed JSON and wrong shape -> 400`, async () => {
  assert.equal((await POST(post(path, {raw: "{not json", token: validToken}))).status, 400);
  assert.equal((await POST(post(path, {body: [1, 2], token: validToken}))).status, 400);
  assert.equal((await POST(post(path, {body: spec.invalidShape, token: validToken}))).status, 400);
  assert.equal(openAICalls, 0);
 });

 test(`${path}: valid session with simulated OpenAI -> 200`, async () => {
  const response = await POST(post(path, {body: spec.valid, token: validToken}));
  assert.equal(response.status, 200);
  assert.equal(openAICalls, 1);
 });
}

test("import-menu: text over 8000 characters -> 400 before OpenAI", async () => {
 const {POST} = require("../src/app/api/import-menu/route.ts");
 assert.equal((await POST(post("import-menu", {body: {text: "a".repeat(8001)}, token: validToken}))).status, 400);
 assert.equal(openAICalls, 0);
});

test("generate-shopping-list: more than 7 days or long slots -> 400", async () => {
 const {POST} = require("../src/app/api/generate-shopping-list/route.ts");
 const day = {day: "Lunes", date: "5 oct", lunch: "Lentejas", dinner: "LIBRE"};
 assert.equal((await POST(post("generate-shopping-list", {body: {week: Array(8).fill(day)}, token: validToken}))).status, 400);
 assert.equal((await POST(post("generate-shopping-list", {body: {week: [{...day, lunch: "x".repeat(201)}]}, token: validToken}))).status, 400);
 assert.equal((await POST(post("generate-shopping-list", {body: {week: []}, token: validToken}))).status, 400);
 assert.equal(openAICalls, 0);
});

test("login next path only allows same-origin paths", () => {
 assert.equal(safeNextPath("/create-menu?isoYear=2026&isoWeek=41"), "/create-menu?isoYear=2026&isoWeek=41");
 assert.equal(safeNextPath("/shopping/list"), "/shopping/list");
 for (const value of [null, "", "https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "profile"]) {
  assert.equal(safeNextPath(value), "/profile", String(value));
 }
 assert.equal(loginHrefFor("/create-menu?isoYear=2026&isoWeek=41"), "/login?next=%2Fcreate-menu%3FisoYear%3D2026%26isoWeek%3D41");
});
