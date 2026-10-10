// Frozen copy of src/lib/supabase/profiles.ts as served by main (355780c) before the D2 migration.
// Used only by scripts/profile-db-tests.cjs to prove 20261010090000 keeps the deployed client
// working during the rollout. Do not edit except for the import path.
import { supabase } from "../../src/lib/supabase/client";

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

export type ProfileRow = {
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
  // TEXT in the database: "pollo, brócoli" (see serializeDislikedFoods).
  disliked_foods: string | null;
};

export const PROFILE_COLUMNS =
  "id,user_id,sex,birth_date,height_cm,weight_kg,household_size,weekly_training_days,training_types,other_training_type,goal,goals,other_goal,dietary_restrictions,allergies,other_allergies,disliked_foods";

// Same ranges as the CHECK constraints on public.profiles; weekly_training_days 0–7 since
// 20261007090000_profiles_training_days_0_7.
export const PROFILE_LIMITS = {
  heightCm: { min: 120, max: 230 },
  weightKg: { min: 45, max: 200 },
  householdSize: { min: 1, max: 6 },
  weeklyTrainingDays: { min: 0, max: 7 },
  otherGoalMaxLength: 150,
  dislikedFoodsMaxLength: 150,
} as const;

export type ProfileField = keyof UserProfile;

export type ProfileValidationIssue = {
  field: ProfileField;
  message: string;
};

export class ProfileValidationError extends Error {
  issues: ProfileValidationIssue[];

  constructor(issues: ProfileValidationIssue[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "ProfileValidationError";
    this.issues = issues;
  }
}

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
    parsedValue >= PROFILE_LIMITS.weeklyTrainingDays.min &&
    parsedValue <= PROFILE_LIMITS.weeklyTrainingDays.max
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

// Legacy profiles.goal CHECK: fat_loss, maintenance, muscle_gain, sports_performance,
// healthy_eating. goals is the source of truth; goal is derived and never 'other' or 'maintenance'.
const storableLegacyGoals: Goal[] = [
  "fat_loss",
  "muscle_gain",
  "sports_performance",
  "healthy_eating",
];
const fallbackLegacyGoal: Goal = "healthy_eating";

export function legacyGoalFromGoals(goals: Goal[]): Goal {
  return goals.find((goal) => storableLegacyGoals.includes(goal)) ?? fallbackLegacyGoal;
}

// --- disliked_foods: TEXT ↔ string[] -------------------------------------
// Stored as "pollo, brócoli, queso azul": items are trimmed, de-duplicated (case-insensitive)
// and never contain a separator, so the text round-trips. An empty list is NULL.
const dislikedFoodSeparator = /[,;\n]/;

export function normalizeDislikedFoods(foods: string[]) {
  const seen = new Set<string>();
  const normalizedFoods: string[] = [];

  for (const food of foods.flatMap((value) => value.split(dislikedFoodSeparator))) {
    const trimmedFood = food.trim().replace(/\s+/g, " ");
    const key = trimmedFood.toLocaleLowerCase("es");

    if (trimmedFood && !seen.has(key)) {
      seen.add(key);
      normalizedFoods.push(trimmedFood);
    }
  }

  return normalizedFoods;
}

export function serializeDislikedFoods(foods: string[]) {
  const normalizedFoods = normalizeDislikedFoods(foods);

  return normalizedFoods.length > 0 ? normalizedFoods.join(", ") : null;
}

function parseJsonStringArray(value: string) {
  try {
    const parsedValue: unknown = JSON.parse(value);

    return Array.isArray(parsedValue)
      ? parsedValue.filter((item): item is string => typeof item === "string")
      : null;
  } catch {
    return null;
  }
}

function parsePostgresArrayLiteral(value: string) {
  const body = value.trim().slice(1, -1);
  const items: string[] = [];
  const itemPattern = /\s*(?:"((?:[^"\\]|\\.)*)"|([^,]*))\s*(?:,|$)/g;
  let match: RegExpExecArray | null;

  while (body && (match = itemPattern.exec(body)) && match[0] !== "") {
    items.push(match[1] !== undefined ? match[1].replace(/\\(.)/g, "$1") : match[2]);
  }

  return items.filter((item) => item.toUpperCase() !== "NULL");
}

// Reads every format found in profiles.disliked_foods: the canonical text, the JSON array text
// written by the previous code ('["pollo"]', '[]') and a Postgres array literal ('{pollo}').
export function parseDislikedFoods(value: string | string[] | null | undefined) {
  if (Array.isArray(value)) {
    return normalizeDislikedFoods(value);
  }

  const text = value?.trim();

  if (!text) {
    return [];
  }

  if (text.startsWith("[")) {
    const jsonItems = parseJsonStringArray(text);

    if (jsonItems) {
      return normalizeDislikedFoods(jsonItems);
    }
  }

  if (text.startsWith("{") && text.endsWith("}")) {
    return normalizeDislikedFoods(parsePostgresArrayLiteral(text));
  }

  return normalizeDislikedFoods([text]);
}

function normalizeGoals(goals: Goal[], legacyGoal?: LegacyGoal): Goal[] {
  const normalizedGoals = goals.length > 0 ? goals : legacyGoal ? [legacyGoal] : [];
  // 'maintenance' only exists in the legacy column; goals never accepted it.
  const filteredGoals = normalizedGoals
    .map((goal) => (goal === "maintenance" ? "healthy_eating" : goal))
    .filter((goal): goal is Goal => goalValues.has(goal as Goal));

  return Array.from(new Set(filteredGoals));
}

function isIntegerInRange(value: unknown, range: { min: number; max: number }) {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= range.min &&
    value <= range.max
  );
}

function hasOnlyAllowedValues<T extends string>(values: unknown, allowedValues: Set<T>) {
  return Array.isArray(values) && values.every((value) => allowedValues.has(value as T));
}

// Client-side mirror of the CHECK constraints, run before every save.
export function validateProfileForStorage(profile: UserProfile): ProfileValidationIssue[] {
  const issues: ProfileValidationIssue[] = [];
  const addIssue = (field: ProfileField, message: string) => issues.push({ field, message });
  const { heightCm, weightKg, householdSize, weeklyTrainingDays } = PROFILE_LIMITS;

  if (!sexValues.has(profile.sex)) {
    addIssue("sex", "Elige un sexo.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(profile.birthDate ?? "")) {
    addIssue("birthDate", "Indica tu fecha de nacimiento.");
  }

  if (!isIntegerInRange(profile.heightCm, heightCm)) {
    addIssue("heightCm", `La altura debe ser un número entero entre ${heightCm.min} y ${heightCm.max} cm.`);
  }

  if (!isIntegerInRange(profile.weightKg, weightKg)) {
    addIssue("weightKg", `El peso debe ser un número entero entre ${weightKg.min} y ${weightKg.max} kg.`);
  }

  if (!isIntegerInRange(profile.householdSize, householdSize)) {
    addIssue("householdSize", `Las personas en casa deben estar entre ${householdSize.min} y ${householdSize.max}.`);
  }

  if (!isIntegerInRange(profile.weeklyTrainingDays, weeklyTrainingDays)) {
    addIssue(
      "weeklyTrainingDays",
      `Los días de entrenamiento deben estar entre ${weeklyTrainingDays.min} y ${weeklyTrainingDays.max}.`,
    );
  }

  if (!hasOnlyAllowedValues(profile.trainingTypes, trainingTypeValues)) {
    addIssue("trainingTypes", "Hay un tipo de entrenamiento no válido.");
  }

  if (!hasOnlyAllowedValues(profile.goals, goalValues)) {
    addIssue("goals", "Hay un objetivo no válido.");
  }

  if (!hasOnlyAllowedValues(profile.dietaryRestrictions, dietaryRestrictionValues)) {
    addIssue("dietaryRestrictions", "Hay una restricción alimentaria no válida.");
  }

  if (!hasOnlyAllowedValues(profile.allergies, allergyValues)) {
    addIssue("allergies", "Hay una alergia no válida.");
  }

  const otherGoalLength = profile.goals?.includes("other")
    ? (optionalText(profile.otherGoal) ?? "").length
    : 0;

  if (otherGoalLength > PROFILE_LIMITS.otherGoalMaxLength) {
    addIssue(
      "otherGoal",
      `El objetivo «Otro» ocupa ${otherGoalLength}/${PROFILE_LIMITS.otherGoalMaxLength} caracteres. Acórtalo para guardar.`,
    );
  }

  const dislikedFoodsLength = (serializeDislikedFoods(profile.dislikedFoods ?? []) ?? "").length;

  if (dislikedFoodsLength > PROFILE_LIMITS.dislikedFoodsMaxLength) {
    addIssue(
      "dislikedFoods",
      `Los alimentos que no te gustan ocupan ${dislikedFoodsLength}/${PROFILE_LIMITS.dislikedFoodsMaxLength} caracteres. Acorta la lista para guardar.`,
    );
  }

  return issues;
}

export function profileToRow(
  profile: UserProfile,
  options: SaveProfileToSupabaseOptions = {},
) {
  const issues = validateProfileForStorage(profile);

  if (issues.length > 0) {
    throw new ProfileValidationError(issues);
  }

  const goals = normalizeGoals(profile.goals, profile.goal);

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
    goal: legacyGoalFromGoals(goals),
    goals,
    other_goal: goals.includes("other")
      ? optionalText(profile.otherGoal)
      : null,
    dietary_restrictions: profile.dietaryRestrictions,
    allergies: profile.allergies,
    other_allergies: optionalText(profile.otherAllergies),
    disliked_foods: serializeDislikedFoods(profile.dislikedFoods),
  };
}

export function profileFromRow(row: ProfileRow): UserProfile {
  const legacyGoal = row.goal && legacyGoalValues.has(row.goal as LegacyGoal)
    ? (row.goal as LegacyGoal)
    : undefined;

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
    goal: legacyGoal,
    goals: normalizeGoals(
      parseEnumArray(row.goals, goalValues, "goals"),
      legacyGoal,
    ),
    otherGoal: row.other_goal ?? undefined,
    dietaryRestrictions: parseEnumArray(
      row.dietary_restrictions,
      dietaryRestrictionValues,
      "dietary_restrictions",
    ),
    allergies: parseEnumArray(row.allergies, allergyValues, "allergies"),
    otherAllergies: row.other_allergies ?? undefined,
    // Tolerates the JSON text the previous code stored; '[]' reads as [].
    dislikedFoods: parseDislikedFoods(row.disliked_foods),
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
      PROFILE_COLUMNS,
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

  return profileFromRow(savedProfile);
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
      PROFILE_COLUMNS,
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

  return profileFromRow(latestProfile);
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
      `${PROFILE_COLUMNS},updated_at`,
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

  return { profile: profileFromRow(profileRow), updatedAt: profileRow.updated_at ?? null };
}
