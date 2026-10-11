import type { WeekDay } from "@/data/mockWeek";
import { isAiLoginRequiredError, postAi } from "@/lib/ai-client";
import type { ImportedMenuResponse } from "@/lib/importMenu";
import { parseVerifiedFoodContext, type VerifiedFoodContext } from "@/lib/menu-generation/food-context";
import { readMenuProfile } from "@/lib/menu-generation/prompt";
import {
  catalogAlternative,
  checkReplacement,
  substitutionRequestFor,
  type SubstituteDishResponse,
  type SubstitutionSlot,
} from "@/lib/menu-generation/substitution";

// «Otra idea» for one meal of a saved week (step 21). The idea only fills the editor:
// saving it goes through the usual single-slot write (update_week_slot, B4).
// In the preview of Crear menú (step 28) the idea replaces the dish of the proposal directly:
// nothing is saved until «Usar este menú».

export type DishIdea =
  | { status: "found"; dish: string; source: SubstituteDishResponse["source"] }
  // The reviewed catalogue has no compatible recipe left; an AI idea counts as one menu.
  | { status: "catalog_exhausted" }
  | { status: "login_required" }
  | { status: "error"; message: string; limit?: boolean };

const invalidProfileMessage = "Revisa las alergias y restricciones de tu perfil antes de pedir otra idea.";

function readProfile(profile: unknown) {
  try {
    return readMenuProfile(profile);
  } catch {
    return null;
  }
}

// Ideas for a generated proposal (C1 + D3): the restrictions the server used for it plus the
// profile this page has loaded, if any. A profile changed after generating can only add
// restrictions here, never drop the ones the proposal was checked against.
export function proposalIdeaProfile(verified: VerifiedFoodContext | null, profile: unknown): unknown {
  if (!verified) return profile;
  if (profile === null || profile === undefined) return verified;
  const local = readProfile(profile);
  if (!local) return profile; // Malformed: requestProposalIdea refuses it, as before.
  const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
  return {
    ...local,
    dietaryRestrictions: union(verified.dietaryRestrictions, local.dietaryRestrictions),
    allergies: union(verified.allergies, local.allergies),
    otherAllergies: [verified.otherAllergies, local.otherAllergies].filter((text) => text.trim()).join(", "),
    dislikedFoods: union(verified.dislikedFoods, local.dislikedFoods),
  };
}

// Free and local: the next compatible reviewed recipe, or «catalog_exhausted».
export function nextCatalogIdea(weekDays: WeekDay[], slot: SubstitutionSlot, rejected: string[], profile: unknown): DishIdea {
  const menuProfile = readProfile(profile);
  if (!menuProfile) return { status: "error", message: invalidProfileMessage };
  const idea = catalogAlternative(substitutionRequestFor(weekDays, slot, rejected), menuProfile);
  return idea ? { status: "found", dish: idea.dish, source: "catalog" } : { status: "catalog_exhausted" };
}

// One bounded AI attempt (only after the catalogue is exhausted and the user asked for it).
export async function requestAiIdea(
  weekDays: WeekDay[],
  slot: SubstitutionSlot,
  rejected: string[],
  profile: unknown,
  signal?: AbortSignal,
): Promise<DishIdea> {
  const menuProfile = readProfile(profile);
  if (!menuProfile) return { status: "error", message: invalidProfileMessage };
  const request = substitutionRequestFor(weekDays, slot, rejected);

  try {
    // The server reads the profile of the account (C1); the body carries only the week.
    const response = await postAi("/api/substitute-dish", request, signal);
    const data = (await response.json().catch(() => null)) as
      | (Partial<SubstituteDishResponse> & { error?: string; foodContext?: unknown })
      | null;

    if (!response.ok || !data || typeof data.dish !== "string") {
      return {
        status: "error",
        message: data?.error ?? "No se ha podido proponer otro plato.",
        limit: response.status === 429 || response.status === 503,
      };
    }

    // Defence in depth: the browser checks the idea against its own copy of the week, with the
    // profile it was given and with the context the server says it used.
    const serverContext = parseVerifiedFoodContext(data.foodContext);
    const serverProfile = serverContext ? readProfile(serverContext) : null;
    if (
      checkReplacement(data.dish, request, menuProfile) ||
      (serverProfile && checkReplacement(data.dish, request, serverProfile))
    ) {
      return { status: "error", message: "La propuesta no encaja con tu perfil o con el resto de la semana. Inténtalo de nuevo." };
    }

    return { status: "found", dish: data.dish, source: data.source === "catalog" ? "catalog" : "ai" };
  } catch (error) {
    if (isAiLoginRequiredError(error)) return { status: "login_required" };
    return { status: "error", message: "Sin conexión. Inténtalo de nuevo." };
  }
}

// Preview of Crear menú (step 28): the reviewed catalogue first, free; the AI only when the user
// asks after the catalogue runs out, and never for a guest.
export function requestProposalIdea(
  weekDays: WeekDay[],
  slot: SubstitutionSlot,
  rejected: string[],
  profile: unknown,
  mode: "catalog" | "ai",
  isSignedIn: boolean,
  signal?: AbortSignal,
): DishIdea | Promise<DishIdea> {
  if (mode === "catalog") {
    const result = nextCatalogIdea(weekDays, slot, rejected, profile);
    return result.status === "catalog_exhausted" && !isSignedIn ? { status: "login_required" } : result;
  }
  return isSignedIn ? requestAiIdea(weekDays, slot, rejected, profile, signal) : { status: "login_required" };
}

// The proposal with exactly one dish changed; every other day and meal (and the rest of the
// response) stays as it was. A free meal is never filled.
export function replaceProposalDish<Menu extends ImportedMenuResponse>(menu: Menu, slot: SubstitutionSlot, dish: string): Menu {
  return {
    ...menu,
    days: menu.days.map((day) =>
      day.dayName === slot.day && day[slot.meal].status === "planned"
        ? { ...day, [slot.meal]: { status: "planned", dishName: dish } }
        : day,
    ),
  };
}
