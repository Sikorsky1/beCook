import type { DataIdentity } from "@/lib/data/repositories";
import { getIsoWeekStorageId, parseIsoWeekId, type IsoWeek } from "@/lib/isoWeek";
import { listScopedWeeks, readEnvelope, removeScoped, writeScoped } from "@/lib/storage/scoped-storage";

// Keeps the create-menu form while a guest goes to /login and comes back. Unscoped on purpose:
// the form must cross from the guest to the account that signs in (see data-sync.md).
const CREATE_MENU_DRAFT_KEY = "becook-create-menu-draft";

export type CreateMenuDraft = {
  mode: "import" | "generate";
  menuText: string;
  freeTextPrompt: string;
  peopleCount: number;
  menuStyles: string[];
  elaborationLevel: number;
};

export function saveCreateMenuDraft(draft: CreateMenuDraft) {
  try {
    window.sessionStorage.setItem(CREATE_MENU_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage unavailable: the guest only loses the unsent form.
  }
}

function parseCreateMenuDraft(value: unknown): CreateMenuDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<CreateMenuDraft>;
  if (draft.mode !== "import" && draft.mode !== "generate") return null;
  return {
    mode: draft.mode,
    menuText: typeof draft.menuText === "string" ? draft.menuText : "",
    freeTextPrompt: typeof draft.freeTextPrompt === "string" ? draft.freeTextPrompt : "",
    peopleCount: typeof draft.peopleCount === "number" ? draft.peopleCount : 2,
    menuStyles: Array.isArray(draft.menuStyles)
      ? draft.menuStyles.filter((style): style is string => typeof style === "string")
      : [],
    elaborationLevel: typeof draft.elaborationLevel === "number" ? draft.elaborationLevel : 4,
  };
}

export function consumeCreateMenuDraft(): CreateMenuDraft | null {
  try {
    const raw = window.sessionStorage.getItem(CREATE_MENU_DRAFT_KEY);
    window.sessionStorage.removeItem(CREATE_MENU_DRAFT_KEY);
    if (!raw) return null;
    return parseCreateMenuDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

// --- The form on this device, per identity and week (C6, step 22) -----------------------------
// What the user typed or pasted for a week is kept on the device under their identity scope
// (becook:<scope>:menu-draft:YYYY-Www), so leaving the page or reloading never loses it, and no
// other account, the guest or another week ever sees it. Removed when that week's menu is saved,
// on sign-out with the rest of the scope, and once the week is past.
export function readMenuFormDraft(identity: DataIdentity, isoWeek: IsoWeek): CreateMenuDraft | null {
  try {
    return parseCreateMenuDraft(readEnvelope(identity.scope, "menu-draft", getIsoWeekStorageId(isoWeek))?.data);
  } catch {
    return null;
  }
}

export function writeMenuFormDraft(identity: DataIdentity, isoWeek: IsoWeek, draft: CreateMenuDraft) {
  try {
    writeScoped(identity.scope, "menu-draft", draft, { week: getIsoWeekStorageId(isoWeek) });
  } catch {
    // Storage full or unavailable: only the unsent form is at stake.
  }
}

export function clearMenuFormDraft(identity: DataIdentity, isoWeek: IsoWeek) {
  try {
    removeScoped(identity.scope, "menu-draft", getIsoWeekStorageId(isoWeek));
  } catch {
    // Nothing to clear.
  }
}

// Decision 10 of the plan: drafts and unapplied proposals of past weeks are dropped when Crear menú
// loads (only for the identity on screen). The week on screen is never dropped, even if it is a
// past one chosen with ?week=: the user is working on it.
export function pruneStaleMenuDrafts(identity: DataIdentity, currentWeek: IsoWeek, selectedWeek?: IsoWeek) {
  const keep = selectedWeek ? getIsoWeekStorageId(selectedWeek) : null;
  try {
    for (const entity of ["menu-draft", "menu-proposal"] as const) {
      for (const weekId of listScopedWeeks(identity.scope, entity)) {
        if (weekId === keep) continue;
        const parsed = parseIsoWeekId(weekId);
        const past =
          !parsed.ok ||
          parsed.week.isoYear < currentWeek.isoYear ||
          (parsed.week.isoYear === currentWeek.isoYear && parsed.week.isoWeek < currentWeek.isoWeek);
        if (past) removeScoped(identity.scope, entity, weekId);
      }
    }
  } catch {
    // Storage unavailable: nothing stored to prune.
  }
}

// --- A generation in progress (D3, step 27) ----------------------------------------------------
// The request keeps running if the user moves to another page of the app: coming back to Crear
// menú shows it still in progress (same start time, same «Cancelar») and its proposal when it
// arrives, because the proposal is stored as soon as it exists (menuProposal). A reload or a
// closed tab stops the request; the form is then restored and the interruption is said once.
const GENERATION_MARKER_KEY = "becook-create-menu-generating";

export type GenerationResult =
  | { status: "proposal" }
  // profileRequired: 409 without a saved profile (ola 4, M-3): not a failure, nothing to retry.
  // fixText: 400/422 of an import (C6): the pasted text must change; retrying it as is will not help.
  | { status: "error"; message: string; limit: boolean; profileRequired?: boolean; fixText?: boolean }
  | { status: "cancelled" }
  | { status: "login_required" };

export type GenerationRun = {
  scope: string;
  week: string;
  mode: "import" | "generate";
  startedAt: number;
  // The form it was started with: shown again if the user comes back while it runs.
  draft: CreateMenuDraft;
  controller: AbortController;
  done: Promise<GenerationResult>;
};

let activeRun: GenerationRun | null = null;

export function startGenerationRun(
  run: Omit<GenerationRun, "done" | "controller" | "draft">,
  draft: CreateMenuDraft,
): { run: GenerationRun; finish: (result: GenerationResult) => void } {
  let resolve: (result: GenerationResult) => void = () => {};
  const done = new Promise<GenerationResult>((settle) => {
    resolve = settle;
  });
  const current: GenerationRun = { ...run, draft, controller: new AbortController(), done };
  activeRun = current;
  try {
    window.sessionStorage.setItem(
      GENERATION_MARKER_KEY,
      JSON.stringify({ scope: run.scope, week: run.week, startedAt: run.startedAt, draft }),
    );
  } catch {
    // Storage unavailable: a reload just shows the empty form.
  }

  return {
    run: current,
    finish(result) {
      if (activeRun === current) {
        activeRun = null;
        try {
          window.sessionStorage.removeItem(GENERATION_MARKER_KEY);
        } catch {
          // Nothing to clear.
        }
      }
      resolve(result);
    },
  };
}

// The generation still running in this tab for this identity and week, if any.
export function activeGenerationRun(scope: string, week: string): GenerationRun | null {
  return activeRun && activeRun.scope === scope && activeRun.week === week ? activeRun : null;
}

// A generation this tab started and never finished (the page was reloaded or closed while it
// ran). Read once: returns the form it was started with.
export function consumeInterruptedGeneration(scope: string, week: string): CreateMenuDraft | null {
  if (activeRun) return null;
  try {
    const raw = window.sessionStorage.getItem(GENERATION_MARKER_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { scope?: unknown; week?: unknown; draft?: unknown };
    if (value.scope !== scope || value.week !== week) return null;
    window.sessionStorage.removeItem(GENERATION_MARKER_KEY);
    window.sessionStorage.setItem(CREATE_MENU_DRAFT_KEY, JSON.stringify(value.draft));
    return consumeCreateMenuDraft();
  } catch {
    return null;
  }
}
