import { supabase } from "./client";

export type Sex = "male" | "female";

export type TrainingType =
  | "strength"
  | "crossfit"
  | "hyrox"
  | "running"
  | "cycling"
  | "padel"
  | "swimming"
  | "team_sports"
  | "hiking"
  | "yoga_pilates"
  | "other";

export type Goal =
  | "fat_loss"
  | "muscle_gain"
  | "sports_performance"
  | "healthy_eating"
  | "other";

export type LegacyGoal = Goal | "maintenance";

export type DietaryRestriction =
  | "none"
  | "vegetarian"
  | "vegan"
  | "pescatarian"
  | "no_pork"
  | "no_alcohol";

export type Allergy =
  | "gluten"
  | "lactose"
  | "nuts"
  | "shellfish"
  | "egg"
  | "other";

export type WeeklyTrainingDays = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type UserProfile = {
  id?: string;
  userId?: string;
  user_id?: string;
  sex: Sex;
  birthDate: string;
  heightCm: number;
  weightKg: number;
  householdSize: number;
  weeklyTrainingDays: WeeklyTrainingDays;
  trainingTypes: TrainingType[];
  otherTrainingType?: string;
  goals: Goal[];
  goal?: LegacyGoal;
  otherGoal?: string;
  dietaryRestrictions: DietaryRestriction[];
  allergies: Allergy[];
  otherAllergies?: string;
  dislikedFoods: string[];
};

type SaveProfileToSupabaseOptions = {
  userId?: string | null;
};

type ProfileRow = {
  id: string;
  user_id?: string | null;
  sex: string | null;
  birth_date: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  household_size: number | null;
  weekly_training_days: number | null;
  training_types: string[] | null;
  other_training_type: string | null;
  goal: string | null;
  goals: string[] | null;
  other_goal: string | null;
  dietary_restrictions: string[] | null;
  allergies: string[] | null;
  other_allergies: string | null;
  disliked_foods: string[] | null;
};

const sexValues = new Set<Sex>(["male", "female"]);
const trainingTypeValues = new Set<TrainingType>([
  "strength",
  "crossfit",
  "hyrox",
  "running",
  "cycling",
  "padel",
  "swimming",
  "team_sports",
  "hiking",
  "yoga_pilates",
  "other",
]);
const goalValues = new Set<Goal>([
  "fat_loss",
  "muscle_gain",
  "sports_performance",
  "healthy_eating",
  "other",
]);
const legacyGoalValues = new Set<LegacyGoal>([...goalValues, "maintenance"]);
const dietaryRestrictionValues = new Set<DietaryRestriction>([
  "none",
  "vegetarian",
  "vegan",
  "pescatarian",
  "no_pork",
  "no_alcohol",
]);
const allergyValues = new Set<Allergy>([
  "gluten",
  "lactose",
  "nuts",
  "shellfish",
  "egg",
  "other",
]);

function optionalText(value: string | undefined) {
  const trimmedValue = value?.trim();

  return trimmedValue ? trimmedValue : null;
}

function parseRequiredString(value: string | null, columnName: string) {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  throw new Error(`Unexpected empty value in profiles.${columnName}.`);
}

function parseRequiredNumber(value: number | null, columnName: string) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  throw new Error(`Unexpected empty value in profiles.${columnName}.`);
}

function parseWeeklyTrainingDays(value: number | null): WeeklyTrainingDays {
  const parsedValue = parseRequiredNumber(value, "weekly_training_days");

  if (
    Number.isInteger(parsedValue) &&
    parsedValue >= 0 &&
    parsedValue <= 7
  ) {
    return parsedValue as WeeklyTrainingDays;
  }

  throw new Error(
    `Unexpected value in profiles.weekly_training_days: ${parsedValue}.`,
  );
}

function parseEnum<T extends string>(
  value: string | null,
  allowedValues: Set<T>,
  columnName: string,
): T {
  const parsedValue = parseRequiredString(value, columnName);

  if (allowedValues.has(parsedValue as T)) {
    return parsedValue as T;
  }

  throw new Error(
    `Unexpected value in profiles.${columnName}: ${parsedValue}.`,
  );
}

function parseEnumArray<T extends string>(
  values: string[] | null,
  allowedValues: Set<T>,
  columnName: string,
): T[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.map((value) => {
    if (allowedValues.has(value as T)) {
      return value as T;
    }

    throw new Error(`Unexpected value in profiles.${columnName}: ${value}.`);
  });
}

function parseStringArray(values: string[] | null) {
  return Array.isArray(values) ? values : [];
}

function normalizeGoals(goals: Goal[], legacyGoal?: LegacyGoal): Goal[] {
  const normalizedGoals = goals.length > 0 ? goals : legacyGoal ? [legacyGoal] : [];
  const filteredGoals = normalizedGoals
    .map((goal) => (goal === "maintenance" ? "healthy_eating" : goal))
    .filter((goal): goal is Goal => goalValues.has(goal as Goal));

  return Array.from(new Set(filteredGoals));
}

function getLegacyGoalForStorage(profile: UserProfile): Goal {
  return normalizeGoals(profile.goals, profile.goal)[0] ?? "healthy_eating";
}

function profileToRow(
  profile: UserProfile,
  options: SaveProfileToSupabaseOptions = {},
) {
  if (profile.weeklyTrainingDays < 0 || profile.weeklyTrainingDays > 7) {
    throw new Error("weeklyTrainingDays must be between 0 and 7.");
  }

  return {
    user_id: options.userId ?? null,
    sex: profile.sex,
    birth_date: profile.birthDate,
    height_cm: profile.heightCm,
    weight_kg: profile.weightKg,
    household_size: profile.householdSize,
    weekly_training_days: profile.weeklyTrainingDays,
    training_types: profile.trainingTypes,
    other_training_type: optionalText(profile.otherTrainingType),
    goal: getLegacyGoalForStorage(profile),
    goals: normalizeGoals(profile.goals, profile.goal),
    other_goal: profile.goals.includes("other")
      ? optionalText(profile.otherGoal)
      : null,
    dietary_restrictions: profile.dietaryRestrictions,
    allergies: profile.allergies,
    other_allergies: optionalText(profile.otherAllergies),
    disliked_foods: profile.dislikedFoods,
  };
}

function rowToProfile(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    userId: row.user_id ?? undefined,
    user_id: row.user_id ?? undefined,
    sex: parseEnum(row.sex, sexValues, "sex"),
    birthDate: parseRequiredString(row.birth_date, "birth_date"),
    heightCm: parseRequiredNumber(row.height_cm, "height_cm"),
    weightKg: parseRequiredNumber(row.weight_kg, "weight_kg"),
    householdSize: parseRequiredNumber(row.household_size, "household_size"),
    weeklyTrainingDays: parseWeeklyTrainingDays(row.weekly_training_days),
    trainingTypes: parseEnumArray(
      row.training_types,
      trainingTypeValues,
      "training_types",
    ),
    otherTrainingType: row.other_training_type ?? undefined,
    goal: row.goal && legacyGoalValues.has(row.goal as LegacyGoal)
      ? (row.goal as LegacyGoal)
      : undefined,
    goals: normalizeGoals(
      parseEnumArray(row.goals, goalValues, "goals"),
      row.goal && legacyGoalValues.has(row.goal as LegacyGoal)
        ? (row.goal as LegacyGoal)
        : undefined,
    ),
    otherGoal: row.other_goal ?? undefined,
    dietaryRestrictions: parseEnumArray(
      row.dietary_restrictions,
      dietaryRestrictionValues,
      "dietary_restrictions",
    ),
    allergies: parseEnumArray(row.allergies, allergyValues, "allergies"),
    otherAllergies: row.other_allergies ?? undefined,
    dislikedFoods: parseStringArray(row.disliked_foods),
  };
}

export async function saveProfileToSupabase(
  profile: UserProfile,
  options: SaveProfileToSupabaseOptions = {},
) {
  if (!supabase) {
    throw new Error(
      "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  if (!options.userId) {
    throw new Error(
      "Cannot save profile to Supabase without an authenticated user id.",
    );
  }

  const profileRow = profileToRow(profile, options);
  const { data: savedProfile, error: profileError } = await supabase
    .from("profiles")
    .upsert(profileRow, { onConflict: "user_id" })
    .select(
      "id,user_id,sex,birth_date,height_cm,weight_kg,household_size,weekly_training_days,training_types,other_training_type,goal,goals,other_goal,dietary_restrictions,allergies,other_allergies,disliked_foods",
    )
    .maybeSingle<ProfileRow>();

  if (profileError) {
    console.error("Supabase returned an error while saving profile.", {
      userId: options.userId,
      error: profileError,
    });

    throw new Error(
      `Could not save profile for user ${options.userId}: ${profileError.message}`,
    );
  }

  if (!savedProfile) {
    throw new Error(
      `Could not save profile for user ${options.userId}: Supabase did not return a row.`,
    );
  }

  return rowToProfile(savedProfile);
}

export async function getLatestProfileFromSupabase(): Promise<UserProfile | null> {
  if (!supabase) {
    throw new Error(
      "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  const { data: latestProfile, error: profileError } = await supabase
    .from("profiles")
    .select(
      "id,user_id,sex,birth_date,height_cm,weight_kg,household_size,weekly_training_days,training_types,other_training_type,goal,goals,other_goal,dietary_restrictions,allergies,other_allergies,disliked_foods",
    )
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ProfileRow>();

  if (profileError) {
    throw new Error(`Could not read latest profile: ${profileError.message}`);
  }

  if (!latestProfile) {
    return null;
  }

  return rowToProfile(latestProfile);
}

// The signed-in user's own profile and its remote version (updated_at).
export async function getProfileForUserFromSupabase(
  userId: string,
): Promise<{ profile: UserProfile; updatedAt: string | null } | null> {
  if (!supabase) {
    throw new Error(
      "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select(
      "id,user_id,sex,birth_date,height_cm,weight_kg,household_size,weekly_training_days,training_types,other_training_type,goal,goals,other_goal,dietary_restrictions,allergies,other_allergies,disliked_foods,updated_at",
    )
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<ProfileRow & { updated_at: string | null }>();

  if (profileError) {
    throw new Error(`Could not read profile: ${profileError.message}`);
  }

  if (!profileRow) {
    return null;
  }

  return { profile: rowToProfile(profileRow), updatedAt: profileRow.updated_at ?? null };
}
