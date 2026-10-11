const {test} = require("node:test");
const assert = require("node:assert/strict");

// C6 (roadmap step 22, and the Crear menú part of step 32): an unambiguous pasted menu is ordered on
// the device without any request or quota; the route repeats that attempt before the AI, answers
// 400/422/502 with a reason, and the form and the proposal are kept per identity and week.
// Synthetic values only: no Supabase project or OpenAI key is contacted.
const {installFakeBackends, validToken} = require("./helpers/fake-backends.cjs");

const structured = "Lunes\nComida: Salmón con calabacín\nCena: LIBRE\n\nMartes\nComida: Pollo con arroz\nCena: Tortilla francesa";
const tabular = "DÍA\tCOMIDA\tCENA\nLunes\tLentejas estofadas\tLIBRE\nMIÉRCOLES\tMerluza al horno\tCrema de calabaza";
// Has day names but no line the local parser accepts: only the AI can order it.
const prose = "El lunes comemos lentejas y el martes pescado; las cenas, algo ligero";

// --- Local parser ------------------------------------------------------------------------------
const importMenu = require("../src/lib/importMenu.ts");

test("day headers with «Comida:»/«Cena:» lines are parsed on the device, in week order", () => {
 const result = importMenu.parseMenuTextLocally(structured);
 assert.equal(result.kind, "parsed");
 assert.deepEqual(result.days, [
  {dayName: "Lunes", lunch: {status: "planned", dishName: "Salmón con calabacín"}, dinner: {status: "free", dishName: ""}},
  {dayName: "Martes", lunch: {status: "planned", dishName: "Pollo con arroz"}, dinner: {status: "planned", dishName: "Tortilla francesa"}},
 ]);
 assert.deepEqual(result.warnings, []);
});

test("three-column rows (tabs, pipes or wide spaces) with an optional DÍA|COMIDA|CENA header are parsed", () => {
 const result = importMenu.parseMenuTextLocally(tabular);
 assert.equal(result.kind, "parsed");
 assert.deepEqual(result.days.map(day => [day.dayName, day.lunch.dishName, day.dinner.status]), [
  ["Lunes", "Lentejas estofadas", "free"],
  ["Miércoles", "Merluza al horno", "planned"],
 ]);
 const piped = importMenu.parseMenuTextLocally("| Día | Comida | Cena |\n| Jueves | Garbanzos con espinacas | Revuelto de setas |");
 assert.equal(piped.kind, "parsed");
 assert.equal(piped.days[0].dayName, "Jueves");
 const spaced = importMenu.parseMenuTextLocally("Viernes    Paella de pollo    Libre");
 assert.equal(spaced.kind, "parsed");
 assert.equal(spaced.days[0].dinner.status, "free");
});

test("a day without one of its meals is parsed with that meal free, and the user is told", () => {
 const result = importMenu.parseMenuTextLocally("Sábado\nComida: Arroz meloso de sepia");
 assert.equal(result.kind, "parsed");
 assert.equal(result.days[0].dinner.status, "free");
 assert.equal(result.warnings.length, 1);
 assert.match(result.warnings[0], /Sábado.*cena/i);
});

test("anything not clearly a menu line, a repeated day, a meal before any day, a long title or a 4th column is ambiguous", () => {
 const cases = {
  [prose]: "unrecognized_line",
  "Lunes\tLentejas\tLIBRE\nLunes\tGarbanzos\tSopa": "repeated_day",
  "Lunes\nComida: Lentejas\nComida: Garbanzos": "repeated_meal",
  "Comida: Lentejas\nLunes\nCena: Sopa": "meal_without_day",
  [`Lunes\tLentejas ${"muy ".repeat(40)}buenas\tLIBRE`]: "title_too_long",
  "Lunes\tLentejas\tSopa\tPostre": "unrecognized_line",
  "Lunes: lentejas": "unrecognized_line",
  "": "empty",
 };
 for (const [text, reason] of Object.entries(cases)) {
  assert.deepEqual(importMenu.parseMenuTextLocally(text), {kind: "ambiguous", reason}, JSON.stringify(text));
 }
});

test("a menu is only recognisable if some day of the week is named (accents and case do not matter)", () => {
 assert.equal(importMenu.mentionsAnyDayName(prose), true);
 assert.equal(importMenu.mentionsAnyDayName("MIERCOLES: arroz"), true);
 assert.equal(importMenu.mentionsAnyDayName("sábado"), true);
 assert.equal(importMenu.mentionsAnyDayName("Lista de la compra: tomates, lunetas de chocolate"), false);
});

test("pasted text limits: empty, over 8000 characters or over 80 lines, each with its reason", () => {
 const limits = {maxTextLength: 8000, maxLines: 80};
 assert.deepEqual(importMenu.validateImportText("  \n ", limits).reason, "empty");
 assert.deepEqual(importMenu.validateImportText(42, limits).reason, "not_text");
 assert.deepEqual(importMenu.validateImportText("a".repeat(8001), limits).reason, "too_long");
 assert.deepEqual(importMenu.validateImportText(Array(81).fill("Lunes").join("\n"), limits).reason, "too_many_lines");
 // Blank lines (common when copying from a spreadsheet) do not count.
 assert.deepEqual(importMenu.validateImportText(Array(200).fill("").concat(["Lunes"]).join("\n"), limits), {ok: true, text: "Lunes"});
 for (const reason of ["empty", "not_text", "too_long", "too_many_lines", "no_menu_found", "empty_menu"]) {
  assert.ok(importMenu.importErrorMessage(reason, "x").length > 10, reason);
 }
});

// --- Route ---------------------------------------------------------------------------------------
let fakes;
let aiDays;
let aiBodies;
function openAI(_url, init) {
 const body = JSON.parse(init.body);
 aiBodies.push(body);
 const content = aiDays === "invalid" ? {nope: true} : {week: "Semana importada", days: aiDays};
 return Response.json({choices: [{finish_reason: "stop", message: {content: JSON.stringify(content)}}], usage: {prompt_tokens: 300, completion_tokens: 80, total_tokens: 380}});
}

function post(text) {
 return new Request("http://localhost/api/import-menu", {
  method: "POST",
  headers: {"content-type": "application/json", authorization: `Bearer ${validToken}`},
  body: JSON.stringify({text}),
 });
}

function withRoute(fn) {
 return async () => {
  aiDays = [{dayName: "Lunes", lunch: {status: "planned", dishName: "Lentejas"}, dinner: {status: "free", dishName: ""}}];
  aiBodies = [];
  fakes = installFakeBackends(openAI);
  const info = console.info;
  console.info = () => {};
  try {
   await fn(require("../src/app/api/import-menu/route.ts"));
  } finally {
   console.info = info;
   fakes.restore();
  }
 };
}

test("route: an unambiguous menu is answered by the local parser, without OpenAI and without opening a quota record", withRoute(async ({POST}) => {
 for (const text of [structured, tabular]) {
  const response = await POST(post(text));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.parsedBy, "local");
  assert.ok(importMenu.isImportedMenuResponse(data));
  assert.ok(data.days.length >= 2);
 }
 assert.equal(fakes.openAICalls, 0);
 assert.equal(fakes.begin.length, 0, "no quota is consumed");
}));

test("route: no day name anywhere -> 422 no_menu_found before the AI and without cost", withRoute(async ({POST}) => {
 const response = await POST(post("Hola, quiero algo sano para toda la familia"));
 assert.equal(response.status, 422);
 const data = await response.json();
 assert.equal(data.reason, "no_menu_found");
 assert.match(data.error, /día/);
 assert.equal(fakes.openAICalls, 0);
 assert.equal(fakes.begin.length, 0);
}));

test("route: a local menu with every meal free -> 422 empty_menu without the AI", withRoute(async ({POST}) => {
 const response = await POST(post("Lunes\tLIBRE\tLIBRE"));
 assert.equal(response.status, 422);
 assert.equal((await response.json()).reason, "empty_menu");
 assert.equal(fakes.openAICalls, 0);
}));

test("route: an ambiguous menu goes to the AI with a token cap and comes back marked parsedBy «ai»", withRoute(async ({POST}) => {
 const response = await POST(post(prose));
 assert.equal(response.status, 200);
 const data = await response.json();
 assert.equal(data.parsedBy, "ai");
 assert.equal(fakes.openAICalls, 1);
 assert.equal(fakes.begin.length, 1);
 assert.ok(aiBodies[0].max_completion_tokens > 0 && aiBodies[0].max_completion_tokens <= 2000);
 assert.equal(fakes.finish[0].p_status, "succeeded");
}));

test("route: the AI finds no planned dish -> 422 empty_menu, recorded as failed with its tokens (it counts, A4)", withRoute(async ({POST}) => {
 aiDays = [{dayName: "Lunes", lunch: {status: "free", dishName: ""}, dinner: {status: "free", dishName: ""}}];
 const response = await POST(post(prose));
 assert.equal(response.status, 422);
 assert.equal((await response.json()).reason, "empty_menu");
 assert.equal(fakes.finish[0].p_status, "failed");
 assert.equal(fakes.finish[0].p_reason, "empty_menu");
 assert.ok(fakes.finish[0].p_prompt_tokens > 0);
}));

test("route: invalid model output -> 502 with a reason", withRoute(async ({POST}) => {
 aiDays = "invalid";
 const response = await POST(post(prose));
 assert.equal(response.status, 502);
 assert.equal((await response.json()).reason, "invalid_output");
}));

test("route: 400 with a reason for wrong type, empty text, too long or too many lines, before any cost", withRoute(async ({POST}) => {
 const cases = [[42, "not_text"], ["   ", "empty"], ["a".repeat(8001), "too_long"], [Array(81).fill("Lunes\tLentejas\tSopa").join("\n"), "too_many_lines"]];
 for (const [text, reason] of cases) {
  const response = await POST(post(text));
  assert.equal(response.status, 400, reason);
  assert.equal((await response.json()).reason, reason);
 }
 assert.equal(fakes.openAICalls, 0);
 assert.equal(fakes.begin.length, 0);
}));
