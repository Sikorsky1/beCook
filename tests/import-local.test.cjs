const {test, beforeEach, afterEach} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// C6 (roadmap step 22, and the Crear menú part of step 32): an unambiguous pasted menu is ordered on
// the device without any request or quota; the route repeats that attempt before the AI, answers
// 400/422/502 with a reason, and the form and the proposal are kept per identity and week.
// Synthetic values only: no Supabase project or OpenAI key is contacted.
const {installFakeBackends, validToken} = require("./helpers/fake-backends.cjs");
const {createDevice, useDevice} = require("./helpers/fake-browser.cjs");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const asA = {scope: "u_" + A, userId: A};
const asB = {scope: "u_" + B, userId: B};
const guest = {scope: "guest", userId: null};
const W41 = {isoYear: 2026, isoWeek: 41};
const W42 = {isoYear: 2026, isoWeek: 42};

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
 // Columns by spaces only as an aligned fixed-width table of two or more rows.
 const spaced = importMenu.parseMenuTextLocally("Viernes    Paella de pollo    Libre\nSábado     Lentejas           Sopa de ajo");
 assert.equal(spaced.kind, "parsed");
 assert.equal(spaced.days[0].dinner.status, "free");
 assert.equal(spaced.days[1].lunch.dishName, "Lentejas");
});

test("review: one separator per line; spaces split columns only in an aligned table, never one loose line", () => {
 const tab = importMenu.parseMenuTextLocally("Lunes\tLentejas con  chorizo\tSopa");
 assert.equal(tab.kind, "parsed");
 assert.equal(tab.days[0].lunch.dishName, "Lentejas con  chorizo", "inside a tab row, spaces belong to the dish");
 const pipe = importMenu.parseMenuTextLocally("Lunes | Lentejas  con chorizo | Sopa");
 assert.equal(pipe.days[0].lunch.dishName, "Lentejas  con chorizo");
 assert.deepEqual(importMenu.parseMenuTextLocally("Lunes  Lentejas con  chorizo"), {kind: "ambiguous", reason: "unaligned_columns"});
 assert.deepEqual(importMenu.parseMenuTextLocally("Lunes  Lentejas  Sopa\nMartes    Pollo  Tortilla"), {kind: "ambiguous", reason: "unaligned_columns"});
 assert.deepEqual(importMenu.parseMenuTextLocally("Lunes  Lentejas  Sopa  Postre\nMartes  Pollo  Tortilla  Fruta"), {kind: "ambiguous", reason: "unrecognized_line"});
});

test("review: «Comida: X; Cena: Y» in one line is ambiguous; cells keep their own label and free markers", () => {
 assert.deepEqual(importMenu.parseMenuTextLocally("Lunes\nComida: Lentejas; Cena: Pollo"), {kind: "ambiguous", reason: "several_meals_in_line"});
 const labelled = importMenu.parseMenuTextLocally("Lunes\tComida: Lentejas\tCena: Sopa");
 assert.equal(labelled.kind, "parsed");
 assert.deepEqual([labelled.days[0].lunch.dishName, labelled.days[0].dinner.dishName], ["Lentejas", "Sopa"]);
 assert.deepEqual(importMenu.parseMenuTextLocally("Lunes\tCena: Sopa\tComida: Lentejas"), {kind: "ambiguous", reason: "label_mismatch"});
 assert.deepEqual(importMenu.parseMenuTextLocally("Lunes\tLentejas; cena: sopa\tLIBRE"), {kind: "ambiguous", reason: "label_mismatch"});
 for (const free of ["-", "–", "—", "·", "x", "X", "/", "Libre.", "LIBRE"]) {
  const result = importMenu.parseMenuTextLocally(`Lunes\tLentejas\t${free}`);
  assert.equal(result.days[0].dinner.status, "free", free);
 }
 const empty = importMenu.parseMenuTextLocally("Lunes\t\tSopa");
 assert.equal(empty.days[0].lunch.status, "free");
 assert.match(empty.warnings[0], /Lunes: la comida está vacía/);
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
 // Review: abbreviations, «X» at the start of a line and English names (only to decide on the AI).
 for (const text of ["Lun: lentejas", "mié. arroz", "Sáb pollo", "X: crema de calabaza", "Monday: soup", "wed - pasta"]) {
  assert.equal(importMenu.mentionsAnyDayName(text), true, text);
 }
 assert.equal(importMenu.mentionsAnyDayName("2 x 3 tomates y pan"), false);
});

test("review: the browser's text limits are the route's, and client code never imports @/lib/server", () => {
 const {aiRequestLimits} = require("../src/lib/server/ai-limits.ts");
 assert.equal(importMenu.importTextLimits.maxTextLength, aiRequestLimits.importMenu.maxTextLength);
 assert.equal(importMenu.importTextLimits.maxLines, aiRequestLimits.importMenu.maxLines);
 const clientFiles = ["src/components/pages/CreateMenuPage.tsx", "src/components/features/ImportMenuPanel.tsx", "src/lib/importMenu.ts", "src/lib/importWarnings.ts"];
 for (const file of clientFiles) assert.ok(!read(file).includes("@/lib/server/"), file);
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
 const body = await response.json();
 assert.equal(body.reason, "empty_menu");
 assert.match(body.error, /cuenta como una de tus importaciones/);
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

// --- Form draft and proposal per identity and week -----------------------------------------------
let restoreDevice;
beforeEach(() => { restoreDevice = useDevice(createDevice()); });
afterEach(() => restoreDevice());

const draft = {mode: "import", menuText: "Lunes\tLentejas\tLIBRE", freeTextPrompt: "", peopleCount: 3, menuStyles: ["mediterranean"], elaborationLevel: 2};

test("the form draft is kept on this device per identity and week: another account, a guest or another week never see it", () => {
 const {readMenuFormDraft, writeMenuFormDraft, clearMenuFormDraft} = require("../src/lib/createMenuDraft.ts");
 writeMenuFormDraft(asA, W41, draft);
 assert.deepEqual(readMenuFormDraft(asA, W41), draft);
 assert.equal(readMenuFormDraft(asB, W41), null);
 assert.equal(readMenuFormDraft(guest, W41), null);
 assert.equal(readMenuFormDraft(asA, W42), null);
 assert.ok(window.localStorage.getItem(`becook:u_${A}:menu-draft:2026-W41`));
 clearMenuFormDraft(asA, W41);
 assert.equal(readMenuFormDraft(asA, W41), null);
});

test("the guest → login trip still uses the unscoped session draft (on purpose)", () => {
 const {consumeCreateMenuDraft, saveCreateMenuDraft} = require("../src/lib/createMenuDraft.ts");
 saveCreateMenuDraft(draft);
 assert.deepEqual(consumeCreateMenuDraft(), draft);
 assert.equal(consumeCreateMenuDraft(), null);
});

test("drafts and proposals of past weeks are removed when Crear menú loads; this week and later ones stay", () => {
 const {writeMenuFormDraft, readMenuFormDraft, pruneStaleMenuDrafts} = require("../src/lib/createMenuDraft.ts");
 const {writeMenuProposal, readMenuProposal} = require("../src/lib/menuProposal.ts");
 const menu = {week: "Semana importada", days: [{dayName: "Lunes", lunch: {status: "planned", dishName: "Lentejas"}, dinner: {status: "free", dishName: ""}}]};
 const W40 = {isoYear: 2026, isoWeek: 40};
 for (const week of [W40, W41, W42]) {
  writeMenuFormDraft(asA, week, draft);
  writeMenuProposal(asA, week, {menu, generationRequestId: null, attempt: null, source: "import", parsedBy: "local", contextVersion: null, createdAt: "2026-10-05T10:00:00.000Z"});
 }
 writeMenuFormDraft(asB, W40, draft);
 pruneStaleMenuDrafts(asA, W41);
 assert.equal(readMenuFormDraft(asA, W40), null);
 assert.equal(readMenuProposal(asA, W40), null);
 assert.deepEqual(readMenuFormDraft(asA, W41), draft);
 assert.ok(readMenuProposal(asA, W41));
 assert.ok(readMenuProposal(asA, W42));
 assert.deepEqual(readMenuFormDraft(asB, W40), draft, "another identity's data is not touched");

 // Review: a past week chosen with ?week= is the one on screen: never pruned.
 writeMenuFormDraft(asA, W40, draft);
 pruneStaleMenuDrafts(asA, W41, W40);
 assert.deepEqual(readMenuFormDraft(asA, W40), draft);
});

test("a proposal keeps where it came from, how it was parsed, its food context version and when it was made", () => {
 const {writeMenuProposal, readMenuProposal} = require("../src/lib/menuProposal.ts");
 const menu = {week: "Semana", days: [{dayName: "Lunes", lunch: {status: "planned", dishName: "Lentejas"}, dinner: {status: "free", dishName: ""}}]};
 writeMenuProposal(asA, W41, {menu, generationRequestId: "g1", attempt: null, source: "generate", parsedBy: null, contextVersion: "fc1:abc", createdAt: "2026-10-12T09:00:00.000Z"});
 const stored = readMenuProposal(asA, W41);
 assert.equal(stored.source, "generate");
 assert.equal(stored.contextVersion, "fc1:abc");
 assert.equal(stored.createdAt, "2026-10-12T09:00:00.000Z");
 assert.equal(readMenuProposal(asB, W41), null);

 // A proposal stored before C6 (B5 format) is still read: source from its food context.
 window.localStorage.setItem(`becook:u_${A}:menu-proposal:2026-W42`, JSON.stringify({v: 1, data: {menu: {...menu, foodContext: {servings: 2, dietaryRestrictions: [], allergies: [], otherAllergies: "", dislikedFoods: [], version: "fc1:old"}}, generationRequestId: null}, savedAt: "2026-10-12T08:00:00.000Z", remoteVersion: null, pending: false}));
 const old = readMenuProposal(asA, W42);
 assert.equal(old.source, "generate");
 assert.equal(old.contextVersion, "fc1:old");
 assert.equal(old.parsedBy, null);
 assert.equal(old.createdAt, "2026-10-12T08:00:00.000Z");
});

test("«Usar este menú» is refused while a generation runs for that identity and week, and asks when the profile changed since generating", () => {
 const {startGenerationRun} = require("../src/lib/createMenuDraft.ts");
 const {checkProposalUse} = require("../src/lib/menuProposal.ts");
 const generated = {source: "generate", contextVersion: "fc1:abc"};
 const {finish} = startGenerationRun({scope: asA.scope, week: "2026-W41", mode: "generate", startedAt: Date.now()}, draft);
 assert.deepEqual(checkProposalUse({scope: asA.scope, week: "2026-W41", proposal: generated, currentContextVersion: "fc1:abc"}), {status: "generation_running"});
 // Another identity or another week is not blocked by it.
 assert.equal(checkProposalUse({scope: asB.scope, week: "2026-W41", proposal: generated, currentContextVersion: "fc1:abc"}).status, "ok");
 assert.equal(checkProposalUse({scope: asA.scope, week: "2026-W42", proposal: generated, currentContextVersion: "fc1:abc"}).status, "ok");
 finish({status: "cancelled"});

 const base = {scope: asA.scope, week: "2026-W41", proposal: generated};
 assert.equal(checkProposalUse({...base, currentContextVersion: "fc1:abc"}).status, "ok");
 assert.equal(checkProposalUse({...base, currentContextVersion: "fc1:new"}).status, "context_changed");
 assert.equal(checkProposalUse({...base, currentContextVersion: "fc1:new", contextChangeConfirmed: true}).status, "ok");
 // Unknown current context (guest, account unreachable) or an imported menu: nothing to compare.
 assert.equal(checkProposalUse({...base, currentContextVersion: null}).status, "ok");
 assert.equal(checkProposalUse({...base, proposal: {source: "import", contextVersion: null}, currentContextVersion: "fc1:new"}).status, "ok");
});

// --- Warnings on imported dishes (C3 + C5): shown, never applied -------------------------------
test("an imported dish is checked against the profile and the culinary rules, and only warned about", () => {
 const {importedDishWarnings} = require("../src/lib/importWarnings.ts");
 const vegetarian = {dietaryRestrictions: ["vegetarian"], allergies: [], otherAllergies: "", dislikedFoods: []};
 const conflict = importedDishWarnings("Lentejas con chorizo", vegetarian);
 assert.equal(conflict.length, 1);
 assert.equal(conflict[0].tone, "danger");
 assert.match(conflict[0].text, /Vegetariano/);
 assert.match(conflict[0].text, /Solo por el nombre/);

 const vague = importedDishWarnings("Pollo con salsa especial", null);
 assert.equal(vague.length, 1);
 assert.equal(vague[0].tone, "warning");
 assert.match(vague[0].text, /sin concretar/);
 assert.match(importedDishWarnings("Pollo con salsa", null)[0].text, /salsa/);

 assert.deepEqual(importedDishWarnings("Crema de calabaza", vegetarian), [], "nothing found by the name: no noise on every dish");
 assert.deepEqual(importedDishWarnings("LIBRE", vegetarian), []);
});

// --- Crear menú: generate first, import as a disclosure (step 32) --------------------------------
test("Crear menú has no tab list any more: generating is the main action and importing a disclosure that ?mode=import opens", () => {
 const page = read("src/components/pages/CreateMenuPage.tsx");
 const panel = read("src/components/features/ImportMenuPanel.tsx");
 assert.ok(!page.includes('role="tablist"') && !page.includes('role="tab"') && !page.includes('role="tabpanel"'));
 assert.match(page, /aria-expanded=\{/);
 assert.match(page, /aria-controls=/);
 assert.match(page, /¿Ya tienes un menú\? Pégalo/);
 assert.match(page, /searchParams\.get\("mode"\)/);
 assert.match(page, /Volver a Semana/);
 assert.match(panel, /<label|aria-label=/);
 // The disclosure's target always exists (hidden when closed).
 assert.match(page, /<div id=\{importPanelId\} hidden=\{mode !== "import"\}>/);
 assert.ok(!fs.existsSync(path.join(root, "src/lib/rovingTabs.ts")), "no tabs left: the roving tab helper is gone");
 for (const [file, source] of [["ImportMenuPanel", panel], ["CreateMenuPage", page]]) {
  assert.equal(source.match(/text-\[0\.(?:[0-6]\d*|7[0-4]\d*)rem\]/g), null, file);
  assert.equal(source.match(/\bmin-h-(?:9|10)\b/g), null, file);
 }
});

// --- Review: state that must not break -------------------------------------------------------------
test("review: generating or processing is refused and disabled while «Usar este menú» saves or can be undone", () => {
 const page = read("src/components/pages/CreateMenuPage.tsx");
 const handler = name => page.slice(page.indexOf(`const ${name} = async`), page.indexOf(`const ${name} = async`) + 400);
 for (const name of ["handleProcessMenu", "handleGenerateMenu"]) {
  assert.match(handler(name), /if \(isLoading \|\| proposalBusy\(\)\) \{\s*return;/, name);
 }
 assert.match(page, /isApplyingWeekRef\.current \|\| useWeekStatus === "applying" \|\| useWeekStatus === "success"/);
 assert.equal(page.match(/disabled=\{isLoading \|\| proposalLocked\}/g)?.length, 2, "both «Procesar menú» and «Crear menú semanal»");
});

test("review: a change of identity without reloading starts Crear menú again", () => {
 const page = read("src/components/pages/CreateMenuPage.tsx");
 assert.match(page, /export default function CreateMenuPage\(\) \{\s*const identity = useIdentity\(\);\s*return <CreateMenuPageContent key=\{identity\.scope\} \/>;/);
});

test("review: the profile-change question takes the focus and «Ahora no» gives it back", () => {
 const bar = read("src/components/features/ProposalActionBar.tsx");
 assert.match(bar, /confirmRef\.current\?\.focus\(\)/);
 assert.match(bar, /useButtonRef\.current\?\.focus\(\)/);
 assert.match(bar, /ref=\{confirmRef\}/);
 assert.match(bar, /ref=\{useButtonRef\}/);
});
