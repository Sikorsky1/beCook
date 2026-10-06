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
