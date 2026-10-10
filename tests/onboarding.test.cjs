const {test} = require("node:test");
const assert = require("node:assert/strict");
const onboarding = require("../src/lib/onboarding.ts");
const {advanceOnboarding, getOnboardingAccount} = require("../src/lib/supabase/onboarding.ts");
const {pantryItemKey} = require("../src/lib/pantryStorage.ts");

// Step 25: three steps, resumable on another device, only for new accounts.
const menuConfirmed = ["household", "goals", "restrictions", "allergies"];
const account = (extra = {}) => ({progress: null, hasProfile: false, confirmedSections: [], hasWeeks: false, ...extra});
const progress = (step) => ({step, completedAt: step === "done" ? "2026-10-10T10:00:00Z" : null});

test("a brand-new account starts the onboarding at step 1; accounts from before it are left alone", () => {
  assert.deepEqual(onboarding.onboardingStatus(account()), {kind: "active", step: "about", isNew: true});
  // Existing accounts: a profile (even one never confirmed) or any saved menu.
  assert.deepEqual(onboarding.onboardingStatus(account({hasProfile: true})), {kind: "existing"});
  assert.deepEqual(onboarding.onboardingStatus(account({hasWeeks: true})), {kind: "existing"});
  assert.deepEqual(onboarding.onboardingStatus(account({hasProfile: true, hasWeeks: true})), {kind: "existing"});
});

test("an onboarding in progress resumes at the step saved in the account", () => {
  for (const step of ["about", "profile", "pantry"]) {
    assert.deepEqual(onboarding.onboardingStatus(account({progress: progress(step)})), {kind: "active", step, isNew: false});
  }
  // Its own profile does not turn it into an "existing" account.
  assert.equal(onboarding.onboardingStatus(account({progress: progress("about"), hasProfile: true})).kind, "active");
  assert.deepEqual(onboarding.onboardingStatus(account({progress: progress("done")})), {kind: "done"});
  assert.deepEqual(onboarding.onboardingStatus(account({progress: progress("done"), hasProfile: true, hasWeeks: true})), {kind: "done"});
});

test("a saved step-2 profile whose progress was lost resumes at the pantry, never before", () => {
  const saved = account({progress: progress("profile"), hasProfile: true, confirmedSections: menuConfirmed});
  assert.equal(onboarding.onboardingStatus(saved).step, "pantry");
  assert.equal(onboarding.onboardingStatus({...saved, progress: progress("about")}).step, "pantry");
  // Only some sections confirmed (e.g. in Perfil): step 2 is still needed.
  const partial = account({progress: progress("profile"), hasProfile: true, confirmedSections: ["household"]});
  assert.equal(onboarding.onboardingStatus(partial).step, "profile");
  assert.equal(onboarding.laterStep("pantry", "about"), "pantry");
  assert.equal(onboarding.nextOnboardingStep("about"), "profile");
  assert.equal(onboarding.nextOnboardingStep("pantry"), "done");
});

test("/week sends new accounts to the onboarding once; after «Ahora no» it only offers it", () => {
  const active = onboarding.onboardingStatus(account({progress: progress("profile")}));
  assert.deepEqual(onboarding.weekOnboardingAction(active, false), {kind: "redirect"});
  assert.deepEqual(onboarding.weekOnboardingAction(active, true), {kind: "offer", step: "profile"});
  assert.deepEqual(onboarding.weekOnboardingAction({kind: "existing"}, false), {kind: "none"});
  assert.deepEqual(onboarding.weekOnboardingAction({kind: "done"}, false), {kind: "none"});

  const memory = new Map();
  const store = {getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value)};
  assert.equal(onboarding.isOnboardingDismissed("u1", store), false);
  onboarding.dismissOnboarding("u1", store);
  assert.equal(onboarding.isOnboardingDismissed("u1", store), true);
  assert.equal(onboarding.isOnboardingDismissed("u2", store), false); // per user
  onboarding.markOnboardingSettled("u2", store);
  assert.equal(onboarding.isOnboardingSettled("u2", store), true);
  assert.equal(onboarding.isOnboardingSettled("u1", store), false);
  // Blocked storage never breaks the page.
  const broken = {getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }};
  assert.doesNotThrow(() => onboarding.dismissOnboarding("u1", broken));
  assert.equal(onboarding.isOnboardingDismissed("u1", broken), false);
});

test("the express pantry offers distinct staples with valid categories and nothing marked", () => {
  const items = onboarding.expressPantryItems;
  assert.ok(items.length >= 10);
  assert.equal(new Set(items.map(pantryItemKey)).size, items.length);
  const categories = new Set(["básicos", "especias", "aceites y vinagres", "salsas", "conservas", "congelados", "otros"]);
  assert.ok(items.every((item) => categories.has(item.category) && !("active" in item)));
  // The default pantry items are there under the same key, so marking one updates it in place.
  for (const name of ["Aceite de oliva", "Sal", "Pimienta", "Vinagre", "Mostaza", "Ajo en polvo"]) {
    assert.ok(items.some((item) => item.name === name), name);
  }
  assert.equal(onboarding.onboardingFinishPath, "/create-menu?from=onboarding");
});

function fakeClient(results, calls = []) {
  const builder = (table) => {
    const chain = {
      select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
      maybeSingle: () => Promise.resolve(results[table]),
      then: (resolve, reject) => Promise.resolve(results[table]).then(resolve, reject),
    };
    calls.push(table);
    return chain;
  };
  return {
    from: builder,
    rpc: (name, args) => { calls.push([name, args]); return Promise.resolve(results.rpc); },
  };
}

test("the account state is read from the account (progress, profile confirmations, menus)", async () => {
  const calls = [];
  const client = fakeClient({
    onboarding_progress: {data: {step: "pantry", completed_at: null}, error: null},
    profiles: {data: {id: "p1", confirmed_sections: ["goals", "invented"]}, error: null},
    weeks: {data: [], error: null},
  }, calls);
  assert.deepEqual(await getOnboardingAccount("u1", client),
    {progress: {step: "pantry", completedAt: null}, hasProfile: true, confirmedSections: ["goals"], hasWeeks: false});
  assert.deepEqual(calls.sort(), ["onboarding_progress", "profiles", "weeks"]);

  const empty = fakeClient({
    onboarding_progress: {data: null, error: null}, profiles: {data: null, error: null}, weeks: {data: [{id: "w"}], error: null},
  });
  assert.deepEqual(await getOnboardingAccount("u1", empty),
    {progress: null, hasProfile: false, confirmedSections: [], hasWeeks: true});

  // Unknown state is an error, never "new account" (that would restart a finished onboarding).
  const failing = fakeClient({
    onboarding_progress: {data: null, error: {message: "offline"}}, profiles: {data: null, error: null}, weeks: {data: [], error: null},
  });
  await assert.rejects(getOnboardingAccount("u1", failing), /onboarding state/);
});

test("advancing goes through advance_onboarding and returns where the account is", async () => {
  const calls = [];
  const client = fakeClient({rpc: {data: {step: "pantry", completed_at: null}, error: null}}, calls);
  assert.deepEqual(await advanceOnboarding("profile", client), {step: "pantry", completedAt: null});
  assert.deepEqual(calls, [["advance_onboarding", {p_step: "profile"}]]);
  await assert.rejects(advanceOnboarding("done", fakeClient({rpc: {data: null, error: {message: "x"}}})), /progress/);
  await assert.rejects(advanceOnboarding("done", fakeClient({rpc: {data: {step: "??"}, error: null}})), /unexpected/);
});
