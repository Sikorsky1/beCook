// Profile form (roadmap step 24): sections saved one at a time, nothing pre-selected for a new
// profile and no personal data filled in on the user's behalf. Each saved section is recorded in
// confirmedSections; values never confirmed (saved by the previous form) are shown as assumed.
// Storage rules stay in src/lib/supabase/profiles.ts (validateProfileForStorage, profileToRow).
import {
  legacyGoalFromGoals,
  normalizeConfirmations,
  normalizeDislikedFoods,
  validateProfileForStorage,
  type Allergy,
  type DietaryRestriction,
  type Goal,
  type ProfileConfirmation,
  type ProfileField,
  type ProfileValidationIssue,
  type Sex,
  type TrainingType,
  type UserProfile,
  type WeeklyTrainingDays,
} from "@/lib/supabase/profiles";

export type ProfileSection = "household" | "goals" | "restrictions" | "training" | "body";

export const profileSections: ProfileSection[] = ["household", "goals", "restrictions", "training", "body"];

// What each section does for the menu, shown next to it. Body data is not sent to the generator
// (src/lib/menu-generation/prompt.ts reads none of it).
export const profileSectionInfo: Record<
  ProfileSection,
  { title: string; usage: string; required: boolean }
> = {
  household: {
    title: "¿Para cuántas personas cocinas?",
    usage: "Es el número de personas que se propone al crear el menú.",
    required: true,
  },
  goals: {
    title: "Qué quieres mejorar",
    usage: "Orientan qué platos se eligen para tu menú.",
    required: true,
  },
  restrictions: {
    title: "Restricciones y alergias",
    usage: "Son obligatorias para el menú y para «Otra idea». Los alimentos que no te gustan se evitan cuando es posible.",
    required: true,
  },
  training: {
    title: "Entrenamiento",
    usage: "Opcional. Ayuda a ajustar el menú a tu actividad.",
    required: false,
  },
  body: {
    title: "Datos corporales",
    usage: "beCook ya no pide sexo, edad, altura ni peso: no se usan para crear el menú. Puedes borrar los que guardaste.",
    required: false,
  },
};

const sectionFields: Record<ProfileSection, ProfileField[]> = {
  household: ["householdSize"],
  goals: ["goals", "goal", "otherGoal"],
  restrictions: ["dietaryRestrictions", "allergies", "otherAllergies", "dislikedFoods"],
  training: ["weeklyTrainingDays", "trainingTypes", "otherTrainingType"],
  body: ["sex", "birthDate", "heightCm", "weightKg"],
};

// What saving a section confirms in profiles.confirmed_sections.
export const sectionConfirmations: Record<ProfileSection, ProfileConfirmation[]> = {
  household: ["household"],
  goals: ["goals"],
  restrictions: ["restrictions", "allergies"],
  training: ["training"],
  body: ["body"],
};

// The sections a menu needs; Crear menú and the onboarding check these.
export const menuSections: ProfileSection[] = ["household", "goals", "restrictions"];

export function isSectionConfirmed(profile: UserProfile | null, section: ProfileSection) {
  const confirmed = profile?.confirmedSections ?? [];

  return sectionConfirmations[section].every((value) => confirmed.includes(value));
}

// Required sections whose saved values the user never confirmed (a profile of the previous form).
export function assumedMenuSections(profile: UserProfile | null): ProfileSection[] {
  return profile ? menuSections.filter((section) => !isSectionConfirmed(profile, section)) : [];
}

function withConfirmations(profile: UserProfile, sections: ProfileSection[]): UserProfile {
  const confirmed = new Set(profile.confirmedSections ?? []);

  for (const section of sections) {
    for (const value of sectionConfirmations[section]) {
      confirmed.add(value);
    }
  }

  return { ...profile, confirmedSections: normalizeConfirmations([...confirmed]) };
}

export function sectionOfField(field: ProfileField): ProfileSection | null {
  return profileSections.find((section) => sectionFields[section].includes(field)) ?? null;
}

// Form state. null / "" / [] mean "not answered"; nothing here is a default the user did not pick.
export type ProfileDraft = {
  householdSize: number | null;
  goals: Goal[];
  otherGoal: string;
  // [] = not answered; ["none"] = the user confirmed "Ninguna".
  dietaryRestrictions: DietaryRestriction[];
  allergies: Allergy[];
  // Explicit "Ninguna" for allergies (stored as an empty list).
  noAllergies: boolean;
  otherAllergies: string;
  dislikedFoodsText: string;
  weeklyTrainingDays: WeeklyTrainingDays;
  trainingTypes: TrainingType[];
  otherTrainingType: string;
  sex: Sex | null;
  birthDate: string;
  heightCm: string;
  weightKg: string;
};

export function emptyProfileDraft(): ProfileDraft {
  return {
    householdSize: null,
    goals: [],
    otherGoal: "",
    dietaryRestrictions: [],
    allergies: [],
    noAllergies: false,
    otherAllergies: "",
    dislikedFoodsText: "",
    weeklyTrainingDays: 0,
    trainingTypes: [],
    otherTrainingType: "",
    sex: null,
    birthDate: "",
    heightCm: "",
    weightKg: "",
  };
}

// The goals the form offers (N06). Body-composition goals of the previous form read as
// «Comer más saludable»; the stored value only changes when the person saves the section.
export const habitGoals: Goal[] = ["healthy_eating", "varied", "more_plants", "cook_home", "save_time", "save_money", "with_kids", "other"];
const goalValues: Goal[] = habitGoals;
const previousGoals = new Set<unknown>(["maintenance", "fat_loss", "muscle_gain", "sports_performance"]);

function storedGoals(profile: UserProfile): Goal[] {
  const rawGoals: unknown[] = Array.isArray(profile.goals) && profile.goals.length > 0
    ? profile.goals
    : profile.goal ? [profile.goal] : [];
  const goals = rawGoals
    .map((goal) => (previousGoals.has(goal) ? "healthy_eating" : goal))
    .filter((goal): goal is Goal => goalValues.includes(goal as Goal));

  return Array.from(new Set(goals));
}

// A saved profile from the cache or the account. Anything else (an old or broken cache) reads as
// "no profile" rather than being completed with made-up values.
export function readStoredProfile(value: unknown): UserProfile | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const profile = value as Partial<UserProfile>;
  const isOptional = (field: unknown, type: "string" | "number") =>
    field === null || field === undefined || typeof field === type;
  const isComplete =
    isOptional(profile.sex, "string") &&
    isOptional(profile.birthDate, "string") &&
    isOptional(profile.heightCm, "number") &&
    isOptional(profile.weightKg, "number") &&
    typeof profile.householdSize === "number" &&
    typeof profile.weeklyTrainingDays === "number" &&
    Number.isInteger(profile.weeklyTrainingDays) &&
    profile.weeklyTrainingDays >= 0 &&
    profile.weeklyTrainingDays <= 7 &&
    Array.isArray(profile.trainingTypes) &&
    (Array.isArray(profile.goals) || typeof profile.goal === "string") &&
    Array.isArray(profile.dietaryRestrictions) &&
    Array.isArray(profile.allergies) &&
    Array.isArray(profile.dislikedFoods);

  if (!isComplete) {
    return null;
  }

  const goals = storedGoals(profile as UserProfile);

  return {
    ...(profile as UserProfile),
    sex: profile.sex ?? null,
    birthDate: profile.birthDate || null,
    heightCm: profile.heightCm ?? null,
    weightKg: profile.weightKg ?? null,
    goals,
    goal: legacyGoalFromGoals(goals),
    // A copy saved before D2 has no confirmations: the account keeps its own when saving.
    confirmedSections: Array.isArray(profile.confirmedSections)
      ? normalizeConfirmations(profile.confirmedSections)
      : undefined,
  };
}

export function draftFromProfile(profile: UserProfile | null): ProfileDraft {
  if (!profile) {
    return emptyProfileDraft();
  }

  const goals = storedGoals(profile);

  return {
    householdSize: profile.householdSize,
    goals,
    otherGoal: goals.includes("other") ? profile.otherGoal ?? "" : "",
    dietaryRestrictions: [...profile.dietaryRestrictions],
    allergies: [...profile.allergies],
    // The schema has no "none" allergy: an empty list is «Ninguna». It is an answer when the
    // allergies are confirmed; in a profile of the previous form it is shown as assumed.
    noAllergies: profile.allergies.length === 0,
    otherAllergies: profile.allergies.includes("other") ? profile.otherAllergies ?? "" : "",
    dislikedFoodsText: profile.dislikedFoods.join(", "),
    weeklyTrainingDays: profile.weeklyTrainingDays,
    trainingTypes: [...profile.trainingTypes],
    otherTrainingType: profile.trainingTypes.includes("other") ? profile.otherTrainingType ?? "" : "",
    sex: profile.sex ?? null,
    birthDate: profile.birthDate ?? "",
    heightCm: profile.heightCm == null ? "" : String(profile.heightCm),
    weightKg: profile.weightKg == null ? "" : String(profile.weightKg),
  };
}

// "175", " 175 cm" → 175. Anything else becomes NaN and fails the range check with its message.
// An empty field is null (not given).
export function parseOptionalWholeNumber(value: string): number | null {
  return value.trim() ? parseWholeNumber(value) : null;
}

export function parseWholeNumber(value: string): number {
  const text = value.trim().replace(/\s*(cm|kg)$/i, "");

  return /^\d+$/.test(text) ? Number(text) : Number.NaN;
}

// "Ninguna" excludes every other restriction and vice versa.
export function toggleRestriction(
  current: DietaryRestriction[],
  value: DietaryRestriction,
): DietaryRestriction[] {
  if (current.includes(value)) {
    return current.filter((restriction) => restriction !== value);
  }

  return value === "none"
    ? ["none"]
    : [...current.filter((restriction) => restriction !== "none"), value];
}

// --- Section values -------------------------------------------------------
type SectionValues = Partial<UserProfile>;

function sectionValues(draft: ProfileDraft, section: ProfileSection): SectionValues {
  switch (section) {
    case "household":
      return { householdSize: draft.householdSize ?? Number.NaN };
    case "goals":
      return {
        goals: draft.goals,
        goal: legacyGoalFromGoals(draft.goals),
        otherGoal: draft.goals.includes("other") ? draft.otherGoal.trim() : "",
      };
    case "restrictions":
      return {
        dietaryRestrictions: draft.dietaryRestrictions,
        allergies: draft.noAllergies ? [] : draft.allergies,
        otherAllergies: !draft.noAllergies && draft.allergies.includes("other")
          ? draft.otherAllergies.trim()
          : "",
        dislikedFoods: normalizeDislikedFoods([draft.dislikedFoodsText]),
      };
    case "training":
      return {
        weeklyTrainingDays: draft.weeklyTrainingDays,
        trainingTypes: draft.trainingTypes,
        otherTrainingType: draft.trainingTypes.includes("other") ? draft.otherTrainingType.trim() : "",
      };
    case "body":
      return {
        sex: draft.sex,
        birthDate: draft.birthDate || null,
        heightCm: parseOptionalWholeNumber(draft.heightCm),
        weightKg: parseOptionalWholeNumber(draft.weightKg),
      };
  }
}

// Whether an optional section holds anything (training other than "0 days, no type"; any body data).
function hasOptionalValues(draft: ProfileDraft, section: "training" | "body") {
  return section === "training"
    ? draft.weeklyTrainingDays > 0 || draft.trainingTypes.length > 0
    : Boolean(draft.sex || draft.birthDate || draft.heightCm.trim() || draft.weightKg.trim());
}

export function emptyBodyDraft(): Pick<ProfileDraft, "sex" | "birthDate" | "heightCm" | "weightKg"> {
  return { sex: null, birthDate: "", heightCm: "", weightKg: "" };
}

// Questions the user still has to answer in a section (before any range check).
export function unansweredIssues(draft: ProfileDraft, section: ProfileSection): ProfileValidationIssue[] {
  const issues: ProfileValidationIssue[] = [];

  if (section === "household" && draft.householdSize === null) {
    issues.push({ field: "householdSize", message: "Indica para cuántas personas cocinas." });
  }

  if (section === "goals" && draft.goals.length === 0) {
    issues.push({ field: "goals", message: "Elige al menos un objetivo." });
  }

  if (section === "restrictions") {
    if (draft.dietaryRestrictions.length === 0) {
      issues.push({ field: "dietaryRestrictions", message: "Elige tus restricciones o marca «Ninguna»." });
    }

    if (!draft.noAllergies && draft.allergies.length === 0) {
      issues.push({ field: "allergies", message: "Elige tus alergias o marca «Ninguna»." });
    }

    if (!draft.noAllergies && draft.allergies.includes("other") && !draft.otherAllergies.trim()) {
      issues.push({ field: "otherAllergies", message: "Escribe qué otras alergias hay." });
    }
  }

  return issues;
}

export function isSectionAnswered(draft: ProfileDraft, section: ProfileSection) {
  return unansweredIssues(draft, section).length === 0;
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

// Whether the section differs from what is saved (always true while nothing is saved).
export function isSectionDirty(draft: ProfileDraft, saved: UserProfile | null, section: ProfileSection) {
  if (!saved) {
    return true;
  }

  return !sameValue(sectionValues(draft, section), sectionValues(draftFromProfile(saved), section));
}

// pending: a required question without answer · unsaved: edited · saved: saved and confirmed ·
// assumed: saved by the previous form and never confirmed · optional: optional and left empty.
export type SectionStatus = "pending" | "unsaved" | "saved" | "assumed" | "optional";

export function sectionStatus(
  draft: ProfileDraft,
  saved: UserProfile | null,
  section: ProfileSection,
): SectionStatus {
  if (!isSectionAnswered(draft, section)) {
    return "pending";
  }

  const isOptionalSection = section === "training" || section === "body";
  const isEmptyOptional = isOptionalSection && !hasOptionalValues(draft, section);

  if (!saved) {
    return isEmptyOptional ? "optional" : "unsaved";
  }

  if (isSectionDirty(draft, saved, section)) {
    return "unsaved";
  }

  // N06: body data is no longer asked for, so there is nothing to confirm; it can only be deleted.
  if (section === "body") {
    return "optional";
  }

  if (isSectionConfirmed(saved, section)) {
    return isEmptyOptional ? "optional" : "saved";
  }

  return isEmptyOptional ? "optional" : "assumed";
}

// Saving is offered for edits and to confirm assumed values (nothing changes but the confirmation).
export function canSaveSection(status: SectionStatus) {
  return status === "unsaved" || status === "assumed";
}

export type ProfileBuildResult =
  | { ok: true; profile: UserProfile }
  | { ok: false; issues: ProfileValidationIssue[] };

function checkProfile(profile: UserProfile, sections: ProfileSection[], draft: ProfileDraft): ProfileBuildResult {
  const unanswered = sections.flatMap((section) => unansweredIssues(draft, section));

  if (unanswered.length > 0) {
    return { ok: false, issues: unanswered };
  }

  const issues = validateProfileForStorage(profile);

  return issues.length > 0 ? { ok: false, issues } : { ok: true, profile };
}

// Sections answered in a first save: the required ones, plus optional ones the user filled in.
function answeredSections(draft: ProfileDraft, sections: ProfileSection[]) {
  return sections.filter(
    (section) => (section !== "training" && section !== "body") || hasOptionalValues(draft, section),
  );
}

// First save: every required section must be answered. Training may stay empty (0 days) and
// body data may be left out; neither is then confirmed.
export function buildNewProfile(draft: ProfileDraft): ProfileBuildResult {
  const profile = profileSections.reduce(
    (current, section) => ({ ...current, ...sectionValues(draft, section) }),
    { confirmedSections: [] } as unknown as UserProfile,
  );

  return checkProfile(withConfirmations(profile, answeredSections(draft, profileSections)), profileSections, draft);
}

// Later saves: only this section changes (and is confirmed); unsaved edits elsewhere are not sent.
export function applySection(
  saved: UserProfile,
  draft: ProfileDraft,
  section: ProfileSection,
): ProfileBuildResult {
  const profile: UserProfile = { ...saved, ...sectionValues(draft, section) };

  return checkProfile(withConfirmations(profile, [section]), [section], draft);
}

// Onboarding step 2: household, goals and restrictions, on top of the saved profile if there is
// one. Without one, training stays empty and body data is not asked for.
export function buildOnboardingProfile(
  saved: UserProfile | null,
  draft: ProfileDraft,
): ProfileBuildResult {
  const base: UserProfile = saved ?? {
    ...sectionValues(emptyProfileDraft(), "training"),
    ...sectionValues(emptyProfileDraft(), "body"),
    confirmedSections: [],
  } as UserProfile;
  const profile = menuSections.reduce(
    (current, section) => ({ ...current, ...sectionValues(draft, section) }),
    base,
  );

  return checkProfile(withConfirmations(profile, menuSections), menuSections, draft);
}

// After a save or a conflict: the given sections take the saved values, the rest keep their edits.
export function resetSections(
  draft: ProfileDraft,
  saved: UserProfile | null,
  sections: ProfileSection[],
): ProfileDraft {
  const savedDraft = draftFromProfile(saved);
  const next = { ...draft };
  const draftKeys: Record<ProfileSection, (keyof ProfileDraft)[]> = {
    household: ["householdSize"],
    goals: ["goals", "otherGoal"],
    restrictions: ["dietaryRestrictions", "allergies", "noAllergies", "otherAllergies", "dislikedFoodsText"],
    training: ["weeklyTrainingDays", "trainingTypes", "otherTrainingType"],
    body: ["sex", "birthDate", "heightCm", "weightKg"],
  };

  for (const section of sections) {
    for (const key of draftKeys[section]) {
      (next as Record<string, unknown>)[key] = savedDraft[key];
    }
  }

  return next;
}

export function issuesBySection(issues: ProfileValidationIssue[]) {
  const grouped: Partial<Record<ProfileSection, ProfileValidationIssue[]>> = {};

  for (const issue of issues) {
    const section = sectionOfField(issue.field) ?? "household";
    grouped[section] = [...(grouped[section] ?? []), issue];
  }

  return grouped;
}
