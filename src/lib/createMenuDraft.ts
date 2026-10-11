// Keeps the create-menu form while a guest goes to /login and comes back.
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

export function consumeCreateMenuDraft(): CreateMenuDraft | null {
  try {
    const raw = window.sessionStorage.getItem(CREATE_MENU_DRAFT_KEY);
    window.sessionStorage.removeItem(CREATE_MENU_DRAFT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<CreateMenuDraft>;
    if (value.mode !== "import" && value.mode !== "generate") return null;
    return {
      mode: value.mode,
      menuText: typeof value.menuText === "string" ? value.menuText : "",
      freeTextPrompt: typeof value.freeTextPrompt === "string" ? value.freeTextPrompt : "",
      peopleCount: typeof value.peopleCount === "number" ? value.peopleCount : 2,
      menuStyles: Array.isArray(value.menuStyles)
        ? value.menuStyles.filter((style): style is string => typeof style === "string")
        : [],
      elaborationLevel: typeof value.elaborationLevel === "number" ? value.elaborationLevel : 4,
    };
  } catch {
    return null;
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
  | { status: "error"; message: string; limit: boolean; profileRequired?: boolean }
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
