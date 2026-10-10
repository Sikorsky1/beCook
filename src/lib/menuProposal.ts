// A proposed or imported menu not applied yet (B5, roadmap step 11). It is kept on this device,
// per identity and week, until it is saved: reloading Crear menú, leaving the page or a failed
// save never loses it, and applying it again never needs another AI call. Its attempt (request
// key and the «reemplazar» answer) is kept too, so a retry is the same write.
import type { ApplyWeekAttempt } from "@/lib/applyWeek";
import type { DataIdentity } from "@/lib/data/repositories";
import { isImportedMenuResponse, type ImportedMenuResponse } from "@/lib/importMenu";
import { getIsoWeekStorageId, type IsoWeek } from "@/lib/isoWeek";
import { readScoped, removeScoped, writeScoped } from "@/lib/storage/scoped-storage";

export type MenuProposal = {
  menu: ImportedMenuResponse;
  generationRequestId: string | null;
  // The last «Usar este menú» attempt of this proposal, if any.
  attempt: Omit<ApplyWeekAttempt<unknown>, "menu" | "week"> | null;
};

function parseAttempt(value: unknown): MenuProposal["attempt"] {
  if (!value || typeof value !== "object") return null;
  const attempt = value as Record<string, unknown>;
  if (typeof attempt.requestKey !== "string" || !attempt.requestKey) return null;
  const overwrite = typeof attempt.overwrite === "boolean" ? attempt.overwrite : null;
  const baseVersion =
    typeof attempt.baseVersion === "string" || attempt.baseVersion === null ? attempt.baseVersion : undefined;
  return { requestKey: attempt.requestKey, overwrite, ...(baseVersion !== undefined ? { baseVersion } : {}) };
}

export function readMenuProposal(identity: DataIdentity, isoWeek: IsoWeek): MenuProposal | null {
  const stored = readScoped<Record<string, unknown>>(identity.scope, "menu-proposal", getIsoWeekStorageId(isoWeek));
  if (!stored || !isImportedMenuResponse(stored.menu) || !stored.menu.days.length) return null;
  return {
    menu: stored.menu,
    generationRequestId: typeof stored.generationRequestId === "string" ? stored.generationRequestId : null,
    attempt: parseAttempt(stored.attempt),
  };
}

export function writeMenuProposal(identity: DataIdentity, isoWeek: IsoWeek, proposal: MenuProposal) {
  writeScoped(identity.scope, "menu-proposal", proposal, { week: getIsoWeekStorageId(isoWeek) });
}

export function clearMenuProposal(identity: DataIdentity, isoWeek: IsoWeek) {
  removeScoped(identity.scope, "menu-proposal", getIsoWeekStorageId(isoWeek));
}

// The attempt of a restored proposal, tied to the restored menu object (attempts match by identity).
export function attemptFromProposal<Menu>(
  proposal: MenuProposal,
  menu: Menu,
  week: string,
): ApplyWeekAttempt<Menu> | null {
  return proposal.attempt ? { ...proposal.attempt, menu, week } : null;
}
