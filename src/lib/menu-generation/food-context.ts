// Food context (C1, roadmap step 16): the restrictions and preferences a menu, its substitutions
// and its shopping list depend on. Always read from the account (current_food_context /
// week_food_context_status), never from the browser. Canonical form and version are computed in
// the database (food_context_restrictions / food_context_version), so they are only compared here.
import { readMenuProfile } from "./prompt";
import type { MenuProfile } from "./validation";

export type FoodRestrictions = {
  dietaryRestrictions: string[];
  allergies: string[];
  otherAllergies: string;
  dislikedFoods: string[];
};

// The caller's saved profile now. found: false when there is no profile.
export type CurrentFoodContext =
  | { found: false }
  | {
      found: true;
      householdSize: number;
      restrictions: FoodRestrictions;
      version: string;
      preferences: { goals: string[]; otherGoal: string; weeklyTrainingDays: number; trainingTypes: string[] };
    };

// What one week was planned with, frozen when its menu was applied.
export type FrozenFoodContext = {
  servings: number;
  servingsSource: "generation" | "profile" | "default";
  householdSize: number | null;
  // null: there was no profile when the week was frozen (nothing known about allergies).
  restrictions: FoodRestrictions | null;
  version: string;
  frozenAt: string;
};

export type WeekFoodContextStatus = {
  week: boolean;
  // null: a week applied before C1 (or whose freeze never arrived).
  frozen: FrozenFoodContext | null;
  current: CurrentFoodContext;
  restrictionsChanged: boolean;
  householdChanged: boolean;
};

// Added to the /api/generate-menu response (servings used) and /api/substitute-dish (servings null).
export type VerifiedFoodContext = FoodRestrictions & { servings: number | null; version: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : null);

function parseRestrictions(value: unknown): FoodRestrictions | null {
  if (!isRecord(value)) return null;
  const dietaryRestrictions = strings(value.dietaryRestrictions);
  const allergies = strings(value.allergies);
  const dislikedFoods = strings(value.dislikedFoods);
  if (!dietaryRestrictions || !allergies || !dislikedFoods || typeof value.otherAllergies !== "string") return null;
  return { dietaryRestrictions, allergies, otherAllergies: value.otherAllergies, dislikedFoods };
}

export function parseCurrentFoodContext(value: unknown): CurrentFoodContext {
  if (!isRecord(value) || typeof value.found !== "boolean") throw new Error("invalid_food_context");
  if (!value.found) return { found: false };
  const restrictions = parseRestrictions(value.restrictions);
  const preferences = isRecord(value.preferences) ? value.preferences : {};
  if (!restrictions || typeof value.version !== "string" || !Number.isInteger(value.householdSize)) {
    throw new Error("invalid_food_context");
  }
  return {
    found: true,
    householdSize: value.householdSize as number,
    restrictions,
    version: value.version,
    preferences: {
      goals: strings(preferences.goals) ?? [],
      otherGoal: typeof preferences.otherGoal === "string" ? preferences.otherGoal : "",
      weeklyTrainingDays: typeof preferences.weeklyTrainingDays === "number" ? preferences.weeklyTrainingDays : 0,
      trainingTypes: strings(preferences.trainingTypes) ?? [],
    },
  };
}

function parseFrozen(value: unknown): FrozenFoodContext | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || !Number.isInteger(value.servings) || typeof value.version !== "string") {
    throw new Error("invalid_week_food_context");
  }
  const source = value.servingsSource;
  return {
    servings: value.servings as number,
    servingsSource: source === "generation" || source === "profile" ? source : "default",
    householdSize: Number.isInteger(value.householdSize) ? (value.householdSize as number) : null,
    restrictions: value.restrictions === null ? null : parseRestrictions(value.restrictions),
    version: value.version,
    frozenAt: typeof value.frozenAt === "string" ? value.frozenAt : "",
  };
}

export function parseWeekFoodContextStatus(value: unknown): WeekFoodContextStatus {
  if (!isRecord(value)) throw new Error("invalid_week_food_context");
  return {
    week: value.week === true,
    frozen: parseFrozen(value.frozen),
    current: parseCurrentFoodContext(value.current ?? { found: false }),
    restrictionsChanged: value.restrictionsChanged === true,
    householdChanged: value.householdChanged === true,
  };
}

// The foodContext of a response (or of a stored proposal): null when absent or malformed, so a
// caller never shows or checks against a context the server did not return.
export function parseVerifiedFoodContext(value: unknown): VerifiedFoodContext | null {
  if (!isRecord(value) || typeof value.version !== "string") return null;
  const restrictions = parseRestrictions(value);
  if (!restrictions) return null;
  const servings = Number.isInteger(value.servings) ? (value.servings as number) : null;
  return { servings, ...restrictions, version: value.version };
}

export function menuProfileFromContext(context: Extract<CurrentFoodContext, { found: true }>): MenuProfile {
  return readMenuProfile({ ...context.restrictions, ...context.preferences });
}

export function verifiedFoodContext(context: Extract<CurrentFoodContext, { found: true }>, servings: number | null): VerifiedFoodContext {
  return { servings, ...context.restrictions, version: context.version };
}

const peopleLabel = (count: number) => `${count} ${count === 1 ? "persona" : "personas"}`;

// Notice for the week page when the profile changed after the week was planned. Only states what
// changed: it never claims the dishes are (or are not) compatible with the new profile.
export function foodContextChangeNotice(status: WeekFoodContextStatus | null): { title: string; lines: string[] } | null {
  if (!status?.week || !status.frozen) return null;
  const lines: string[] = [];
  if (status.restrictionsChanged) {
    lines.push(
      status.current.found
        ? "Tus restricciones, alergias o alimentos que no te gustan han cambiado después de planificar esta semana. Los platos se eligieron con los datos anteriores."
        : "Esta semana se planificó con un perfil que ya no está en tu cuenta.",
    );
  }
  if (status.householdChanged && status.current.found) {
    lines.push(
      `Ahora tu hogar es de ${peopleLabel(status.current.householdSize)}; esta semana está planificada para ${peopleLabel(status.frozen.servings)} y su lista de la compra también.`,
    );
  }
  return lines.length ? { title: "Tu perfil cambió después de planificar esta semana", lines } : null;
}
