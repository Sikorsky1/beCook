import "./legacy-supabase-disabled";
async function main() {
  const { saveProfileToSupabase } = await import(
    "../src/lib/supabase/profiles"
  );
  const testProfile = {
    sex: "male",
    birthDate: "1988-04-12",
    heightCm: 178,
    weightKg: 76,
    householdSize: 2,
    weeklyTrainingDays: 7,
    trainingTypes: ["strength", "crossfit", "hyrox", "padel"],
    goals: ["sports_performance"],
    goal: "sports_performance",
    otherGoal: "",
    dietaryRestrictions: ["none"],
    allergies: [],
    dislikedFoods: ["higado", "coliflor hervida"],
  } satisfies Parameters<typeof saveProfileToSupabase>[0];

  const profileId = await saveProfileToSupabase(testProfile);

  console.log("Saved test profile:");
  console.log({ profileId });
}

main().catch((error: unknown) => {
  console.error(
    "Could not save test profile:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
