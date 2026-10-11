// Step 33: tab and group semantics, keyboard model of the tabs and minimum sizes of the screens
// changed in this step. There is no DOM renderer in the test suite, so the markup is checked
// statically on the source of each screen.
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {nextTabIndex, tabIds} = require("../src/lib/rovingTabs.ts");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function sourceFiles(dir) {
  return fs.readdirSync(path.join(root, dir), {withFileTypes: true}).flatMap(entry => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative);
    return entry.name.endsWith(".tsx") ? [relative] : [];
  });
}

test("arrow keys move between tabs and wrap around; Inicio/Fin go to the ends", () => {
  assert.equal(nextTabIndex("ArrowRight", 0, 2), 1);
  assert.equal(nextTabIndex("ArrowRight", 1, 2), 0);
  assert.equal(nextTabIndex("ArrowLeft", 0, 2), 1);
  assert.equal(nextTabIndex("ArrowLeft", 2, 3), 1);
  assert.equal(nextTabIndex("Home", 2, 3), 0);
  assert.equal(nextTabIndex("End", 0, 3), 2);
});

test("other keys keep their default action (Tab leaves the tab list, Enter/Space click)", () => {
  for (const key of ["Tab", "Enter", " ", "ArrowDown", "ArrowUp", "a"]) {
    assert.equal(nextTabIndex(key, 0, 2), null, key);
  }
  assert.equal(nextTabIndex("ArrowRight", 0, 0), null);
});

test("each tab and its panel share stable, distinct ids", () => {
  assert.deepEqual(tabIds("create-menu", "import"), {
    tab: "create-menu-tab-import",
    panel: "create-menu-panel-import",
  });
  assert.notEqual(tabIds("create-menu", "import").panel, tabIds("create-menu", "generate").panel);
});

test("every role=tablist is a complete tab pattern: tabs, panels, aria-controls and roving tabindex", () => {
  const withTablist = sourceFiles("src").filter(file => read(file).includes('role="tablist"'));
  // C6 (step 32): Crear menú has no tabs any more; any tab list that appears must still be complete.
  for (const file of withTablist) {
    const source = read(file);
    for (const required of ['role="tab"', "aria-selected=", "aria-controls=", 'role="tabpanel"', "aria-labelledby=", "tabIndex=", "onKeyDown="]) {
      assert.ok(source.includes(required), `${file} has a tablist without ${required}`);
    }
    assert.ok(!/role="tab"[^>]*aria-pressed/.test(source), `${file} mixes tabs with aria-pressed`);
  }
});

test("category selectors of Compra and Despensa are toggle-button groups, not tabs", () => {
  for (const file of ["src/components/pages/ShoppingListPage.tsx", "src/components/pages/PantryPage.tsx"]) {
    const source = read(file);
    assert.ok(!source.includes('role="tablist"'), file);
    assert.match(source, /role="group"\s+aria-label="Categorías de (compra|despensa)"/);
    // The pill announces its progress in words, not just «2/5».
    assert.match(source, /aria-label=\{`\$\{category\}: \$\{\w+\} de \$\{total\} \w+`\}/);
  }
});

test("chips built on a visually hidden input show the focus on their label", () => {
  for (const file of ["src/components/features/ProfileFields.tsx", "src/components/pages/CreateMenuPage.tsx"]) {
    const source = read(file);
    assert.ok(source.includes('className="sr-only"'), file);
    assert.ok(source.includes("has-[:focus-visible]:outline-"), `${file} hides the focus of its chips`);
  }
});

test("profile and onboarding fields use 16px text so iOS Safari does not zoom in", () => {
  const compactInput = read("src/components/features/ProfileFields.tsx").match(/compactInputClass =\s*"([^"]+)"/)[1];
  assert.ok(compactInput.split(" ").includes("text-base"), compactInput);
});

test("screens changed in step 33 keep no text below 12px and no touch target below 44px", () => {
  const screens = [
    "src/app/week/page.tsx",
    "src/components/features/ProposalDayCard.tsx",
    "src/components/features/ProposalActionBar.tsx",
    "src/components/session/SyncStatus.tsx",
    "src/components/pages/CreateMenuPage.tsx",
    "src/components/pages/ShoppingListPage.tsx",
    "src/components/features/ProfileFields.tsx",
    "src/app/profile/page.tsx",
    "src/app/onboarding/page.tsx",
  ];
  for (const file of screens) {
    const source = read(file);
    const tiny = source.match(/text-\[0\.(?:[0-6]\d*|7[0-4]\d*)rem\]/g);
    assert.equal(tiny, null, `${file}: ${tiny}`);
    // Fixed-size icons (h-10 w-10 decorative circles) are not targets; controls use min-h-*.
    const small = source.match(/\bmin-h-(?:9|10)\b/g);
    assert.equal(small, null, `${file}: ${small}`);
  }
});

test("approved plan: CTA token, focus ring, 44px shared controls and safe areas", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /--accent-strong: #b8532a;/);
  assert.match(css, /--focus-ring: var\(--accent-hover\);/);
  // shadcn's ring stays pale so it does not add a second orange band to the global outline.
  assert.match(css, /--ring: color-mix\(in srgb, var\(--accent\) 48%, white\);/);
  assert.ok(!css.includes(".ui-eyebrow"));
  assert.ok(!/font-size: 0\.6\d*rem/.test(css), "no type token below 12px");

  const button = read("src/components/ui/Button.tsx");
  assert.ok(button.includes("bg-[color:var(--color-accent-strong)] text-white"));
  assert.ok(!button.includes("min-h-10"));
  assert.ok(read("src/components/ui/IconButton.tsx").includes("h-11 w-11"));
  assert.ok(read("src/components/ui/TextInput.tsx").split(/\s|"/).includes("text-base"));
  assert.ok(read("src/components/ui/TextArea.tsx").includes("md:text-base"));

  assert.match(read("src/app/layout.tsx"), /viewportFit: "cover"/);
  assert.ok(!/maximumScale|userScalable/.test(read("src/app/layout.tsx")), "zoom must stay allowed");
  assert.ok(read("src/lib/ui.ts").includes("env(safe-area-inset-left)"));
  assert.ok(read("src/components/layout/BottomNavigation.tsx").includes("env(safe-area-inset-right)"));
});
