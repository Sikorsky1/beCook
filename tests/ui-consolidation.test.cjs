// Step 34 (design-plans/2026-10-15-consolidacion-paso-34.md): consolidated colours, shells and
// headers, dead code removed, one action notice per page and the accessible names frozen for the
// E2E suite. There is no DOM renderer in the test suite: the markup is checked on the source, and
// the notice logic (a pure module) is run.
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {createActionNotices, noticeText} = require("../src/lib/actionNotices.ts");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

function sourceFiles(dir) {
  return fs.readdirSync(path.join(root, dir), {withFileTypes: true}).flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative);
    return /\.(tsx?|mjs)$/.test(entry.name) ? [relative] : [];
  });
}

const stickyScreens = [
  "src/app/week/page.tsx",
  "src/app/profile/page.tsx",
  "src/components/pages/ShoppingListPage.tsx",
  "src/components/pages/PantryPage.tsx",
];

// --- colours ----------------------------------------------------------------------------------

test("no hex colour outside globals.css, except the documented ones; warnings use the token", () => {
  // Without a token of their own (out of scope) or metadata that must be a literal.
  const allowed = {
    "src/app/layout.tsx": ["#fff6ed"],
    "src/components/ui/Button.tsx": ["#e7efd9", "#fbe4d5"],
  };
  for (const file of sourceFiles("src")) {
    const found = (read(file).match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) ?? []).map((hex) => hex.toLowerCase());
    assert.deepEqual(found.filter((hex) => !(allowed[file] ?? []).includes(hex)), [], file);
  }
  const css = read("src/app/globals.css");
  assert.match(css, /--warning-foreground: #8a4e2a;/);
  assert.match(css, /--color-warning-foreground: var\(--warning-foreground\);/);
  assert.match(css, /--background: #fff6ed;/, "themeColor matches the background");
  const uses = sourceFiles("src").reduce((total, file) => total + (read(file).match(/text-\[color:var\(--color-warning-foreground\)\]/g) ?? []).length, 0);
  assert.ok(uses >= 7, `the 7 warning texts use the token (${uses})`);
});

// --- dead code --------------------------------------------------------------------------------

test("dead files are gone and every export of ui.ts has a consumer", () => {
  for (const file of [
    "src/components/DayCard.tsx",
    "src/data/mockImportedWeek.ts",
    "src/data/mockRecipes.ts",
    "src/components/layout/SectionHeader.tsx",
    "src/components/ui/CheckboxItem.tsx",
    "src/components/shadcn/ui/badge.tsx",
    "src/components/shadcn/ui/card.tsx",
    "src/components/shadcn/ui/checkbox.tsx",
  ]) assert.ok(!exists(file), `${file} should be deleted`);

  const ui = read("src/lib/ui.ts");
  const exported = [...ui.matchAll(/export const (\w+)/g)].map((match) => match[1]);
  assert.deepEqual(exported.sort(), ["pageBleedClass", "pageContentClass", "pageShellClass", "pageShellStickyClass"]);
  const others = sourceFiles("src").filter((file) => file !== path.join("src", "lib", "ui.ts")).map(read).join("\n");
  for (const name of exported) assert.match(others, new RegExp(`\\b${name}\\b`), `${name} has no consumer`);
});

// --- shells and margins -----------------------------------------------------------------------

test("no padding concatenated to a page shell and no -mx-3 bands; bands use pageBleedClass", () => {
  for (const file of sourceFiles("src")) {
    const source = read(file);
    assert.doesNotMatch(source, /\$\{pageShell(?:Sticky)?Class\}[^`]*\b(?:sm:)?(?:px|pt|pb|pl|pr)-/, `${file} overrides the shell padding`);
    assert.doesNotMatch(source, /(?:^|[\s"`])-mx-[36]\b|sm:-mx-6\b/, `${file} has a band that does not match the shell`);
  }
  const ui = read("src/lib/ui.ts");
  for (const side of ["left", "right"]) {
    assert.ok(ui.includes(`-m${side[0]}-[max(1rem,env(safe-area-inset-${side}))]`), side);
    assert.ok(ui.includes(`p${side[0]}-[max(1rem,env(safe-area-inset-${side}))]`), side);
    assert.ok(ui.includes(`sm:-m${side[0]}-[max(1.5rem,env(safe-area-inset-${side}))]`), side);
  }
  assert.ok(read("src/app/profile/page.tsx").includes("${pageBleedClass}"), "the bottom save bar uses the band");
});

// --- header -----------------------------------------------------------------------------------

test("StickyPageHeader: only the bar and the pinned row stick (≤ 120 px); the h1 scrolls", () => {
  const header = read("src/components/layout/StickyPageHeader.tsx");
  const stickies = header.split(/className=\{`sticky /).slice(1).map((chunk) => chunk.slice(0, chunk.indexOf("`}")));
  assert.equal(stickies.length, 2, "bar and pinned row");
  const [bar, pinned] = stickies;
  assert.match(bar, /^top-0 /);
  assert.match(bar, /pt-\[env\(safe-area-inset-top\)\]/);
  assert.match(header, /<div className="flex h-14 items-center justify-between gap-3">/, "bar: 56 px");
  // The pinned row sticks right under the bar: 56 px + the top safe area.
  assert.match(pinned, /^top-\[calc\(3\.5rem\+env\(safe-area-inset-top\)\)\] /);
  assert.match(pinned, /\bpy-1\.5\b/);
  assert.match(pinned, /\bborder-b\b/);
  const barHeight = 56;
  const pinnedHeight = 6 + 44 + 6 + 1; // py-1.5, a 44 px control, border
  assert.ok(barHeight + pinnedHeight <= 120, `${barHeight + pinnedHeight} px fixed`);
  // The h1 is between the two sticky parts, never inside one.
  const h1 = header.indexOf("<h1");
  assert.ok(h1 > header.indexOf("top-0 ") && h1 < header.indexOf("top-[calc(3.5rem"));
  assert.ok(header.includes("pageBleedClass"));
  assert.ok(!/addEventListener\(\s*"scroll"|onScroll|useEffect/.test(header), "CSS only");
});

test("Semana, Perfil, Compra and Despensa use the header; tabs and titles scroll; scroll margins fit", () => {
  for (const file of stickyScreens) {
    const source = read(file);
    assert.match(source, /<StickyPageHeader\b/, file);
    assert.match(source, /className=\{(?:`\$\{)?pageShellStickyClass/, file);
    const start = source.indexOf("pinned={");
    const pinned = start === -1 ? "" : source.slice(start, source.indexOf("\n          }", start));
    assert.ok(!pinned.includes("<ShoppingTabs") && !pinned.includes("<h1"), `${file}: tabs and h1 are not pinned`);
  }
  // No other element of the app sticks to the top (it would hide under or over the header).
  for (const file of sourceFiles("src").filter((file) => !file.endsWith("StickyPageHeader.tsx"))) {
    assert.doesNotMatch(read(file), /\bsticky top-0\b/, file);
  }
  // Pinned rows: the section links in Compra and the day strip in Semana, 44 px controls.
  const shopping = read("src/components/pages/ShoppingListPage.tsx");
  assert.match(shopping.slice(shopping.indexOf("pinned={")), /^pinned=\{\s+hasList[^]*?<nav aria-label="Secciones de la lista"/);
  const week = read("src/app/week/page.tsx");
  assert.match(week.slice(week.indexOf("pinned={")), /^pinned=\{\s+selectedIsoWeek && weekDayNumbers[^]*?aria-label="Ir a un día de la semana"/);
  assert.ok(!week.includes("headerRef") && !week.includes("offsetHeight"), "Semana does not measure the header");
  assert.match(week, /scrollIntoView\(\{ block: "start", behavior: reduceMotion \? "auto" : "smooth" \}\)/);
  // Sections and days land under the fixed part (113 px) with some air: 7.5rem = 120 px.
  for (const file of ["src/components/features/ShoppingSection.tsx", "src/components/pages/ShoppingListPage.tsx", "src/app/week/page.tsx"]) {
    const source = read(file);
    assert.ok(source.includes("scroll-mt-[calc(7.5rem+env(safe-area-inset-top))]"), file);
    assert.doesNotMatch(source, /scroll-mt-64|scroll-mt-\[172px\]/, file);
  }
  // The pantry card header was sticky inside an overflow-hidden card (no effect): plain now.
  assert.ok(!read("src/components/pages/PantryPage.tsx").includes("sticky"));
});

test("ShoppingTabs: only the current routes (the old ones redirect before rendering)", () => {
  const tabs = read("src/components/layout/ShoppingTabs.tsx");
  assert.ok(!tabs.includes("legacyHref"));
  assert.match(tabs, /const isActive = pathname === tab\.href;/);
  for (const route of ["/pantry", "/shopping-list", "/import"]) {
    assert.ok(exists(path.join("src/app", route, "page.tsx")), `${route} still redirects`);
  }
});

// --- action notices ---------------------------------------------------------------------------

function noticeState() {
  const box = {notice: null};
  const notices = createActionNotices((update) => { box.notice = update(box.notice); });
  return {box, notices};
}

test("notices: a new action clears the previous notice at once; a slow answer never replaces a later one", () => {
  const {box, notices} = noticeState();
  const first = notices.begin();
  first("«Leche» está ahora en tu despensa.");
  assert.equal(noticeText(box.notice, "list"), "«Leche» está ahora en tu despensa.");
  const slow = notices.begin();
  assert.equal(box.notice, null, "cleared when the next action starts");
  const fast = notices.begin();
  fast("«Papel» quitado de la lista.");
  slow("Cantidad de «Patata»: 2 kg.");
  assert.equal(noticeText(box.notice, "list"), "«Papel» quitado de la lista.", "the late answer is dropped");
  notices.clear();
  assert.equal(box.notice, null, "an action without a notice (marking an item) clears it too");
  fast("again");
  assert.equal(box.notice, null);
});

test("notices: closing the form clears its notice and drops its pending answer, not the list's", () => {
  const {box, notices} = noticeState();
  const added = notices.begin("form");
  added("«Papel de cocina» añadido a Otros.");
  assert.equal(noticeText(box.notice, "form"), "«Papel de cocina» añadido a Otros.");
  assert.equal(noticeText(box.notice, "list"), "", "shown next to the form only");
  notices.close("form");
  assert.equal(box.notice, null, "closing the form clears it");
  const pending = notices.begin("form");
  notices.close("form");
  pending("«Leche» añadido a Lácteos.");
  assert.equal(box.notice, null, "an answer that arrives after closing is not shown");
  const list = notices.begin();
  list("«Leche» está ahora en tu despensa.");
  notices.close("form");
  assert.equal(noticeText(box.notice, "list"), "«Leche» está ahora en tu despensa.");
});

test("notices: Compra and Despensa go through the notice channel for every action", () => {
  const shopping = read("src/components/pages/ShoppingListPage.tsx");
  const pantry = read("src/components/pages/PantryPage.tsx");
  const form = read("src/components/features/ManualItemForm.tsx");
  for (const source of [shopping, pantry]) {
    assert.ok(!/setActionMessage|setBasicsMessage|actionMessage|basicsMessage/.test(source));
    assert.match(source, /useState\(\(\) => createActionNotices\(setNotice\)\)/);
  }
  // Compra: quantity, removal, «Añadir a despensa», «Se me acabó» and the add form start an action;
  // marking an item and a new identity or week clear the notice.
  assert.equal((shopping.match(/notices\.begin\(\)/g) ?? []).length, 4);
  assert.match(shopping, /const show = notices\.begin\("form"\);\s+show\(await addManualItem\(draft\)\);/);
  assert.match(shopping, /onToggle: \(item\) => \{\s+notices\.clear\(\);/);
  assert.match(shopping, /setServings\(null\);\s+notices\.clear\(\);/);
  assert.match(shopping, /message=\{noticeText\(notice, "form"\)\}\s+onClose=\{\(\) => notices\.close\("form"\)\}/);
  assert.match(shopping, /\{hasList \? noticeText\(notice, "list"\) : ""\}/);
  // Despensa: adding basics shows a notice; adding, «Tengo / Se acabó», deleting and «Deshacer» clear it.
  assert.equal((pantry.match(/notices\.begin\(\)/g) ?? []).length, 1);
  assert.equal((pantry.match(/notices\.clear\(\)/g) ?? []).length, 4);
  // The add form shows the page's notice and tells the page when it closes.
  assert.ok(!/setMessage\(|const \[message/.test(form));
  assert.match(form, /setOpen\(false\);\s+reset\(\);\s+onClose\(\);/);
  assert.match(form, /<p role="status" className="t-meta px-1 empty:hidden">\s+\{message\}/);
});

// --- frozen accessible names (contract with the E2E suite, step 35) ---------------------------

test("the accessible names frozen for E2E are still in the code", () => {
  const frozen = {
    "src/components/layout/BottomNavigation.tsx": ['aria-label="Navegación principal"'],
    "src/lib/navigation.ts": ['label: "Semana"', 'label: "Compra"', 'label: "Perfil"'],
    "src/app/week/page.tsx": [
      "formatIsoWeekTitle(selectedIsoWeek) : undefined", '"Preparando calendario"', 'aria-label="Semana anterior"',
      'aria-label="Semana siguiente"', "Volver a hoy", "Editar menú", "Crear menú", "Ya tengo un menú",
      "Repetir la semana ${previousIsoWeek.isoWeek}", 'aria-label="Ir a un día de la semana"',
      'aria-label={`${day.name} ${dayNumber}${cell.isToday ? ", hoy" : ""}${cell.hasMenu ? "" : ", sin menú"}`}',
    ],
    "src/components/pages/CreateMenuPage.tsx": ["Prepara tu menú semanal", "Volver a Semana", "¿Ya tienes un menú? Pégalo", "Crear menú semanal"],
    "src/components/features/ImportMenuPanel.tsx": ["Procesar menú"],
    "src/components/features/ProposalActionBar.tsx": ['"Usar este menú"'],
    "src/components/pages/ShoppingListPage.tsx": [
      'heading="Tu compra"', '<nav aria-label="Secciones de la lista"',
      "aria-label={`${capitalize(section.category)}: ${section.done} de ${section.total} comprados`}",
      "aria-label={`Se me acabó: ${capitalize(item.name)}. Pasarlo a la lista`}",
    ],
    "src/components/layout/ShoppingTabs.tsx": ['aria-label="Secciones de compra"', 'label: "Lista de la compra"', 'label: "Despensa"'],
    "src/components/features/ShoppingSection.tsx": [
      "aria-label={`${name}, ${amount}`}", "aria-label={`Añadir a despensa: ${name}`}", "aria-label={`Quitar ${name} de la lista`}",
    ],
    "src/components/features/QuantityEditor.tsx": ["aria-label={`Cambiar la cantidad de ${name} (${shown})`}"],
    "src/components/features/ManualItemForm.tsx": ["Añadir un artículo", '"Añadir a la lista"', "Cerrar", ">Artículo<", ">Cantidad<", ">Unidad<", ">Sección<"],
    "src/components/pages/PantryPage.tsx": [
      'heading="Tu despensa"', 'aria-label="Categorías de despensa"', "aria-label={`Borrar ${item.name}`}", "Deshacer", "Añadir",
      "aria-label={`${category}: ${active} de ${total} disponibles`}",
    ],
    "src/components/features/PantryStockToggle.tsx": ["aria-label={`¿Tienes ${name} en casa?`}"],
    "src/components/features/PantryBasicsPicker.tsx": ["Añadir básicos que sueles tener"],
    "src/app/profile/page.tsx": ['heading="Lo que necesita tu menú"', '"Guardar perfil"'],
    "src/app/onboarding/page.tsx": ["Bienvenido a beCook", "Para quién cocinas y qué necesitas", "¿Qué tienes ya en casa?"],
    "src/app/login/page.tsx": [">Email<", ">Contraseña<", '"Entrar"'],
    "src/app/signup/page.tsx": ['"Crear cuenta"'],
  };
  for (const [file, names] of Object.entries(frozen)) {
    const source = read(file).replace(/\s+/g, " ");
    for (const name of names) assert.ok(source.includes(name.replace(/\s+/g, " ")), `${file}: «${name}»`);
  }
  // The week title's accessible name is the full title, on the h1 itself.
  assert.match(read("src/components/layout/StickyPageHeader.tsx"), /<h1\s+aria-label=\{headingLabel\}/);
});
