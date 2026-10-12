// Onboarding (roadmap step 25): what beCook is → household, goals and restrictions → optional
// express pantry, then Crear menú. Progress lives in the account (public.onboarding_progress) so
// it resumes on another device; accounts that existed before it are never sent through it.
import type { PantryCategory } from "@/lib/pantryStorage";
import type { ProfileConfirmation } from "@/lib/supabase/profiles";

export type OnboardingStep = "about" | "profile" | "pantry" | "done";
export type ActiveOnboardingStep = Exclude<OnboardingStep, "done">;

export const onboardingSteps: OnboardingStep[] = ["about", "profile", "pantry", "done"];
export const activeOnboardingSteps: ActiveOnboardingStep[] = ["about", "profile", "pantry"];

export const onboardingPath = "/onboarding";
// Where the onboarding ends: the first proposal is generated and confirmed there.
export const onboardingFinishPath = "/create-menu?from=onboarding";

export type OnboardingProgress = { step: OnboardingStep; completedAt: string | null };

export type OnboardingAccount = {
  progress: OnboardingProgress | null;
  // Any profile row, and the sections it has confirmed.
  hasProfile: boolean;
  confirmedSections: ProfileConfirmation[];
  hasWeeks: boolean;
};

export type OnboardingStatus =
  // An account from before the onboarding (profile or menus, no progress row): left alone.
  | { kind: "existing" }
  | { kind: "done" }
  // isNew: nothing saved yet, the progress row still has to be created.
  | { kind: "active"; step: ActiveOnboardingStep; isNew: boolean };

const menuConfirmations: ProfileConfirmation[] = ["household", "goals", "restrictions", "allergies"];

export function stepIndex(step: OnboardingStep) {
  return onboardingSteps.indexOf(step);
}

export function laterStep<T extends OnboardingStep>(first: T, second: T): T {
  return stepIndex(second) > stepIndex(first) ? second : first;
}

export function isMenuProfileConfirmed(confirmed: ProfileConfirmation[]) {
  return menuConfirmations.every((value) => confirmed.includes(value));
}

export function onboardingStatus(account: OnboardingAccount): OnboardingStatus {
  const { progress } = account;

  if (progress?.step === "done") {
    return { kind: "done" };
  }

  if (progress) {
    // The profile step may have been saved without its progress (lost answer): skip it.
    const fromProfile: ActiveOnboardingStep = isMenuProfileConfirmed(account.confirmedSections)
      ? "pantry"
      : progress.step;

    return { kind: "active", step: laterStep(progress.step, fromProfile), isNew: false };
  }

  if (account.hasProfile || account.hasWeeks) {
    return { kind: "existing" };
  }

  return { kind: "active", step: "about", isNew: true };
}

export function nextOnboardingStep(step: ActiveOnboardingStep): OnboardingStep {
  return onboardingSteps[stepIndex(step) + 1];
}

// "Ahora no" on this tab: /week stops redirecting to the onboarding until the tab is closed.
const dismissKey = (userId: string) => `becook:onboarding-dismissed:${userId}`;

type SessionStore = Pick<Storage, "getItem" | "setItem">;

function sessionStore(): SessionStore | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function dismissOnboarding(userId: string, store: SessionStore | null = sessionStore()) {
  try {
    store?.setItem(dismissKey(userId), "1");
  } catch {
    // Storage unavailable: /week will offer the onboarding again.
  }
}

export function isOnboardingDismissed(userId: string, store: SessionStore | null = sessionStore()) {
  try {
    return store?.getItem(dismissKey(userId)) === "1";
  } catch {
    return false;
  }
}

// Accounts already done or from before the onboarding: /week stops asking on this tab.
const settledKey = (userId: string) => `becook:onboarding-settled:${userId}`;

export function markOnboardingSettled(userId: string, store: SessionStore | null = sessionStore()) {
  try {
    store?.setItem(settledKey(userId), "1");
  } catch {
    // Storage unavailable: the account is asked again next time.
  }
}

export function isOnboardingSettled(userId: string, store: SessionStore | null = sessionStore()) {
  try {
    return store?.getItem(settledKey(userId)) === "1";
  } catch {
    return false;
  }
}

// What /week does for a signed-in account: send a new account to the onboarding, offer to resume
// one the user put off on this tab, and leave every other account alone.
export function weekOnboardingAction(
  status: OnboardingStatus,
  dismissed: boolean,
): { kind: "none" } | { kind: "redirect" } | { kind: "offer"; step: ActiveOnboardingStep } {
  if (status.kind !== "active") {
    return { kind: "none" };
  }

  return dismissed ? { kind: "offer", step: status.step } : { kind: "redirect" };
}

// Express pantry: common staples, none marked. Each tap is one B7 pantry write.
export const expressPantryItems: { name: string; category: PantryCategory }[] = [
  { name: "Aceite de oliva", category: "básicos" },
  { name: "Sal", category: "básicos" },
  { name: "Pimienta", category: "especias" },
  { name: "Arroz", category: "básicos" },
  { name: "Pasta", category: "básicos" },
  { name: "Harina", category: "básicos" },
  { name: "Ajo en polvo", category: "especias" },
  { name: "Pimentón", category: "especias" },
  { name: "Orégano", category: "especias" },
  { name: "Vinagre", category: "básicos" },
  { name: "Mostaza", category: "salsas" },
  { name: "Salsa de soja", category: "salsas" },
  { name: "Tomate triturado", category: "conservas" },
  { name: "Garbanzos cocidos", category: "conservas" },
  { name: "Atún en lata", category: "conservas" },
  { name: "Guisantes congelados", category: "congelados" },
];
