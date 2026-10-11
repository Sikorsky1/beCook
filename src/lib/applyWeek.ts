// «Usar este menú» (B4, B5): one request key per attempt, separate results for the menu and its
// shopping list, and a clear message for each (roadmap step 11, audit H9).
// - The week opens as soon as the menu is saved; the shopping list is prepared apart and never
//   delays or hides the menu result.
// - «Guardado en tu cuenta» only after the account confirmed it. A menu the account did not
//   accept stays on this device as pending, and «Reintentar guardado» resends only that write
//   (same request key, no new AI call).
// D3 (step 26): replacing a menu is confirmed with the app's own dialog, which is shown the menu
// it replaces. Right after a replacement the previous menu can be restored for a short time
// (undoAppliedMenu): the same week write, checked against the version this attempt produced.
import type { WeekDay } from "@/data/mockWeek";
import { readCachedWeek, readRemoteWeek, saveWeek, type DataIdentity } from "@/lib/data/repositories";
import type { SaveResult } from "@/lib/data/sync";
import type { IsoWeek } from "@/lib/isoWeek";

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
  // The menu this attempt replaces, once the user confirmed it. Kept in memory only: a proposal
  // recovered after a reload can be applied again, but not undone.
  replaced?: WeekDay[] | null;
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

// Where the menu is after one attempt.
// account: confirmed by the account · device: guest, saved on this device only ·
// pending: on this device, the account did not answer (retry) · conflict: not saved, another
// device saved this week first · unchecked: the account week could not be read, nothing saved ·
// cancelled: the user kept the menu already in the account.
export type MenuSaveState = "account" | "device" | "pending" | "conflict" | "unchecked" | "cancelled";

export type ApplyWeekOutcome = {
  status: "success" | "error" | "idle";
  menu: MenuSaveState;
  message: string;
  // keep: retry with the same key (the first try may have reached the server) · discard: new attempt.
  attempt: "keep" | "discard";
  // Open the week now: the menu is saved (account or guest device). Never waits for shopping.
  openWeek: boolean;
};

export const applyWeekMessages = {
  applied: "Menú guardado en tu cuenta.",
  duplicate: "Este menú ya estaba guardado en tu cuenta.",
  device: "Menú guardado solo en este dispositivo. Inicia sesión para guardarlo en tu cuenta.",
  conflict:
    "Otro dispositivo acaba de guardar un menú para esta semana. Pulsa «Usar este menú» otra vez si quieres reemplazarlo.",
  pending:
    "Solo en este dispositivo: tu cuenta no ha confirmado el menú. Pulsa «Reintentar guardado»; no se vuelve a crear el menú.",
  unchecked: "No hemos podido comprobar tu semana. Revisa la conexión e inténtalo de nuevo.",
} as const;

export function applyWeekOutcome(result: SaveResult<unknown>): ApplyWeekOutcome {
  switch (result.status) {
    case "local":
      return { status: "success", menu: "device", message: applyWeekMessages.device, attempt: "discard", openWeek: true };
    case "synced":
      return {
        status: "success",
        menu: "account",
        message: result.duplicate ? applyWeekMessages.duplicate : applyWeekMessages.applied,
        attempt: "discard",
        openWeek: true,
      };
    case "conflict":
      // Nothing was written; the account week is now cached. A new click asks again.
      return { status: "error", menu: "conflict", message: applyWeekMessages.conflict, attempt: "discard", openWeek: false };
    case "pending":
      return { status: "error", menu: "pending", message: applyWeekMessages.pending, attempt: "keep", openWeek: false };
  }
}

// The shopping list of the week, prepared after the menu result is known.
// ready: the list exists (kept or generated) · failed: it could not be prepared now (the Compra
// page reads it again or generates it) · skipped: the menu is not in the account.
export type ShoppingPreparation = "ready" | "failed" | "skipped";

export type ApplyMenuResult = {
  outcome: ApplyWeekOutcome;
  // Resolves on its own; nothing waits for it before opening the week.
  shopping: Promise<ShoppingPreparation>;
  // The menu the saved one replaced, which «Deshacer» can restore. Null when the week was empty
  // (there is no earlier menu to go back to) or nothing was saved.
  replaced: WeekDay[] | null;
};

export type ApplyMenuInput<Menu> = {
  identity: DataIdentity;
  isoWeek: IsoWeek;
  weekDays: WeekDay[];
  attempt: ApplyWeekAttempt<Menu>;
  generationRequestId?: string | null;
  // Asked once per attempt when the week already has a menu (the account's, or this device's for
  // a guest). It receives that menu so the confirmation can show what is replaced.
  confirmReplace: (current: WeekDay[]) => boolean | Promise<boolean>;
  // Prepares the list (B6 ensureShoppingList). Called only once the account confirmed the menu.
  prepareShopping: (identity: DataIdentity, isoWeek: IsoWeek, weekDays: WeekDay[]) => Promise<{ status: string }>;
  // While the replacement can be undone the current list is left alone: undoing then needs no new
  // list and keeps its marks. Resolves true to prepare it, false when the menu was undone.
  holdShopping?: Promise<boolean>;
};

const skipped = Promise.resolve<ShoppingPreparation>("skipped");

export async function applyMenuToWeek<Menu>({
  identity,
  isoWeek,
  weekDays,
  attempt,
  generationRequestId,
  confirmReplace,
  prepareShopping,
  holdShopping,
}: ApplyMenuInput<Menu>): Promise<ApplyMenuResult> {
  if (!identity.userId && attempt.overwrite === null) {
    // A guest's week lives on this device: replacing it is confirmed the same way.
    const current = readCachedWeek(identity, isoWeek);
    if (current?.length && !(await confirmReplace(current))) {
      return {
        outcome: { status: "idle", menu: "cancelled", message: "", attempt: "discard", openWeek: false },
        shopping: skipped,
        replaced: null,
      };
    }
    attempt.overwrite = Boolean(current?.length);
    attempt.replaced = current?.length ? current : null;
  }

  if (identity.userId && attempt.overwrite === null) {
    // The account week as it is now: the save is checked against this version.
    let current: Awaited<ReturnType<typeof readRemoteWeek>>;
    try {
      current = await readRemoteWeek(identity, isoWeek);
    } catch {
      return {
        outcome: { status: "error", menu: "unchecked", message: applyWeekMessages.unchecked, attempt: "keep", openWeek: false },
        shopping: skipped,
        replaced: null,
      };
    }

    attempt.baseVersion = current.version;
    if (current.data?.length && !(await confirmReplace(current.data))) {
      return {
        outcome: { status: "idle", menu: "cancelled", message: "", attempt: "discard", openWeek: false },
        shopping: skipped,
        replaced: null,
      };
    }
    attempt.overwrite = Boolean(current.data?.length);
    attempt.replaced = current.data?.length ? current.data : null;
  }

  // Overwrite only after «reemplazar»; otherwise the database refuses it if another device saved
  // this week since it was read (conflict).
  const result = await saveWeek(identity, isoWeek, weekDays, {
    generationRequestId,
    overwrite: attempt.overwrite === true,
    requestKey: attempt.requestKey,
    baseVersion: attempt.baseVersion,
  });
  const outcome = applyWeekOutcome(result);

  // Only a menu the account has gets its list now: a pending menu could still be refused, and a
  // guest cannot call the AI. Kept if its dishes did not change, otherwise generated once (B6).
  const prepare = () =>
    prepareShopping(identity, isoWeek, weekDays).then(
      (loaded): ShoppingPreparation => (loaded.status === "ready" ? "ready" : "failed"),
      (): ShoppingPreparation => "failed",
    );
  const shopping: Promise<ShoppingPreparation> =
    outcome.menu !== "account"
      ? skipped
      : holdShopping
        ? holdShopping.then((go) => (go ? prepare() : "skipped"), () => prepare())
        : prepare();

  return { outcome, shopping, replaced: outcome.openWeek ? (attempt.replaced ?? null) : null };
}

// --- «Deshacer» (step 26) --------------------------------------------------------------------
// Offered for a short time after a replacement, and only while this page knows the replaced
// menu. It writes that menu back with the usual week write, checked against the version the
// replacement produced: if the week changed since (another device, another tab), nothing is
// written. Restores the dishes of every day; the shopping list stays as it was if it had not been
// prepared again yet (holdShopping), otherwise a list for the restored menu is prepared later.
export const undoWindowMs = 10_000;

export type UndoAttempt = { previous: WeekDay[]; requestKey: string };

export type UndoOutcome = {
  // restored: the account (or a guest's device) has the previous menu again · pending: sent but
  // not confirmed, retry with the same key · conflict: the week changed, nothing was undone.
  status: "restored" | "pending" | "conflict";
  message: string;
};

export const undoMessages = {
  restored: "Hemos vuelto a tu menú anterior.",
  device: "Hemos vuelto a tu menú anterior en este dispositivo.",
  pending: "Tu cuenta no ha confirmado la vuelta al menú anterior. Pulsa «Deshacer» otra vez; no se repite el cambio.",
  conflict: "No se ha deshecho: la semana ha cambiado desde otro dispositivo o pestaña. Revisa la semana antes de cambiar nada.",
} as const;

export async function undoAppliedMenu(identity: DataIdentity, isoWeek: IsoWeek, undo: UndoAttempt): Promise<UndoOutcome> {
  // No overwrite and no explicit base: the device copy carries the version of the replacement.
  const result = await saveWeek(identity, isoWeek, undo.previous, { requestKey: undo.requestKey });
  switch (result.status) {
    case "local":
      return { status: "restored", message: undoMessages.device };
    case "synced":
      return { status: "restored", message: undoMessages.restored };
    case "pending":
      return { status: "pending", message: undoMessages.pending };
    case "conflict":
      return { status: "conflict", message: undoMessages.conflict };
  }
}
