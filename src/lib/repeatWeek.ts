// Step 32: «Repetir la semana N» from an empty week. The previous week's dishes and their cards
// are copied with the usual «Usar este menú» write (applyMenuToWeek/saveWeek, unchanged):
// - no generation request, so the week's food context is frozen from the current profile, as for
//   an imported menu (decision 7 of wave 7);
// - the shopping list is not prepared here: Compra prepares it when it is opened;
// - a week that already has a menu (another device or tab) is never replaced.
import type { WeekDay } from "@/data/mockWeek";
import { applyMenuToWeek, applyWeekMessages, type ApplyWeekAttempt } from "@/lib/applyWeek";
import type { DataIdentity } from "@/lib/data/repositories";
import type { IsoWeek } from "@/lib/isoWeek";
import { withWeekDates } from "@/lib/weekStorage";

// Worth repeating: at least one planned meal (a week of «LIBRE» is not offered).
export function hasPlannedMeals(days: WeekDay[] | null | undefined): days is WeekDay[] {
  return Boolean(days?.some((day) => day.lunch !== "LIBRE" || day.dinner !== "LIBRE"));
}

// Same days, dishes and cards, dated in the target week. Only the fields of a week day are kept.
export function repeatWeekDays(previous: WeekDay[], target: IsoWeek): WeekDay[] {
  return withWeekDates(
    previous.map((day) => ({
      day: day.day,
      date: "",
      lunch: day.lunch,
      dinner: day.dinner,
      ...(day.lunchRecipe ? { lunchRecipe: { versionId: day.lunchRecipe.versionId } } : {}),
      ...(day.dinnerRecipe ? { dinnerRecipe: { versionId: day.dinnerRecipe.versionId } } : {}),
    })),
    target,
  );
}

export type RepeatWeekResult = {
  // copied: saved (account or this device) · pending: on this device, not confirmed yet ·
  // existing: the week already had a menu, nothing written · error: nothing saved, try again.
  status: "copied" | "pending" | "existing" | "error";
  message: string;
  // keep: «Repetir» again resends the same attempt (same request key, never twice).
  attempt: "keep" | "discard";
  // The week may have changed: read it again.
  reload: boolean;
};

export const repeatWeekMessages = {
  account: (label: string) =>
    `Hemos copiado la semana ${label}. La lista de la compra se prepara cuando abras Compra.`,
  device: (label: string) =>
    `Hemos copiado la semana ${label} en este dispositivo. La lista de la compra se prepara cuando abras Compra.`,
  pending:
    "Solo en este dispositivo: tu cuenta no ha confirmado la copia. Pulsa «Reintentar» en el estado de guardado; no se duplica.",
  existing: "Esta semana ya tiene un menú guardado desde otro dispositivo o pestaña. No hemos cambiado nada.",
  unchecked: applyWeekMessages.unchecked,
  failed: "No hemos podido copiar la semana. Inténtalo de nuevo.",
} as const;

export async function repeatPreviousWeek({
  identity,
  isoWeek,
  previousWeek,
  previousDays,
  attempt,
}: {
  identity: DataIdentity;
  isoWeek: IsoWeek;
  previousWeek: IsoWeek;
  previousDays: WeekDay[];
  attempt: ApplyWeekAttempt<WeekDay[]>;
}): Promise<RepeatWeekResult> {
  const label = String(previousWeek.isoWeek);
  try {
    const { outcome } = await applyMenuToWeek({
      identity,
      isoWeek,
      weekDays: repeatWeekDays(previousDays, isoWeek),
      attempt,
      generationRequestId: null,
      // Repeating only fills an empty week: an existing menu is kept and shown.
      confirmReplace: () => false,
      // Compra prepares the list when it is opened.
      prepareShopping: async () => ({ status: "deferred" }),
    });

    switch (outcome.menu) {
      case "account":
        return { status: "copied", message: repeatWeekMessages.account(label), attempt: "discard", reload: true };
      case "device":
        return { status: "copied", message: repeatWeekMessages.device(label), attempt: "discard", reload: true };
      case "pending":
        return { status: "pending", message: repeatWeekMessages.pending, attempt: "keep", reload: true };
      case "conflict":
      case "cancelled":
        return { status: "existing", message: repeatWeekMessages.existing, attempt: "discard", reload: true };
      case "unchecked":
        return { status: "error", message: repeatWeekMessages.unchecked, attempt: "keep", reload: false };
    }
  } catch {
    return { status: "error", message: repeatWeekMessages.failed, attempt: "keep", reload: false };
  }
}
