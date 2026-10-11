// Step 32: three-destination bottom navigation, /import redirect and the empty week
// (design-plans/2026-10-12-navegacion-paso-32.md). No DOM renderer in the suite: the pure helpers
// run for real and the markup is checked statically on the source.
const {test, beforeEach, afterEach} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const {createDevice, useDevice} = require("./helpers/fake-browser.cjs");
const nav = require("../src/lib/navigation.ts");
const repos = require("../src/lib/data/repositories.ts");
const {RemoteConflictError} = require("../src/lib/data/sync.ts");
const {resolveApplyWeekAttempt} = require("../src/lib/applyWeek.ts");
const {hasPlannedMeals, repeatPreviousWeek, repeatWeekDays, repeatWeekMessages} = require("../src/lib/repeatWeek.ts");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

// --- Active section --------------------------------------------------------------------------

test("three destinations, in order: Semana, Compra, Perfil (Crear menú is not one)", () => {
  assert.deepEqual(nav.appSections.map(section => [section.id, section.href, section.label]), [
    ["week", "/week", "Semana"],
    ["shopping", "/shopping/list", "Compra"],
    ["profile", "/profile", "Perfil"],
  ]);
  assert.ok(!nav.appSections.some(section => section.href.startsWith("/create-menu")));
});

test("each route marks its section; Crear menú and /import mark Semana", () => {
  const cases = {
    "/": "week",
    "/week": "week",
    "/week?week=2026-W42": "week",
    "/create-menu": "week",
    "/create-menu?mode=import&week=2026-W42": "week",
    "/import": "week",
    "/shopping/list": "shopping",
    "/shopping/pantry": "shopping",
    "/shopping-list": "shopping",
    "/pantry": "shopping",
    "/profile": "profile",
    "/login": "profile",
    "/signup": "profile",
    "/forgot-password": "profile",
    "/reset-password": "profile",
    "/auth/callback": "profile",
  };
  for (const [pathname, section] of Object.entries(cases)) {
    assert.equal(nav.activeSection(pathname), section, pathname);
  }
});

test("matching is by whole segment and ignores a trailing slash, case and escapes", () => {
  assert.equal(nav.activeSection("/week/"), "week");
  assert.equal(nav.activeSection("/Week"), "week");
  assert.equal(nav.activeSection("/create-menu/"), "week");
  assert.equal(nav.activeSection("/%70antry"), "shopping");
  assert.equal(nav.activeSection("/weekly"), null);
  assert.equal(nav.activeSection("/profiles"), null);
  assert.equal(nav.activeSection("/onboarding"), null, "routes outside the three mark none, as before");
  assert.equal(nav.activeSection(null), null);
  assert.equal(nav.activeSection("/%E0%A4%A"), null, "a malformed escape does not throw");
});

test("aria-current: «page» on the destination itself, «true» under it, nothing elsewhere", () => {
  const [week, shopping, profile] = nav.appSections;
  assert.equal(nav.sectionAriaCurrent(week, "/week"), "page");
  assert.equal(nav.sectionAriaCurrent(week, "/week/"), "page");
  assert.equal(nav.sectionAriaCurrent(week, "/create-menu"), "true");
  assert.equal(nav.sectionAriaCurrent(week, "/import"), "true");
  assert.equal(nav.sectionAriaCurrent(week, "/"), "true");
  assert.equal(nav.sectionAriaCurrent(shopping, "/shopping/list"), "page");
  assert.equal(nav.sectionAriaCurrent(shopping, "/shopping/pantry"), "true");
  assert.equal(nav.sectionAriaCurrent(profile, "/profile"), "page");
  assert.equal(nav.sectionAriaCurrent(profile, "/login"), "true");
  assert.equal(nav.sectionAriaCurrent(week, "/shopping/list"), undefined);
  assert.equal(nav.sectionAriaCurrent(profile, "/onboarding"), undefined);
  // Only one section is ever current.
  for (const pathname of ["/week", "/create-menu", "/pantry", "/login", "/onboarding"]) {
    assert.ok(nav.appSections.filter(section => nav.sectionAriaCurrent(section, pathname)).length <= 1, pathname);
  }
});

// --- /import -------------------------------------------------------------------------------

test("createMenuImportHref keeps only a well-formed week", () => {
  assert.equal(nav.createMenuImportHref(), "/create-menu?mode=import");
  assert.equal(nav.createMenuImportHref(null), "/create-menu?mode=import");
  assert.equal(nav.createMenuImportHref("2026-W42"), "/create-menu?mode=import&week=2026-W42");
  assert.equal(nav.createMenuImportHref(["2026-W43", "2026-W44"]), "/create-menu?mode=import&week=2026-W43");
  for (const bad of ["42", "2026-42", "2026-W4", "2026-W42&x=1", "//evil.example"]) {
    assert.equal(nav.createMenuImportHref(bad), "/create-menu?mode=import", bad);
  }
});

function loadTsx(file) {
  const source = ts.transpileModule(read(file), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true},
  }).outputText;
  const mod = {exports: {}};
  new Function("require", "module", "exports", source)(require, mod, mod.exports);
  return mod.exports;
}

async function redirectTarget(searchParams) {
  const {default: ImportRedirectPage} = loadTsx("src/app/import/page.tsx");
  try {
    await ImportRedirectPage({searchParams: Promise.resolve(searchParams)});
  } catch (error) {
    // NEXT_REDIRECT;replace;<url>;307;
    assert.match(error.digest, /^NEXT_REDIRECT;/);
    return error.digest.split(";")[2];
  }
  assert.fail("the page did not redirect");
}

test("/import redirects to Crear menú in import mode, keeping a valid week", async () => {
  assert.equal(await redirectTarget({}), "/create-menu?mode=import");
  assert.equal(await redirectTarget({week: "2026-W42"}), "/create-menu?mode=import&week=2026-W42");
  assert.equal(await redirectTarget({week: "mañana"}), "/create-menu?mode=import");
});

test("no route disappears: the old addresses still redirect", () => {
  assert.match(read("src/app/pantry/page.tsx"), /redirect\("\/shopping\/pantry"\)/);
  assert.match(read("src/app/shopping-list/page.tsx"), /redirect\("\/shopping\/list"\)/);
  assert.match(read("src/app/page.tsx"), /redirect\("\/week"\)/);
  assert.ok(fs.existsSync(path.join(root, "src/app/create-menu/page.tsx")));
});

// --- Bottom navigation markup ----------------------------------------------------------------

test("the bar has 3 columns, 13px labels and the same height and safe areas", () => {
  const source = read("src/components/layout/BottomNavigation.tsx");
  assert.ok(source.includes("grid-cols-3") && !source.includes("grid-cols-4"));
  assert.ok(source.includes("max-w-[22.5rem]"));
  assert.ok(source.includes("text-[0.8125rem]") && !/\btext-xs\b/.test(source));
  assert.ok(source.includes("min-h-[4.25rem]"), "cell height unchanged");
  assert.ok(source.includes("pb-[calc(0.85rem+env(safe-area-inset-bottom))]"), "bar padding unchanged");
  assert.ok(source.includes("env(safe-area-inset-left)") && source.includes("env(safe-area-inset-right)"));
  assert.ok(source.includes('aria-label="Navegación principal"'));
  assert.ok(source.includes('aria-hidden="true"'));
  assert.ok(source.includes("appSections.map") && source.includes("sectionAriaCurrent(section, pathname)"));
  assert.ok(!source.includes('"/create-menu"') && !source.includes("ChefHat"), "Crear menú is not in the bar");
});

test("the page shell keeps its bottom padding above the bar", () => {
  assert.ok(read("src/lib/ui.ts").includes("pb-[calc(7.5rem+env(safe-area-inset-bottom))]"));
});

// --- Empty week ------------------------------------------------------------------------------

test("empty week: «Crear menú» first (accent-strong), «Repetir la semana N» and «Ya tengo un menú», 44px", () => {
  const source = read("src/app/week/page.tsx");
  const empty = source.slice(source.indexOf("function EmptyWeekState"), source.indexOf("export default function WeekPage")).replace(/\s+/g, " ");
  const create = empty.indexOf("Crear menú");
  const repeat = empty.indexOf("Repetir la semana ${previousIsoWeek.isoWeek}");
  const imported = empty.indexOf("Ya tengo un menú");
  assert.ok(create > 0 && repeat > create && imported > repeat, "order: create, repeat, import");
  assert.match(empty, /href=\{buildWeekHref\("\/create-menu", isoWeek\)\}\s+className="[^"]*bg-\[color:var\(--color-accent-strong\)\][^"]*text-white/);
  assert.ok(empty.includes("createMenuImportHref(getIsoWeekStorageId(isoWeek))"));
  assert.ok(empty.includes("La lista de la compra se prepara") && empty.includes("perfil actual"));
  assert.ok(empty.includes('aria-describedby="repeat-week-help"') && empty.includes("aria-busy={isRepeating}"));
  assert.equal((empty.match(/min-h-11/g) ?? []).length, 2, "primary link and the shared secondary class");
  assert.ok(!/\bmin-h-(?:9|10)\b/.test(empty) && !/text-\[0\.[0-6]\d*rem\]/.test(empty));
  // Shown to guests too: nothing in the empty state depends on being signed in.
  assert.ok(!empty.includes("isSignedIn") && !empty.includes("userId"));
  assert.ok(source.includes('role="status"') && source.includes("visibleRepeatNotice.message"));
});

// --- «Repetir la semana N» ----------------------------------------------------------------------

const A = "00000000-0000-4000-8000-00000000000a";
const asA = {scope: "u_" + A, userId: A};
const guest = {scope: "guest", userId: null};
const W41 = {isoYear: 2026, isoWeek: 41};
const W42 = {isoYear: 2026, isoWeek: 42};
const previous = [
  {day: "Miércoles", date: "7 oct", lunch: "Merluza", dinner: "LIBRE"},
  {day: "Lunes", date: "5 oct", lunch: "Lentejas", dinner: "Tortilla", lunchRecipe: {versionId: "v-lentejas"}, extra: "x"},
];

function createAccount() {
  const st = {weeks: new Map(), pushes: [], down: false};
  const key = (userId, isoWeek) => `${userId}:${isoWeek.isoYear}-W${isoWeek.isoWeek}`;
  const week = (userId, isoWeek, options = {}) => ({
    checksVersion: true,
    sameData: repos.sameWeekDays,
    async fetch() {
      if (st.down) throw new TypeError("fetch failed");
      const row = st.weeks.get(key(userId, isoWeek));
      return {data: row ? structuredClone(row.days) : null, version: row ? String(row.version) : null};
    },
    async push(data, {baseVersion, overwrite}) {
      st.pushes.push({week: isoWeek.isoWeek, generationRequestId: options.generationRequestId ?? null, requestKey: options.requestKey, overwrite});
      const row = st.weeks.get(key(userId, isoWeek));
      const current = row ? String(row.version) : null;
      if (!overwrite && current !== baseVersion) throw new RemoteConflictError();
      st.weeks.set(key(userId, isoWeek), {days: structuredClone(data), version: (row?.version ?? 0) + 1});
      return {version: String((row?.version ?? 0) + 1)};
    },
  });
  // Shopping must not be touched: Compra prepares the list when it is opened.
  const unused = () => { throw new Error("not used"); };
  return {
    st,
    remotes: {week, profile: unused, pantry: unused, shopping: unused, planningRequest: async () => null},
    seed: (userId, isoWeek, days) => st.weeks.set(key(userId, isoWeek), {days, version: 1}),
    row: (userId, isoWeek) => st.weeks.get(key(userId, isoWeek)),
  };
}

let account, restoreDevice, keyCount = 0;
beforeEach(() => {
  account = createAccount();
  repos.configureRemotes(account.remotes);
  restoreDevice = useDevice(createDevice());
});
afterEach(() => {
  repos.configureRemotes(null);
  restoreDevice();
});

const repeat = (identity, days = previous, attempt) =>
  repeatPreviousWeek({
    identity, isoWeek: W42, previousWeek: W41, previousDays: days,
    attempt: attempt ?? resolveApplyWeekAttempt(null, days, "2026-W42", () => "key-" + (++keyCount)),
  });

test("only a week with at least one planned meal can be repeated", () => {
  assert.equal(hasPlannedMeals(previous), true);
  assert.equal(hasPlannedMeals([{day: "Lunes", date: "", lunch: "LIBRE", dinner: "LIBRE"}]), false);
  assert.equal(hasPlannedMeals([]), false);
  assert.equal(hasPlannedMeals(null), false);
});

test("the copy keeps dishes and cards, dated in the new week, without other fields", () => {
  const copy = repeatWeekDays(previous, W42);
  assert.deepEqual(copy.map(day => day.day), ["Lunes", "Miércoles"]);
  assert.deepEqual(copy[0], {day: "Lunes", date: "12 oct", lunch: "Lentejas", dinner: "Tortilla", lunchRecipe: {versionId: "v-lentejas"}});
  assert.deepEqual(copy[1], {day: "Miércoles", date: "14 oct", lunch: "Merluza", dinner: "LIBRE"});
  assert.notEqual(copy[0].lunchRecipe, previous[1].lunchRecipe, "the source week is not shared");
});

test("signed in: saved in the account with the current profile (no generation) and no shopping list", async () => {
  const result = await repeat(asA);
  assert.equal(result.status, "copied");
  assert.equal(result.message, repeatWeekMessages.account("41"));
  assert.ok(result.reload);
  assert.equal(account.st.pushes.length, 1);
  assert.equal(account.st.pushes[0].generationRequestId, null, "food context frozen from the current profile");
  assert.equal(account.st.pushes[0].overwrite, false);
  const saved = account.row(A, W42).days;
  assert.deepEqual(saved.map(day => [day.day, day.lunch, day.dinner, day.lunchRecipe?.versionId ?? null]), [
    ["Lunes", "Lentejas", "Tortilla", "v-lentejas"],
    ["Miércoles", "Merluza", "LIBRE", null],
  ]);
});

test("guest: the copy is saved on this device", async () => {
  const result = await repeat(guest);
  assert.equal(result.status, "copied");
  assert.equal(result.message, repeatWeekMessages.device("41"));
  assert.equal(account.st.pushes.length, 0);
  assert.deepEqual(repos.readCachedWeek(guest, W42).map(day => day.lunch), ["Lentejas", "Merluza"]);
});

test("a week that already has a menu is never replaced", async () => {
  account.seed(A, W42, [{day: "Martes", date: "", lunch: "Paella", dinner: "LIBRE"}]);
  const result = await repeat(asA);
  assert.equal(result.status, "existing");
  assert.ok(result.reload);
  assert.equal(account.st.pushes.length, 0);
  assert.equal(account.row(A, W42).days[0].lunch, "Paella");

  await repeat(guest);
  const again = await repeat(guest, [{day: "Jueves", date: "", lunch: "Sopa", dinner: "LIBRE"}]);
  assert.equal(again.status, "existing");
  assert.equal(repos.readCachedWeek(guest, W42)[0].lunch, "Lentejas");
});

test("unreachable account: nothing saved, the same attempt is kept for «Repetir» again", async () => {
  account.st.down = true;
  const attempt = resolveApplyWeekAttempt(null, previous, "2026-W42", () => "fixed-key");
  const failed = await repeat(asA, previous, attempt);
  assert.equal(failed.status, "error");
  assert.equal(failed.attempt, "keep");
  assert.equal(failed.reload, false);
  assert.equal(account.row(A, W42), undefined);

  account.st.down = false;
  const retried = await repeat(asA, previous, resolveApplyWeekAttempt(attempt, previous, "2026-W42", () => "other-key"));
  assert.equal(retried.status, "copied");
  assert.equal(account.st.pushes.at(-1).requestKey, "fixed-key", "a retry reuses the request key");
});
