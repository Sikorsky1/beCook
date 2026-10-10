// D2 (steps 24 and 25) against the real local Supabase: optional body data, confirmed sections,
// the deployed client of main with the migration applied, and the onboarding progress (resume on
// another device, never backwards, RLS). Fixture rows are restored and new users deleted.
const assert = require("node:assert/strict");

const options = { auth: { persistSession: false, autoRefreshToken: false } };

async function runOnboardingTests({ check, sql, id, api, createClient, supabase }) {
  const profiles = require("../src/lib/supabase/profiles.ts");
  const legacy = require("../tests/fixtures/legacy-profile-client-355780c.ts");
  const form = require("../src/lib/profileForm.ts");
  const onboarding = require("../src/lib/onboarding.ts");
  const remote = require("../src/lib/supabase/onboarding.ts");
  const userA = id("0", 1);
  const profileA = id("1", 1);
  const snapshot = sql("SELECT row_to_json(p) FROM public.profiles p WHERE id='" + profileA + "';").trim();
  const admin = createClient(api.url, api.serviceKey, options);
  const signIn = async (client, email, password = "Local-fixture-only-2026!") =>
    client.auth.signInWithPassword({ email, password });
  const otherDevice = createClient(api.url, api.key, options);
  const userB = createClient(api.url, api.key, options);
  const anon = createClient(api.url, api.key, options);
  const newUsers = [];
  const base = {
    householdSize: 2, weeklyTrainingDays: 0, trainingTypes: [], goals: ["healthy_eating"], goal: "healthy_eating",
    dietaryRestrictions: ["none"], allergies: [], dislikedFoods: [],
  };
  const rowOf = () => JSON.parse(sql("SELECT row_to_json(p) FROM public.profiles p WHERE id='" + profileA + "';").trim());

  try {
    await supabase.auth.signOut({ scope: "local" });
    await signIn(supabase, "fixture-1@example.invalid");
    await signIn(otherDevice, "fixture-1@example.invalid");
    await signIn(userB, "fixture-2@example.invalid");

    // --- Step 24: body data optional, «Ninguna» kept, confirmations ---------------------------
    const built = form.buildNewProfile({ ...form.emptyProfileDraft(), householdSize: 2, goals: ["healthy_eating"],
      dietaryRestrictions: ["none"], noAllergies: true });
    let saveError = null;
    try { await profiles.saveProfileToSupabase(built.profile, { userId: userA }); } catch (error) { saveError = error; }
    const stored = rowOf();
    const elsewhere = await otherDevice.from("profiles").select(profiles.PROFILE_COLUMNS).eq("user_id", userA).maybeSingle();
    const read = elsewhere.data ? profiles.profileFromRow(elsewhere.data) : null;
    check("D2 profile: saves without body data (NULL) and reads back on another device", () => {
      assert.equal(built.ok, true);
      assert.equal(saveError, null);
      assert.deepEqual([stored.sex, stored.birth_date, stored.height_cm, stored.weight_kg], [null, null, null, null]);
      assert.deepEqual([read.sex, read.birthDate, read.heightCm, read.weightKg], [null, null, null, null]);
    });
    check("D2 profile: «Ninguna» restrictions and allergies stay explicit answers after reloading", () => {
      assert.deepEqual(stored.confirmed_sections, ["household", "goals", "restrictions", "allergies"]);
      assert.deepEqual(stored.allergies, []);
      const draft = form.draftFromProfile(read);
      assert.equal(draft.noAllergies, true);
      assert.deepEqual(draft.dietaryRestrictions, ["none"]);
      assert.equal(form.sectionStatus(draft, read, "restrictions"), "saved");
      assert.deepEqual(form.assumedMenuSections(read), []);
    });

    // A profile of the previous form: values without confirmations → assumed until confirmed.
    sql("UPDATE public.profiles SET sex='male', birth_date='1990-01-01', height_cm=175, weight_kg=75, confirmed_sections='{}' WHERE id='" + profileA + "';");
    const legacyRead = (await profiles.getProfileForUserFromSupabase(userA)).profile;
    const confirmed = form.applySection(legacyRead, form.draftFromProfile(legacyRead), "goals");
    await profiles.saveProfileToSupabase(confirmed.profile, { userId: userA });
    check("D2 profile: an existing profile is «assumed» until a section is confirmed; confirming only adds it", () => {
      assert.deepEqual(form.assumedMenuSections(legacyRead), ["household", "goals", "restrictions"]);
      const after = rowOf();
      assert.deepEqual(after.confirmed_sections, ["goals"]);
      assert.equal(after.height_cm, 175);
    });

    // Deployment: the client of main keeps working with the migration applied.
    let legacyError = null;
    try {
      await legacy.saveProfileToSupabase({ ...base, sex: "female", birthDate: "1991-02-03", heightCm: 160, weightKg: 55,
        householdSize: 4 }, { userId: userA });
    } catch (error) { legacyError = error; }
    const afterLegacy = rowOf();
    const legacyReads = await legacy.getProfileForUserFromSupabase(userA).catch(() => null);
    check("D2 rollout: main's client saves and reads a full profile; its upsert keeps confirmed_sections", () => {
      assert.equal(legacyError, null);
      assert.equal(afterLegacy.household_size, 4);
      assert.deepEqual(afterLegacy.confirmed_sections, ["goals"]);
      assert.equal(legacyReads?.profile.heightCm, 160);
    });
    sql("UPDATE public.profiles SET height_cm=NULL WHERE id='" + profileA + "';");
    const legacyOnNull = await legacy.getProfileForUserFromSupabase(userA).then(() => "read", () => "throws");
    check("D2 rollout (known limit): main's client cannot read a profile without body data → deploy code right after", () =>
      assert.equal(legacyOnNull, "throws"));

    const badConfirmation = await supabase.from("profiles").update({ confirmed_sections: ["invented"] }).eq("user_id", userA);
    check("D2 profile: confirmed_sections only admits known sections (CHECK)", () =>
      assert.equal(badConfirmation.error?.code, "23514"));

    // --- Step 25: onboarding progress -------------------------------------------------------
    const existing = onboarding.onboardingStatus(await remote.getOnboardingAccount(userA, supabase));
    check("D2 onboarding: a fixture account with profile and menus is an existing account", () =>
      assert.deepEqual(existing, { kind: "existing" }));

    const email = `d2-onboarding-${Date.now()}@example.invalid`;
    const password = "Local-onboarding-only-2026!";
    const laptop = createClient(api.url, api.key, options);
    const signup = await laptop.auth.signUp({ email, password });
    const newUserId = signup.data.user?.id;
    if (newUserId) newUsers.push(newUserId);
    const phone = createClient(api.url, api.key, options);
    await signIn(phone, email, password);

    const fresh = onboarding.onboardingStatus(await remote.getOnboardingAccount(newUserId, laptop));
    const started = await remote.advanceOnboarding("about", laptop);
    const toProfile = await remote.advanceOnboarding("profile", laptop);
    const resumedOnPhone = onboarding.onboardingStatus(await remote.getOnboardingAccount(newUserId, phone));
    check("D2 onboarding: a new account starts, saves each step and resumes on another device", () => {
      assert.ok(newUserId);
      assert.deepEqual(fresh, { kind: "active", step: "about", isNew: true });
      assert.deepEqual(started, { step: "about", completedAt: null });
      assert.deepEqual(toProfile, { step: "profile", completedAt: null });
      assert.deepEqual(resumedOnPhone, { kind: "active", step: "profile", isNew: false });
    });

    const pantry = await remote.advanceOnboarding("pantry", phone);
    const stale = await remote.advanceOnboarding("profile", laptop);
    const staleStart = await remote.advanceOnboarding("about", laptop);
    check("D2 onboarding: a device left on an earlier step never moves the account back", () => {
      assert.equal(pantry.step, "pantry");
      assert.equal(stale.step, "pantry");
      assert.equal(staleStart.step, "pantry");
    });

    const raced = await Promise.all([remote.advanceOnboarding("done", phone), remote.advanceOnboarding("pantry", laptop)]);
    const finalRow = JSON.parse(sql("SELECT row_to_json(o) FROM public.onboarding_progress o WHERE user_id='" + newUserId + "';").trim());
    const finished = onboarding.onboardingStatus(await remote.getOnboardingAccount(newUserId, laptop));
    check("D2 onboarding: finishing on one device while another sends an older step ends done", () => {
      assert.equal(raced[0].step, "done");
      assert.equal(finalRow.step, "done");
      assert.ok(finalRow.completed_at);
      assert.deepEqual(finished, { kind: "done" });
    });

    const bRead = await userB.from("onboarding_progress").select("user_id").eq("user_id", newUserId);
    const bWrite = await userB.from("onboarding_progress").insert({ user_id: newUserId, step: "about" });
    const bUpdate = await userB.from("onboarding_progress").update({ step: "about" }).eq("user_id", newUserId).select("user_id");
    const anonCall = await anon.rpc("advance_onboarding", { p_step: "about" });
    const anonRead = await anon.from("onboarding_progress").select("user_id");
    const invalid = await laptop.rpc("advance_onboarding", { p_step: "skip" });
    const doneWithoutDate = await laptop.from("onboarding_progress").update({ completed_at: null }).eq("user_id", newUserId);
    check("D2 onboarding: another user cannot read or change the progress; anon cannot use it", () => {
      assert.deepEqual(bRead.data, []);
      assert.equal(bWrite.error?.code, "42501");
      assert.deepEqual(bUpdate.data, []);
      assert.equal(anonCall.error?.code, "42501");
      assert.equal(anonRead.error?.code, "42501");
    });
    check("D2 onboarding: invalid steps and a done step without date are rejected", () => {
      assert.equal(invalid.error?.code, "22023");
      assert.equal(doneWithoutDate.error?.code, "23514");
    });
    await laptop.auth.signOut({ scope: "local" });
    await phone.auth.signOut({ scope: "local" });
  } finally {
    // Replica role skips set_profiles_updated_at so the original version is restored too.
    sql("BEGIN; SET LOCAL session_replication_role = replica; UPDATE public.profiles p SET " +
      "sex=r.sex,birth_date=r.birth_date,height_cm=r.height_cm,weight_kg=r.weight_kg,household_size=r.household_size," +
      "weekly_training_days=r.weekly_training_days,training_types=r.training_types,other_training_type=r.other_training_type," +
      "goal=r.goal,goals=r.goals,other_goal=r.other_goal,dietary_restrictions=r.dietary_restrictions,allergies=r.allergies," +
      "other_allergies=r.other_allergies,disliked_foods=r.disliked_foods,confirmed_sections=r.confirmed_sections,updated_at=r.updated_at" +
      " FROM json_populate_record(NULL::public.profiles, $snap$" + snapshot + "$snap$) r WHERE p.id=r.id; COMMIT;");
    for (const userId of newUsers) await admin.auth.admin.deleteUser(userId);
    await Promise.all([otherDevice, userB].map((client) => client.auth.signOut({ scope: "local" })));
    await supabase.auth.signOut({ scope: "local" });
  }
  check("D2: fixture profile restored and test accounts removed (with their progress)", () => {
    assert.equal(sql("SELECT row_to_json(p) FROM public.profiles p WHERE id='" + profileA + "';").trim(), snapshot);
    assert.equal(sql("SELECT count(*) FROM public.onboarding_progress;").trim(), "0");
  });
}

module.exports = { runOnboardingTests };
