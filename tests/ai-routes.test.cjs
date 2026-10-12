const {test, beforeEach, afterEach} = require("node:test");
const assert = require("node:assert/strict");
const {safeNextPath, loginHrefFor} = require("../src/lib/navigation.ts");
const {installFakeBackends, validToken, foodContextFor} = require("./helpers/fake-backends.cjs");

// Synthetic values only: no real Supabase project or OpenAI key is contacted.
const selection = {
 lunches: ["Pollo asado con batata", "Lentejas estofadas", "Arroz meloso de sepia", "Espaguetis con setas", "Garbanzos con espinacas", "Merluza al horno", "Paella de pollo"],
 dinners: ["Tortilla de patata", "Ensalada de tomate y queso fresco", "Salmón a la plancha", "Crema de calabaza", "Revuelto de champiñones", "Bacalao al pilpil", "Tosta de aguacate"],
};
const importedMenu = {week: "Semana importada", days: [{dayName: "Lunes", lunch: {status: "planned", dishName: "Lentejas"}, dinner: {status: "free", dishName: ""}}]};
let menuFileText = {found: true, text: "Lunes\nComida: Lentejas\nCena: LIBRE"};
const shoppingList = {items: [{name: "lentejas", quantity: 500, unit: "g", category: "despensa"}]};

const routes = {
 "generate-menu": {valid: {peopleCount: 2}, invalidShape: {peopleCount: 9}, maxBytes: 64 * 1024},
 // C6: prose with a day name (an unambiguous paste is parsed without OpenAI).
 "import-menu": {valid: {text: "El lunes comemos lentejas"}, invalidShape: {text: 42}, maxBytes: 32 * 1024},
 // Vegan saved profile (C1: read on the server) whose compatible catalogue recipes are already in the week: needs the AI.
 "substitute-dish": {profile: {dietaryRestrictions: ["vegan"]}, valid: {day: "Lunes", meal: "lunch", currentDish: "Crema de calabaza", otherDishes: ["Lentejas estofadas", "Espaguetis con brócoli", "Escalibada", "Espárragos, berenjena, calabacín y zanahoria plancha"]}, invalidShape: {day: "Lunes", meal: "brunch"}, maxBytes: 16 * 1024},
 "generate-shopping-list": {valid: {week: [{day: "Lunes", date: "5 oct", lunch: "Lentejas", dinner: "LIBRE"}]}, invalidShape: {week: [{day: "Lunes", date: "5 oct", lunch: {dish: "x"}, dinner: "LIBRE"}]}, maxBytes: 16 * 1024},
 // C2: one dish of the caller's week (the synthetic week has «Lentejas estofadas» on Monday lunch, version 3).
 // «Ya tengo un menú» from a photo or a scanned PDF: page images, read by the AI.
 "menu-file-text": {valid: {images: ["data:image/jpeg;base64,/9j/4AAQSkZJRg=="]}, invalidShape: {images: ["https://example.com/menu.jpg"]}, maxBytes: 4 * 1024 * 1024},
 "dish-card": {valid: {isoWeek: "2026-W41", day: "Lunes", meal: "lunch", dish: "Lentejas estofadas", expectedVersion: 3, requestKey: "50000000-0000-4000-8000-000000000001"}, invalidShape: {isoWeek: "2026-W41", day: "Lunes", meal: "brunch", dish: "Lentejas estofadas", expectedVersion: 3, requestKey: "50000000-0000-4000-8000-000000000001"}, maxBytes: 4 * 1024},
};
const dishCard = {baseServings: 2, totalMinutes: 50, ingredients: [{name: "lentejas", quantity: 200, unit: "g", category: "despensa", optional: false}], steps: ["Cocer las lentejas con las verduras."], possibleAllergens: []};

let fakes;

let lastOpenAIBody = null;

function openAIResponder(url, init) {
 lastOpenAIBody = JSON.parse(init.body);
 if (url.endsWith("/responses")) {
  const content = JSON.parse(init.body).text?.format?.name === "dish_card" ? dishCard : shoppingList;
  return Response.json({id: "resp_test", object: "response", status: "completed", model: "gpt-5.6-sol", output: [{type: "message", id: "msg_test", role: "assistant", status: "completed", content: [{type: "output_text", text: JSON.stringify(content), annotations: []}]}], usage: {input_tokens: 10, output_tokens: 10, total_tokens: 20}});
 }
 const schema = JSON.parse(init.body).response_format?.json_schema?.name;
 const content = schema === "menu_file_text" ? menuFileText : schema === "imported_menu" ? importedMenu : schema === "dish_substitution" ? {dish: "Garbanzos con espinacas y comino"} : selection;
 return Response.json({choices: [{finish_reason: "stop", message: {content: JSON.stringify(content)}}], usage: {prompt_tokens: 10, completion_tokens: 10, total_tokens: 20}});
}

beforeEach(() => {
 menuFileText = {found: true, text: "Lunes\nComida: Lentejas\nCena: LIBRE"};
 fakes = installFakeBackends(openAIResponder);
});
afterEach(() => fakes.restore());

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
  assert.equal(fakes.authCalls, 0);
  assert.equal(fakes.openAICalls, 0);
 });

 test(`${path}: invalid token -> 401 without OpenAI`, async () => {
  assert.equal((await POST(post(path, {body: spec.valid, token: "header.forged.signature"}))).status, 401);
  assert.equal(fakes.authCalls, 1);
  assert.equal(fakes.openAICalls, 0);
 });

 test(`${path}: Auth unreachable -> 503 without OpenAI`, async () => {
  fakes.authMode = "down";
  assert.equal((await POST(post(path, {body: spec.valid, token: validToken}))).status, 503);
  assert.equal(fakes.openAICalls, 0);
 });

 test(`${path}: wrong Content-Type -> 415`, async () => {
  assert.equal((await POST(post(path, {body: spec.valid, token: validToken, contentType: "text/plain"}))).status, 415);
  assert.equal(fakes.openAICalls, 0);
 });

 test(`${path}: oversized body -> 413 by header and by streamed size`, async () => {
  const big = JSON.stringify({padding: "x".repeat(spec.maxBytes)});
  assert.equal((await POST(post(path, {raw: big, token: validToken, contentLength: big.length}))).status, 413);
  assert.equal(fakes.authCalls, 0, "declared size is rejected before verifying the token");
  assert.equal((await POST(streamedPost(path, big))).status, 413);
  assert.equal(fakes.openAICalls, 0);
 });

 test(`${path}: malformed JSON and wrong shape -> 400`, async () => {
  assert.equal((await POST(post(path, {raw: "{not json", token: validToken}))).status, 400);
  assert.equal((await POST(post(path, {body: [1, 2], token: validToken}))).status, 400);
  assert.equal((await POST(post(path, {body: spec.invalidShape, token: validToken}))).status, 400);
  assert.equal(fakes.openAICalls, 0);
 });

 test(`${path}: valid session with simulated OpenAI -> 200`, async () => {
  if (spec.profile) fakes.foodContext = foodContextFor(spec.profile);
  const response = await POST(post(path, {body: spec.valid, token: validToken}));
  assert.equal(response.status, 200);
  assert.equal(fakes.openAICalls, 1);
 });

 // Wave 8: OPENAI_BASE_URL in any Vercel environment -> 503 before the ledger and OpenAI.
 test(`${path}: OPENAI_BASE_URL on Vercel -> 503 without ledger row or OpenAI`, async () => {
  if (spec.profile) fakes.foodContext = foodContextFor(spec.profile);
  const saved = {VERCEL_ENV: process.env.VERCEL_ENV, OPENAI_BASE_URL: process.env.OPENAI_BASE_URL};
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
   for (const vercelEnv of ["preview", "production", "development"]) {
    Object.assign(process.env, {VERCEL_ENV: vercelEnv, OPENAI_BASE_URL: "http://127.0.0.1:4010/v1"});
    const response = await POST(post(path, {body: spec.valid, token: validToken}));
    assert.equal(response.status, 503, vercelEnv);
    assert.match((await response.json()).error, /no está disponible/);
   }
  } finally {
   console.error = originalError;
   for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
   }
  }
  assert.equal(fakes.begin.length, 0, "no ledger row");
  assert.equal(fakes.openAICalls, 0);
  assert.deepEqual(logged.map(([event, fields]) => [event, fields.flow, fields.vercelEnv]), [
   ["openai_base_url_blocked", path, "preview"], ["openai_base_url_blocked", path, "production"], ["openai_base_url_blocked", path, "development"],
  ]);
  assert.doesNotMatch(JSON.stringify(logged), /127\.0\.0\.1|synthetic-test-key/);
 });
}

test("import-menu: text over 8000 characters -> 400 before OpenAI", async () => {
 const {POST} = require("../src/app/api/import-menu/route.ts");
 assert.equal((await POST(post("import-menu", {body: {text: "a".repeat(8001)}, token: validToken}))).status, 400);
 assert.equal(fakes.openAICalls, 0);
});

test("generate-shopping-list: more than 7 days or long slots -> 400", async () => {
 const {POST} = require("../src/app/api/generate-shopping-list/route.ts");
 const day = {day: "Lunes", date: "5 oct", lunch: "Lentejas", dinner: "LIBRE"};
 assert.equal((await POST(post("generate-shopping-list", {body: {week: Array(8).fill(day)}, token: validToken}))).status, 400);
 assert.equal((await POST(post("generate-shopping-list", {body: {week: [{...day, lunch: "x".repeat(201)}]}, token: validToken}))).status, 400);
 assert.equal((await POST(post("generate-shopping-list", {body: {week: []}, token: validToken}))).status, 400);
 assert.equal(fakes.openAICalls, 0);
});

test("login next path only allows same-origin paths", () => {
 assert.equal(safeNextPath("/create-menu?isoYear=2026&isoWeek=41"), "/create-menu?isoYear=2026&isoWeek=41");
 assert.equal(safeNextPath("/shopping/list"), "/shopping/list");
 for (const value of [null, "", "https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "profile"]) {
  // Step 23: the default destination after login is the week (it was /profile).
  assert.equal(safeNextPath(value), "/week", String(value));
 }
 assert.equal(loginHrefFor("/create-menu?isoYear=2026&isoWeek=41"), "/login?next=%2Fcreate-menu%3FisoYear%3D2026%26isoWeek%3D41");
});

// P37: the account routes share the guard battery (session verified by Auth, cheap checks first,
// nothing destructive or costly before a valid request).
const accountRoutes = {
 "account/export": {method: "GET", handler: () => require("../src/app/api/account/export/route.ts").GET},
 "account/delete": {method: "POST", handler: () => require("../src/app/api/account/delete/route.ts").POST, body: {confirmation: "ELIMINAR"}},
};
const accountRequest = (path, {method, body, token, contentType = "application/json", raw, contentLength} = {}) => {
 const headers = new Headers();
 if (token) headers.set("authorization", `Bearer ${token}`);
 if (method === "POST" && contentType) headers.set("content-type", contentType);
 if (contentLength !== undefined) headers.set("content-length", String(contentLength));
 return new Request(`http://localhost/api/${path}`, {method, headers, body: method === "POST" ? raw ?? JSON.stringify(body) : undefined});
};
for (const [path, spec] of Object.entries(accountRoutes)) {
 test(`${path}: no token -> 401 without contacting Auth`, async () => {
  const response = await spec.handler()(accountRequest(path, {method: spec.method, body: spec.body}));
  assert.equal(response.status, 401);
  assert.equal(fakes.authCalls, 0);
 });
 test(`${path}: invalid token -> 401; Auth unreachable -> 503`, async () => {
  assert.equal((await spec.handler()(accountRequest(path, {method: spec.method, body: spec.body, token: "header.forged.signature"}))).status, 401);
  assert.equal(fakes.authCalls, 1);
  fakes.authMode = "down";
  assert.equal((await spec.handler()(accountRequest(path, {method: spec.method, body: spec.body, token: validToken}))).status, 503);
  assert.equal(fakes.openAICalls, 0, "no other backend contacted");
 });
}
test("account/delete: 415, 413 (header before Auth, and streamed), 400 and wrong confirmation before any deletion", async () => {
 const {POST} = require("../src/app/api/account/delete/route.ts");
 const send = options => POST(accountRequest("account/delete", {method: "POST", token: validToken, ...options}));
 assert.equal((await send({body: {confirmation: "ELIMINAR"}, contentType: "text/plain"})).status, 415);
 const big = JSON.stringify({confirmation: "ELIMINAR", padding: "x".repeat(2048)});
 assert.equal((await send({raw: big, contentLength: big.length})).status, 413);
 assert.equal(fakes.authCalls, 0, "declared size is rejected before verifying the token");
 assert.equal((await send({raw: big})).status, 413);
 assert.equal((await send({raw: "{not json"})).status, 400);
 assert.equal((await send({body: [1]})).status, 400);
 assert.equal((await send({body: {confirmation: "eliminar"}})).status, 400);
 // The admin API is not a known backend of the fakes: any call to it would count here.
 assert.equal(fakes.openAICalls, 0);
});

test("menu-file-text: the images go to OpenAI unstored and the text comes back for the paste box", async () => {
 const {POST} = require("../src/app/api/menu-file-text/route.ts");
 const response = await POST(post("menu-file-text", {body: {images: ["data:image/jpeg;base64,/9j/4AAQSkZJRg==", "data:image/png;base64,iVBORw0KGgo="]}, token: validToken}));
 assert.equal(response.status, 200);
 assert.deepEqual(await response.json(), {text: "Lunes\nComida: Lentejas\nCena: LIBRE"});
 assert.equal(fakes.begin.length, 1, "counts as an import in the AI ledger");
 const sent = lastOpenAIBody;
 assert.equal(sent.store, false);
 assert.deepEqual(sent.messages[1].content.filter(part => part.type === "image_url").map(part => part.image_url.url.slice(0, 15)), ["data:image/jpeg", "data:image/png;"]);
});

test("menu-file-text: no menu in the images -> 422 that still counts", async () => {
 menuFileText = {found: false, text: ""};
 const {POST} = require("../src/app/api/menu-file-text/route.ts");
 const response = await POST(post("menu-file-text", {body: {images: ["data:image/jpeg;base64,/9j/4AAQSkZJRg=="]}, token: validToken}));
 assert.equal(response.status, 422);
 assert.equal((await response.json()).reason, "no_text_found");
 assert.equal(fakes.openAICalls, 1);
});

test("menu-file-text: more than 4 images -> 400 before OpenAI", async () => {
 const {POST} = require("../src/app/api/menu-file-text/route.ts");
 const images = Array(5).fill("data:image/jpeg;base64,/9j/4AAQSkZJRg==");
 assert.equal((await POST(post("menu-file-text", {body: {images}, token: validToken}))).status, 400);
 assert.equal(fakes.openAICalls, 0);
});
