// B2: profile ↔ database contract against the real local Supabase (Auth + RLS + CHECKs).
// Saves through the application adapter, reloads on a second device (independent client, no cache)
// and restores the fixture row afterwards so the run is repeatable.
const assert = require("node:assert/strict");

const restorableColumns = [
  "sex", "birth_date", "height_cm", "weight_kg", "household_size", "weekly_training_days",
  "training_types", "other_training_type", "goal", "goals", "other_goal", "dietary_restrictions",
  "allergies", "other_allergies", "disliked_foods", "updated_at",
];

async function runProfileContractTests({ check, sql, id, api, createClient, supabase }) {
  const profiles = require("../src/lib/supabase/profiles.ts");
  const userId = id("0", 1);
  const profileId = id("1", 1);
  const snapshot = sql("SELECT row_to_json(p) FROM public.profiles p WHERE id='" + profileId + "';").trim();
  const otherDevice = createClient(api.url, api.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const base = {
    sex: "female", birthDate: "1990-01-01", heightCm: 165, weightKg: 65, householdSize: 1,
    weeklyTrainingDays: 2, trainingTypes: ["yoga_pilates"], goals: ["healthy_eating"], goal: "healthy_eating",
    dietaryRestrictions: ["vegetarian"], allergies: ["nuts"], dislikedFoods: [],
  };
  // Save on this device, then read on a device that never saw the save.
  async function saveThenReadElsewhere(profile) {
    let saveError = null;
    try { await profiles.saveProfileToSupabase(profile, { userId }); } catch (error) { saveError = error; }
    const remote = await otherDevice.from("profiles").select(profiles.PROFILE_COLUMNS ?? "*").eq("user_id", userId).maybeSingle();
    const read = remote.data && profiles.profileFromRow ? profiles.profileFromRow(remote.data) : null;
    const viaApp = await profiles.getProfileForUserFromSupabase(userId).catch(() => null);
    return { saveError, row: remote.data, read, viaApp: viaApp?.profile ?? null };
  }

  try {
    await supabase.auth.signOut({ scope: "local" });
    await supabase.auth.signInWithPassword({ email: "fixture-1@example.invalid", password: "Local-fixture-only-2026!" });
    const login = await otherDevice.auth.signInWithPassword({ email: "fixture-1@example.invalid", password: "Local-fixture-only-2026!" });
    check("B2 contract: second device signs in", () => assert.equal(login.error, null));

    for (const days of [6, 7]) {
      const result = await saveThenReadElsewhere({ ...base, weeklyTrainingDays: days });
      check("B2 contract: " + days + " training days save, reload and read on another device", () => {
        assert.equal(result.saveError, null);
        assert.equal(result.row?.weekly_training_days, days);
        assert.equal(result.read?.weeklyTrainingDays, days);
        assert.equal(result.viaApp?.weeklyTrainingDays, days);
      });
    }

    // N02 and N06 (20261017090000_profiles_allergens_habit_goals): the 14 EU allergens, lactose
    // intolerance apart and habit goals pass the widened CHECKs.
    const eu14 = ["gluten", "crustaceans", "egg", "fish", "peanuts", "soy", "milk", "lactose", "nuts", "celery", "mustard", "sesame", "sulphites", "lupin", "molluscs"];
    const habits = await saveThenReadElsewhere({ ...base, allergies: eu14, goals: ["more_plants", "with_kids", "save_money"], goal: "healthy_eating" });
    check("N02/N06: the 14 allergens and the habit goals save and read back on another device", () => {
      assert.equal(habits.saveError, null);
      assert.deepEqual(habits.row?.allergies, eu14);
      assert.deepEqual(habits.read?.goals, ["more_plants", "with_kids", "save_money"]);
      assert.equal(habits.row?.goal, "healthy_eating");
    });
    check("N02/N06: the CHECKs still refuse an unknown allergy or goal", () => {
      for (const update of ["allergies = ARRAY['dust']", "goals = ARRAY['fat_burn']"]) {
        assert.throws(() => sql("BEGIN; UPDATE public.profiles SET " + update + " WHERE id='" + profileId + "'; ROLLBACK;"));
      }
    });

    const otherFirst = await saveThenReadElsewhere({
      ...base, goals: ["other", "muscle_gain"], goal: "other", otherGoal: "  Preparar un triatlón  ",
    });
    check("B2 contract: «Otro» as first goal saves with a valid legacy goal and reads back", () => {
      assert.equal(otherFirst.saveError, null);
      assert.deepEqual(otherFirst.row?.goals, ["other", "muscle_gain"]);
      assert.equal(otherFirst.row?.goal, "muscle_gain");
      assert.deepEqual(otherFirst.read?.goals, ["other", "muscle_gain"]);
      assert.equal(otherFirst.read?.otherGoal, "Preparar un triatlón");
      assert.deepEqual(otherFirst.viaApp?.goals, ["other", "muscle_gain"]);
    });

    const onlyOther = await saveThenReadElsewhere({ ...base, goals: ["other"], goal: "other", otherGoal: "Comer mejor en viajes" });
    check("B2 contract: only «Otro» stores healthy_eating as legacy goal, goals keep «Otro»", () => {
      assert.equal(onlyOther.saveError, null);
      assert.equal(onlyOther.row?.goal, "healthy_eating");
      assert.deepEqual(onlyOther.read?.goals, ["other"]);
      assert.equal(onlyOther.read?.otherGoal, "Comer mejor en viajes");
    });

    const foods = ["pollo", "brócoli", "queso azul"];
    const disliked = await saveThenReadElsewhere({ ...base, dislikedFoods: foods });
    check("B2 contract: disliked foods save as text, reload and read as the same list on another device", () => {
      assert.equal(disliked.saveError, null);
      assert.equal(disliked.row?.disliked_foods, "pollo, brócoli, queso azul");
      assert.deepEqual(disliked.read?.dislikedFoods, foods);
      assert.deepEqual(disliked.viaApp?.dislikedFoods, foods);
    });

    const cleared = await saveThenReadElsewhere({ ...base, dislikedFoods: [] });
    check("B2 contract: an empty disliked list is stored as NULL and reads as []", () => {
      assert.equal(cleared.saveError, null);
      assert.equal(cleared.row?.disliked_foods, null);
      assert.deepEqual(cleared.viaApp?.dislikedFoods, []);
    });

    // Values written by the previous code: PostgREST stored the string[] as JSON text.
    sql("UPDATE public.profiles SET disliked_foods='[\"rábano ficticio\",\"nabo\"]' WHERE id='" + profileId + "';");
    const legacy = await profiles.getProfileForUserFromSupabase(userId).catch(() => null);
    check("B2 contract: disliked foods stored in the old JSON format are read without loss", () =>
      assert.deepEqual(legacy?.profile.dislikedFoods, ["rábano ficticio", "nabo"]));

    sql("UPDATE public.profiles SET goal='maintenance', goals='{}' WHERE id='" + profileId + "';");
    const maintenance = await profiles.getProfileForUserFromSupabase(userId).catch(() => null);
    check("B2 contract: legacy maintenance without goals reads as healthy_eating", () =>
      assert.deepEqual(maintenance?.profile.goals, ["healthy_eating"]));

    const tooLong = await saveThenReadElsewhere({ ...base, dislikedFoods: ["x".repeat(151)] });
    check("B2 contract: disliked foods over 150 characters are rejected before reaching the database", () => {
      assert.match(String(tooLong.saveError?.message), /150/);
      assert.notEqual(tooLong.row?.disliked_foods, "x".repeat(151));
    });
  } finally {
    // Replica role skips set_profiles_updated_at so the original version is restored too.
    sql("BEGIN; SET LOCAL session_replication_role = replica; UPDATE public.profiles p SET " + restorableColumns.map(c => c + "=r." + c).join(",") +
      " FROM json_populate_record(NULL::public.profiles, $snap$" + snapshot + "$snap$) r WHERE p.id=r.id; COMMIT;");
    await otherDevice.auth.signOut({ scope: "local" });
    await supabase.auth.signOut({ scope: "local" });
  }
  check("B2 contract: fixture profile restored", () =>
    assert.equal(sql("SELECT row_to_json(p) FROM public.profiles p WHERE id='" + profileId + "';").trim(), snapshot));
}

module.exports = { runProfileContractTests };
