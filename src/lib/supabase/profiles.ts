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
  | "maintenance"
  | "muscle_gain"
  | "sports_performance"
  | "healthy_eating";

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

export type UserProfile = {
  id?: string;
  sex: Sex;
  birthDate: string;
  heightCm: number;
  weightKg: number;
  householdSize: number;
  weeklyTrainingDays: number;
  trainingTypes: TrainingType[];
  otherTrainingType?: string;
  goal: Goal;
  dietaryRestrictions: DietaryRestriction[];
  allergies: Allergy[];
  otherAllergies?: string;
  dislikedFoods: string[];
};

type ProfileRow = {
  id: string;
  sex: string | null;
  birth_date: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  household_size: number | null;
  weekly_training_days: number | null;
  training_types: string[] | null;
  other_training_type: string | null;
  goal: string | null;
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
  "maintenance",
  "muscle_gain",
  "sports_performance",
  "healthy_eating",
]);
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

function profileToRow(profile: UserProfile) {
  if (profile.weeklyTrainingDays < 0 || profile.weeklyTrainingDays > 5) {
    throw new Error("weeklyTrainingDays must be between 0 and 5.");
  }

  return {
    sex: profile.sex,
    birth_date: profile.birthDate,
    height_cm: profile.heightCm,
    weight_kg: profile.weightKg,
    household_size: profile.householdSize,
    weekly_training_days: profile.weeklyTrainingDays,
    training_types: profile.trainingTypes,
    other_training_type: optionalText(profile.otherTrainingType),
    goal: profile.goal,
    dietary_restrictions: profile.dietaryRestrictions,
    allergies: profile.allergies,
    other_allergies: optionalText(profile.otherAllergies),
    disliked_foods: profile.dislikedFoods,
  };
}

function rowToProfile(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    sex: parseEnum(row.sex, sexValues, "sex"),
    birthDate: parseRequiredString(row.birth_date, "birth_date"),
    heightCm: parseRequiredNumber(row.height_cm, "height_cm"),
    weightKg: parseRequiredNumber(row.weight_kg, "weight_kg"),
    householdSize: parseRequiredNumber(row.household_size, "household_size"),
    weeklyTrainingDays: parseRequiredNumber(
      row.weekly_training_days,
      "weekly_training_days",
    ),
    trainingTypes: parseEnumArray(
      row.training_types,
      trainingTypeValues,
      "training_types",
    ),
    otherTrainingType: row.other_training_type ?? undefined,
    goal: parseEnum(row.goal, goalValues, "goal"),
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

export async function saveProfileToSupabase(profile: UserProfile) {
  if (!supabase) {
    throw new Error(
      "Supabase client is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  const { data: insertedProfile, error: profileError } = await supabase
    .from("profiles")
    .insert(profileToRow(profile))
    .select("id")
    .single();

  if (profileError) {
    throw new Error(`Could not save profile: ${profileError.message}`);
  }

  if (!insertedProfile?.id) {
    throw new Error(
      "Could not save profile: Supabase did not return a profile id.",
    );
  }

  return insertedProfile.id as string;
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
      "id,sex,birth_date,height_cm,weight_kg,household_size,weekly_training_days,training_types,other_training_type,goal,dietary_restrictions,allergies,other_allergies,disliked_foods",
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
