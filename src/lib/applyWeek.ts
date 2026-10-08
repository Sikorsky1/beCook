// «Usar este menú» (B4): one request key per attempt, and a clear message for each result.
import type { SaveResult } from "@/lib/data/sync";

// An attempt is one menu applied to one week. Sending it again (after a network error, or a
// double click that slipped through) reuses its key, so the database applies it only once.
export type ApplyWeekAttempt<Menu> = {
  menu: Menu;
  week: string;
  requestKey: string;
  // The user already confirmed «reemplazar» for this attempt: do not ask again on a retry.
  overwrite: boolean | null;
  // Account version read when the attempt started (undefined: not read, e.g. guest).
  baseVersion?: string | null;
};

export function resolveApplyWeekAttempt<Menu>(
  previous: ApplyWeekAttempt<Menu> | null,
  menu: Menu,
  week: string,
  newKey: () => string,
): ApplyWeekAttempt<Menu> {
  if (previous && previous.menu === menu && previous.week === week) return previous;
  return { menu, week, requestKey: newKey(), overwrite: null };
}

export type ApplyWeekOutcome = {
  status: "success" | "error";
  message: string;
  // keep: retry with the same key (the first try may have reached the server) · discard: new attempt.
  attempt: "keep" | "discard";
};

export const applyWeekMessages = {
  applied: "Tu semana se ha actualizado correctamente.",
  duplicate: "Este menú ya estaba aplicado a tu semana.",
  conflict:
    "Otro dispositivo acaba de guardar un menú para esta semana. Pulsa «Usar este menú» otra vez si quieres reemplazarlo.",
  pending: "No hemos podido guardar el menú en tu cuenta. Revisa la conexión e inténtalo de nuevo.",
  unchecked: "No hemos podido comprobar tu semana. Revisa la conexión e inténtalo de nuevo.",
} as const;

export function applyWeekOutcome(result: SaveResult<unknown>): ApplyWeekOutcome {
  switch (result.status) {
    case "local":
      return { status: "success", message: applyWeekMessages.applied, attempt: "discard" };
    case "synced":
      return {
        status: "success",
        message: result.duplicate ? applyWeekMessages.duplicate : applyWeekMessages.applied,
        attempt: "discard",
      };
    case "conflict":
      // Nothing was written; the account week is now cached. A new click asks again.
      return { status: "error", message: applyWeekMessages.conflict, attempt: "discard" };
    case "pending":
      return { status: "error", message: applyWeekMessages.pending, attempt: "keep" };
  }
}
