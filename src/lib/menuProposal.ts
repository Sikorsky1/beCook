// A proposed or imported menu not applied yet (B5, roadmap step 11). It is kept on this device,
// per identity and week, until it is saved: reloading Crear menú, leaving the page or a failed
// save never loses it, and applying it again never needs another AI call. Its attempt (request
// key and the «reemplazar» answer) is kept too, so a retry is the same write.
import type { ApplyWeekAttempt } from "@/lib/applyWeek";
import { activeGenerationRun } from "@/lib/createMenuDraft";
import type { DataIdentity } from "@/lib/data/repositories";
import { isImportedMenuResponse, type ImportedMenuResponse } from "@/lib/importMenu";
import { getIsoWeekStorageId, type IsoWeek } from "@/lib/isoWeek";
import { parseVerifiedFoodContext } from "@/lib/menu-generation/food-context";
import { readEnvelope, removeScoped, writeScoped } from "@/lib/storage/scoped-storage";

export type MenuProposal = {
  menu: ImportedMenuResponse;
  generationRequestId: string | null;
  // The last «Usar este menú» attempt of this proposal, if any.
  attempt: Omit<ApplyWeekAttempt<unknown>, "menu" | "week"> | null;
  // C6: where it came from, who ordered a pasted menu, the food context version the server used to
  // generate it (C1, foodContext.version; null for imported menus) and when it was made.
  source: "import" | "generate";
  parsedBy: "local" | "ai" | null;
  contextVersion: string | null;
  createdAt: string;
};

// A new proposal on screen, described from the menu itself.
export function describeProposal(
  menu: ImportedMenuResponse,
  source: MenuProposal["source"],
  now = new Date(),
): Pick<MenuProposal, "source" | "parsedBy" | "contextVersion" | "createdAt"> {
  return {
    source,
    parsedBy: source === "import" ? (menu.parsedBy ?? null) : null,
    contextVersion: parseVerifiedFoodContext((menu as { foodContext?: unknown }).foodContext)?.version ?? null,
    createdAt: now.toISOString(),
  };
}

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
  const envelope = readEnvelope<Record<string, unknown>>(identity.scope, "menu-proposal", getIsoWeekStorageId(isoWeek));
  const stored = envelope?.data;
  if (!stored || typeof stored !== "object" || !isImportedMenuResponse(stored.menu) || !stored.menu.days.length) return null;
  // Proposals stored before C6 have no description: a generated one carries its food context.
  const described = describeProposal(stored.menu, parseVerifiedFoodContext((stored.menu as { foodContext?: unknown }).foodContext) ? "generate" : "import");
  return {
    menu: stored.menu,
    generationRequestId: typeof stored.generationRequestId === "string" ? stored.generationRequestId : null,
    attempt: parseAttempt(stored.attempt),
    source: stored.source === "import" || stored.source === "generate" ? stored.source : described.source,
    parsedBy: stored.parsedBy === "local" || stored.parsedBy === "ai" ? stored.parsedBy : stored.source ? null : described.parsedBy,
    contextVersion:
      typeof stored.contextVersion === "string" || stored.contextVersion === null
        ? (stored.contextVersion as string | null)
        : described.contextVersion,
    createdAt: typeof stored.createdAt === "string" ? stored.createdAt : envelope.savedAt,
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

// C6: whether «Usar este menú» can go ahead now. Refused while another generation runs for this
// identity and week (its proposal would replace this one); a generated proposal made with a food
// context other than the current one asks first (decision 3: warn and confirm, never block).
// currentContextVersion null: not known (guest, or the account could not be read): nothing to compare.
export type ProposalUseCheck = { status: "ok" } | { status: "generation_running" } | { status: "context_changed" };

export function checkProposalUse({
  scope,
  week,
  proposal,
  currentContextVersion,
  contextChangeConfirmed = false,
}: {
  scope: string;
  week: string;
  proposal: Pick<MenuProposal, "source" | "contextVersion">;
  currentContextVersion: string | null;
  contextChangeConfirmed?: boolean;
}): ProposalUseCheck {
  if (activeGenerationRun(scope, week)) return { status: "generation_running" };
  if (
    !contextChangeConfirmed &&
    proposal.source === "generate" &&
    proposal.contextVersion &&
    currentContextVersion &&
    proposal.contextVersion !== currentContextVersion
  ) {
    return { status: "context_changed" };
  }
  return { status: "ok" };
}
