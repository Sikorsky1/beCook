// Profile form (roadmap step 24): sections saved one at a time, nothing pre-selected for a new
// profile and no personal data filled in on the user's behalf. Storage rules stay in
// src/lib/supabase/profiles.ts (validateProfileForStorage, profileToRow).
import {
  legacyGoalFromGoals,
  normalizeDislikedFoods,
  validateProfileForStorage,
  type Allergy,
  type DietaryRestriction,
  type Goal,
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
    title: "Objetivos",
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
    usage: "No se usan para crear el menú. Por ahora tu perfil no se puede guardar sin ellos.",
    required: true,
  },
};

const sectionFields: Record<ProfileSection, ProfileField[]> = {
  household: ["householdSize"],
  goals: ["goals", "goal", "otherGoal"],
  restrictions: ["dietaryRestrictions", "allergies", "otherAllergies", "dislikedFoods"],
  training: ["weeklyTrainingDays", "trainingTypes", "otherTrainingType"],
  body: ["sex", "birthDate", "heightCm", "weightKg"],
};

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

const goalValues: Goal[] = ["fat_loss", "muscle_gain", "sports_performance", "healthy_eating", "other"];

function storedGoals(profile: UserProfile): Goal[] {
  const rawGoals: unknown[] = Array.isArray(profile.goals) && profile.goals.length > 0
    ? profile.goals
    : profile.goal ? [profile.goal] : [];
  const goals = rawGoals
    .map((goal) => (goal === "maintenance" ? "healthy_eating" : goal))
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
  const isComplete =
    typeof profile.sex === "string" &&
    typeof profile.birthDate === "string" &&
    typeof profile.heightCm === "number" &&
    typeof profile.weightKg === "number" &&
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

  return { ...(profile as UserProfile), goals, goal: legacyGoalFromGoals(goals) };
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
    // The schema has no "none" allergy: a saved empty list is the answer that was saved.
    // Telling it apart from "never answered" needs confirmed_sections (pending migration).
    noAllergies: profile.allergies.length === 0,
    otherAllergies: profile.allergies.includes("other") ? profile.otherAllergies ?? "" : "",
    dislikedFoodsText: profile.dislikedFoods.join(", "),
    weeklyTrainingDays: profile.weeklyTrainingDays,
    trainingTypes: [...profile.trainingTypes],
    otherTrainingType: profile.trainingTypes.includes("other") ? profile.otherTrainingType ?? "" : "",
    sex: profile.sex,
    birthDate: profile.birthDate,
    heightCm: String(profile.heightCm),
    weightKg: String(profile.weightKg),
  };
}

// "175", " 175 cm" → 175. Anything else becomes NaN and fails the range check with its message.
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
        sex: draft.sex as Sex,
        birthDate: draft.birthDate,
        heightCm: parseWholeNumber(draft.heightCm),
        weightKg: parseWholeNumber(draft.weightKg),
      };
  }
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

  if (section === "body") {
    if (!draft.sex) {
      issues.push({ field: "sex", message: "Elige un sexo." });
    }

    if (!draft.birthDate) {
      issues.push({ field: "birthDate", message: "Indica tu fecha de nacimiento." });
    }

    if (!draft.heightCm.trim()) {
      issues.push({ field: "heightCm", message: "Indica tu altura." });
    }

    if (!draft.weightKg.trim()) {
      issues.push({ field: "weightKg", message: "Indica tu peso." });
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

export type SectionStatus = "pending" | "unsaved" | "saved";

export function sectionStatus(
  draft: ProfileDraft,
  saved: UserProfile | null,
  section: ProfileSection,
): SectionStatus {
  if (!isSectionAnswered(draft, section)) {
    return "pending";
  }

  return isSectionDirty(draft, saved, section) ? "unsaved" : "saved";
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

// First save: every required section must be answered. Training may stay as it is (0 days).
export function buildNewProfile(draft: ProfileDraft): ProfileBuildResult {
  const profile = profileSections.reduce(
    (current, section) => ({ ...current, ...sectionValues(draft, section) }),
    {} as UserProfile,
  );

  return checkProfile(profile, profileSections, draft);
}

// Later saves: only this section changes; unsaved edits in other sections are not sent.
export function applySection(
  saved: UserProfile,
  draft: ProfileDraft,
  section: ProfileSection,
): ProfileBuildResult {
  const profile: UserProfile = { ...saved, ...sectionValues(draft, section) };

  return checkProfile(profile, [section], draft);
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
    const section = sectionOfField(issue.field) ?? "body";
    grouped[section] = [...(grouped[section] ?? []), issue];
  }

  return grouped;
}
