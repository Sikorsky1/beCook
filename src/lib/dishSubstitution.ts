import type { WeekDay } from "@/data/mockWeek";
import { isAiLoginRequiredError, postAi } from "@/lib/ai-client";
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
    const response = await postAi("/api/substitute-dish", { profile: menuProfile, ...request }, signal);
    const data = (await response.json().catch(() => null)) as (Partial<SubstituteDishResponse> & { error?: string }) | null;

    if (!response.ok || !data || typeof data.dish !== "string") {
      return {
        status: "error",
        message: data?.error ?? "No se ha podido proponer otro plato.",
        limit: response.status === 429 || response.status === 503,
      };
    }

    // Defence in depth: the browser checks the idea against its own copy of the week.
    if (checkReplacement(data.dish, request, menuProfile)) {
      return { status: "error", message: "La propuesta no encaja con tu perfil o con el resto de la semana. Inténtalo de nuevo." };
    }

    return { status: "found", dish: data.dish, source: data.source === "catalog" ? "catalog" : "ai" };
  } catch (error) {
    if (isAiLoginRequiredError(error)) return { status: "login_required" };
    return { status: "error", message: "Sin conexión. Inténtalo de nuevo." };
  }
}
