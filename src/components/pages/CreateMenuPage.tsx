"use client";

import { Check, Eraser, Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AiLoginNotice } from "@/components/features/AiLoginNotice";
import { GenerationContextSummary } from "@/components/features/GenerationContextSummary";
import { GenerationProgress } from "@/components/features/GenerationProgress";
import { ProfileReadinessNotice } from "@/components/features/ProfileReadinessNotice";
import { ProposalActionBar } from "@/components/features/ProposalActionBar";
import { ProposalDayCard, type RequestProposalIdea } from "@/components/features/ProposalDayCard";
import { ReplaceMenuDialog } from "@/components/features/ReplaceMenuDialog";
import { useIdentity } from "@/components/session/IdentityProvider";
import { PrimaryButton, TertiaryButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { IconButton } from "@/components/ui/IconButton";
import { StateMessage } from "@/components/ui/StateMessage";
import { TextArea } from "@/components/ui/TextArea";
import { isAiLoginRequiredError, postAi } from "@/lib/ai-client";
import type { MealKey, WeekDay } from "@/data/mockWeek";
import {
  applyMenuToWeek,
  resolveApplyWeekAttempt,
  undoAppliedMenu,
  undoWindowMs,
  type ApplyWeekAttempt,
  type MenuSaveState,
} from "@/lib/applyWeek";
import {
  activeGenerationRun,
  consumeCreateMenuDraft,
  consumeInterruptedGeneration,
  saveCreateMenuDraft,
  startGenerationRun,
  type GenerationRun,
} from "@/lib/createMenuDraft";
import { proposalIdeaProfile, replaceProposalDish, requestProposalIdea } from "@/lib/dishSubstitution";
import { parseVerifiedFoodContext } from "@/lib/menu-generation/food-context";
import { registerBeforeLoginSaver } from "@/lib/session/login-return";
import {
  importedMenuToWeekDays,
  type GeneratedMenuApiResponse,
  type ImportedMenuResponse,
  type MenuGenerationApiErrorResponse,
} from "@/lib/importMenu";
import {
  formatIsoWeekTitle,
  getCurrentIsoWeek,
  getIsoWeekStorageId,
  getMadridToday,
  isSameIsoWeek,
  type IsoWeek,
} from "@/lib/isoWeek";
import {
  newRequestKey,
  loadProfile,
  readCachedProfile,
  readSelectedWeek,
  writeSelectedWeek,
} from "@/lib/data/repositories";
import {
  attemptFromProposal,
  clearMenuProposal,
  readMenuProposal,
  writeMenuProposal,
} from "@/lib/menuProposal";
import { loadPantry, readCachedPantry } from "@/lib/data/pantry";
import { pantryItemsOrDefault } from "@/lib/pantryStorage";
import { readStoredProfile } from "@/lib/profileForm";
import { ensureShoppingList } from "@/lib/data/shopping";
import { getAccessToken } from "@/lib/supabase/auth";
import { buildWeekHref, resolveWeekSelection } from "@/lib/weekSelection";
import type { UserProfile } from "@/lib/supabase/profiles";
import { nextTabIndex, tabIds } from "@/lib/rovingTabs";
import { pageContentClass, pageShellClass } from "@/lib/ui";

const freeTextPromptMaxLength = 300;

type CreateMenuMode = "import" | "generate";

const createMenuModes: { value: CreateMenuMode; label: string }[] = [
  { value: "generate", label: "Crear menú con beCook" },
  { value: "import", label: "Tengo un menú" },
];

type UseWeekStatus = "idle" | "applying" | "success" | "error";

const menuStyleOptions = [
  { id: "healthy_balanced", label: "Saludable y equilibrado" },
  { id: "high_protein", label: "Alto en proteína" },
  { id: "fat_loss", label: "Pérdida de grasa" },
  { id: "muscle_gain", label: "Ganancia muscular" },
  { id: "mediterranean", label: "Mediterráneo" },
  { id: "quick_simple", label: "Rápido y sencillo" },
] as const;

type MenuStyle = (typeof menuStyleOptions)[number]["id"];

const defaultMenuStyles: MenuStyle[] = ["healthy_balanced"];

function isMenuStyle(value: string): value is MenuStyle {
  return menuStyleOptions.some((option) => option.id === value);
}
const defaultElaborationLevel = 4;
// Etiquetas visibles mapeadas al valor 1-7 que espera /api/generate-menu.
const elaborationOptions = [
  { value: 2, label: "Sencillo" },
  { value: 4, label: "Equilibrado" },
  { value: 6, label: "Elaborado" },
] as const;
const useWeekSuccessDelayMs = 900;
// Longest wait of each AI route (its maxDuration): shown as the honest upper bound (step 27).
const maxWaitSeconds = { generate: 45, import: 60 } as const;
// After this many failures in a row the page stops offering «Reintentar» (step 27).
const maxConsecutiveFailures = 3;

// Body data is optional (D2): the same check as Perfil, so a profile without it is used.
function isProfile(value: unknown): value is UserProfile {
  return readStoredProfile(value) !== null;
}

// «14 platos · 7 días»: what «Usar este menú» saves.
function proposalSummary(weekDays: WeekDay[]) {
  const dishes = weekDays.reduce(
    (count, day) => count + [day.lunch, day.dinner].filter((meal) => meal !== "LIBRE" && meal.trim()).length,
    0,
  );
  return `${dishes} ${dishes === 1 ? "plato" : "platos"} · ${weekDays.length} ${weekDays.length === 1 ? "día" : "días"}`;
}

function normalizePeopleCount(value: number) {
  return Math.min(Math.max(value, 1), 6);
}

function getMenuStylesForGeneration(menuStyles: MenuStyle[]) {
  return menuStyles.length > 0 ? menuStyles : defaultMenuStyles;
}

function serializeMenuGenerationContext(
  menuStyles: MenuStyle[],
  elaborationLevel: number,
) {
  return `${getMenuStylesForGeneration(menuStyles).join(",")}|elaboration_level=${elaborationLevel}`;
}

export default function CreateMenuPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const weekParam = searchParams.get("week");
  const isoYearParam = searchParams.get("isoYear");
  const isoWeekParam = searchParams.get("isoWeek");
  const [weekNotice, setWeekNotice] = useState<string | null>(null);
  const [hasMounted, setHasMounted] = useState(false);
  const [mode, setMode] = useState<CreateMenuMode>("generate");
  const modeTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [menuText, setMenuText] = useState("");
  const [importedMenu, setImportedMenu] = useState<ImportedMenuResponse | null>(
    null,
  );
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [peopleCount, setPeopleCount] = useState(2);
  const [menuStyles, setMenuStyles] =
    useState<MenuStyle[]>(defaultMenuStyles);
  const [elaborationLevel, setElaborationLevel] = useState(
    defaultElaborationLevel,
  );
  const [freeTextPrompt, setFreeTextPrompt] = useState("");
  const [generationRequestId, setGenerationRequestId] = useState<string | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMode, setLoadingMode] = useState<CreateMenuMode | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  // Quota and budget responses (429/503): retrying or tweaking preferences will not help.
  const [errorIsLimit, setErrorIsLimit] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const identity = useIdentity();
  const [activePantryItemNames, setActivePantryItemNames] = useState<string[]>([]);
  const [useWeekStatus, setUseWeekStatus] = useState<UseWeekStatus>("idle");
  const [useWeekMessage, setUseWeekMessage] = useState("");
  // Where the menu is after the last «Usar este menú» (B5): a pending one is retried as is.
  const [useWeekMenu, setUseWeekMenu] = useState<MenuSaveState | null>(null);
  // The proposal recovered from this device (not applied before leaving), while it is shown.
  const [restoredMenu, setRestoredMenu] = useState<ImportedMenuResponse | null>(null);
  // D3. The generation on screen (started here or still running from an earlier visit).
  const [runView, setRunView] = useState<{ mode: CreateMenuMode; startedAt: number } | null>(null);
  const runRef = useRef<GenerationRun | null>(null);
  const [cancelledNotice, setCancelledNotice] = useState(false);
  const [interruptedNotice, setInterruptedNotice] = useState(false);
  const [failureCount, setFailureCount] = useState(0);
  // «Otra idea» waits for the profile of the current identity (an empty one would skip allergies).
  const [profileReady, setProfileReady] = useState(false);
  // Changes with every new proposal, so the per-dish idea state starts again.
  const [proposalKey, setProposalKey] = useState(0);
  const [replaceRequest, setReplaceRequest] = useState<{
    current: WeekDay[];
    resolve: (confirmed: boolean) => void;
  } | null>(null);
  // «Deshacer» after a replacement: the replaced menu and the key of the write that restores it.
  const [undo, setUndo] = useState<{ previous: WeekDay[]; requestKey: string; busy: boolean } | null>(null);
  const undoTimeoutRef = useRef<number | null>(null);
  const releaseShoppingRef = useRef<((prepare: boolean) => void) | null>(null);
  const importedMenuRef = useRef(importedMenu);
  const isApplyingWeekRef = useRef(false);
  const applyAttemptRef = useRef<ApplyWeekAttempt<ImportedMenuResponse> | null>(null);
  const navigationTimeoutRef = useRef<number | null>(null);
  const [targetIsoWeek, setTargetIsoWeek] = useState<IsoWeek | null>(null);
  // Each proposed or imported day is dated by its name inside the target week.
  const importedWeekDays =
    importedMenu && targetIsoWeek
      ? importedMenuToWeekDays(importedMenu.days, targetIsoWeek)
      : null;
  // C1: what /api/generate-menu read from the account and used for the proposal on screen.
  const proposalFoodContext = parseVerifiedFoodContext(
    (importedMenu as GeneratedMenuApiResponse | null)?.foodContext,
  );
  const madridToday = getMadridToday();
  const todayDayName =
    targetIsoWeek && isSameIsoWeek(targetIsoWeek, madridToday.week)
      ? madridToday.dayName
      : null;

  useEffect(() => {
    // Identity first: profile, pantry and selected week belong to the current identity.
    if (identity.status !== "ready") {
      return;
    }

    const dataIdentity = { scope: identity.scope, userId: identity.userId };
    setHasMounted(true);

    // Same rule as /week: the URL decides, then the scoped preference, then today (Madrid).
    const selection = resolveWeekSelection({
      weekParam,
      isoYearParam,
      isoWeekParam,
      preference: readSelectedWeek(dataIdentity),
      today: getCurrentIsoWeek(),
    });
    const weekForMenu = selection.week;

    setWeekNotice(selection.notice);
    setTargetIsoWeek(weekForMenu);
    writeSelectedWeek(dataIdentity, weekForMenu);

    let isCancelled = false;
    // A generation cut by a reload or a closed tab: its form comes back and the user is told.
    const weekForMenuId = getIsoWeekStorageId(weekForMenu);
    const interrupted = consumeInterruptedGeneration(dataIdentity.scope, weekForMenuId);
    // Still running from an earlier visit: the form shows what it was started with.
    const running = activeGenerationRun(dataIdentity.scope, weekForMenuId);
    const draft = interrupted ?? running?.draft ?? consumeCreateMenuDraft();

    if (interrupted) {
      setInterruptedNotice(true);
    }

    if (draft) {
      setMode(draft.mode);
      setMenuText(draft.menuText);
      setFreeTextPrompt(draft.freeTextPrompt.slice(0, freeTextPromptMaxLength));
      setPeopleCount(normalizePeopleCount(draft.peopleCount));
      const restoredStyles = draft.menuStyles.filter(isMenuStyle);
      setMenuStyles(restoredStyles.length ? restoredStyles : defaultMenuStyles);
      setElaborationLevel(draft.elaborationLevel);
    }

    setNeedsLogin(!dataIdentity.userId);
    setProfileReady(false);

    const applyProfile = (value: unknown) => {
      const nextProfile = isProfile(value) ? value : null;
      setProfile(nextProfile);
      if (nextProfile && !draft) {
        setPeopleCount(normalizePeopleCount(nextProfile.householdSize));
      }
    };
    const applyPantry = (value: unknown) => {
      setActivePantryItemNames(
        pantryItemsOrDefault(value)
          .filter((item) => item.active)
          .map((item) => item.name),
      );
    };

    // Cached copy first, then the account (signed-in users); never another identity's data.
    applyProfile(readCachedProfile(dataIdentity));
    applyPantry(readCachedPantry(dataIdentity));
    void loadProfile(dataIdentity).then((result) => {
      if (!isCancelled) {
        applyProfile(result.data);
        setProfileReady(true);
      }
    });
    void loadPantry(dataIdentity).then((result) => {
      if (!isCancelled) applyPantry(result.data);
    });

    return () => {
      isCancelled = true;
    };
  }, [
    identity.status,
    identity.scope,
    identity.userId,
    identity.epoch,
    weekParam,
    isoWeekParam,
    isoYearParam,
  ]);

  useEffect(
    () => () => {
      if (navigationTimeoutRef.current !== null) {
        window.clearTimeout(navigationTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    // B5: a menu proposed or imported for this week and not applied yet comes back as it was,
    // with its attempt, so applying it never needs another AI call.
    if (identity.status !== "ready" || !targetIsoWeek) {
      return;
    }

    const dataIdentity = { scope: identity.scope, userId: identity.userId };
    const weekId = getIsoWeekStorageId(targetIsoWeek);
    let isCancelled = false;
    let resumedRun: GenerationRun | null = null;
    const restoreProposal = (resumed: boolean) => {
      const proposal = readMenuProposal(dataIdentity, targetIsoWeek);

      // A menu already on screen (just created or imported) is never replaced.
      if (!proposal || (importedMenuRef.current && !resumed)) {
        return;
      }

      applyAttemptRef.current = attemptFromProposal(proposal, proposal.menu, weekId);
      importedMenuRef.current = proposal.menu;
      setImportedMenu(proposal.menu);
      setGenerationRequestId(proposal.generationRequestId);
      setRestoredMenu(resumed ? null : proposal.menu);
      setProposalKey((key) => key + 1);
    };
    const timer = window.setTimeout(() => {
      // D3: a generation started before leaving this page is still running: show it as it is.
      const run = activeGenerationRun(dataIdentity.scope, weekId);
      // The proposal that was on screen stays until the new one arrives.
      restoreProposal(false);

      if (run && !runRef.current) {
        resumedRun = run;
        runRef.current = run;
        setIsLoading(true);
        setLoadingMode(run.mode);
        setMode(run.mode);
        setRunView({ mode: run.mode, startedAt: run.startedAt });
        void run.done.then((result) => {
          if (isCancelled || runRef.current !== run) return;
          runRef.current = null;
          setRunView(null);
          setIsLoading(false);
          setLoadingMode(null);
          if (result.status === "proposal") {
            setFailureCount(0);
            restoreProposal(true);
          } else if (result.status === "error") {
            setFailureCount((count) => count + 1);
            setErrorIsLimit(result.limit);
            setErrorMessage(result.message);
          } else if (result.status === "cancelled") {
            setCancelledNotice(true);
          } else {
            setNeedsLogin(true);
          }
        });
      }
    }, 0);

    return () => {
      isCancelled = true;
      window.clearTimeout(timer);
      if (resumedRun && runRef.current === resumedRun) {
        runRef.current = null;
      }
    };
  }, [identity.status, identity.scope, identity.userId, identity.epoch, targetIsoWeek]);

  useEffect(() => {
    importedMenuRef.current = importedMenu;
  }, [importedMenu]);

  useEffect(() => {
    // Every new proposal is kept on this device until it is saved.
    if (
      identity.status !== "ready" ||
      !targetIsoWeek ||
      !importedMenu ||
      useWeekStatus === "applying" ||
      useWeekStatus === "success"
    ) {
      return;
    }

    const attempt = applyAttemptRef.current;
    writeMenuProposal({ scope: identity.scope, userId: identity.userId }, targetIsoWeek, {
      menu: importedMenu,
      generationRequestId,
      attempt:
        attempt && attempt.menu === importedMenu
          ? { requestKey: attempt.requestKey, overwrite: attempt.overwrite, baseVersion: attempt.baseVersion }
          : null,
    });
  }, [
    identity.status,
    identity.scope,
    identity.userId,
    targetIsoWeek,
    importedMenu,
    generationRequestId,
    useWeekStatus,
  ]);

  const discardProposal = () => {
    if (targetIsoWeek) {
      clearMenuProposal({ scope: identity.scope, userId: identity.userId }, targetIsoWeek);
    }

    applyAttemptRef.current = null;
    setImportedMenu(null);
    setGenerationRequestId(null);
    setRestoredMenu(null);
    setUseWeekStatus("idle");
    setUseWeekMessage("");
    setUseWeekMenu(null);
  };

  const createMenuReturnPath = targetIsoWeek
    ? buildWeekHref("/create-menu", targetIsoWeek)
    : "/create-menu";

  const saveDraftForLogin = () => {
    saveCreateMenuDraft({
      mode,
      menuText,
      freeTextPrompt,
      peopleCount,
      menuStyles,
      elaborationLevel,
    });
  };

  useEffect(
    // The expired-session banner also leads to /login: the form must survive that trip too.
    () =>
      registerBeforeLoginSaver(() =>
        saveCreateMenuDraft({
          mode,
          menuText,
          freeTextPrompt,
          peopleCount,
          menuStyles,
          elaborationLevel,
        }),
      ),
    [mode, menuText, freeTextPrompt, peopleCount, menuStyles, elaborationLevel],
  );

  // D3, step 27: every AI request of this page is a run that can be cancelled, survives moving to
  // another page of the app and leaves its proposal stored as soon as it arrives.
  const beginRun = (runMode: CreateMenuMode) => {
    const weekForRun = targetIsoWeek ?? getCurrentIsoWeek();
    const started = startGenerationRun(
      { scope: identity.scope, week: getIsoWeekStorageId(weekForRun), mode: runMode, startedAt: Date.now() },
      { mode: runMode, menuText, freeTextPrompt, peopleCount, menuStyles, elaborationLevel },
    );
    runRef.current = started.run;
    setRunView({ mode: runMode, startedAt: started.run.startedAt });
    setCancelledNotice(false);
    setInterruptedNotice(false);
    return { ...started, weekForRun };
  };

  const endRun = (run: GenerationRun) => {
    if (runRef.current === run) {
      runRef.current = null;
      setRunView(null);
    }
  };

  const showNewProposal = (menu: ImportedMenuResponse, requestId: string | null, week: IsoWeek) => {
    // Stored at once: if the user left the page meanwhile, it is recovered when they come back.
    writeMenuProposal({ scope: identity.scope, userId: identity.userId }, week, {
      menu,
      generationRequestId: requestId,
      attempt: null,
    });
    applyAttemptRef.current = null;
    setImportedMenu(menu);
    setRestoredMenu(null);
    setProposalKey((key) => key + 1);
    setFailureCount(0);
  };

  const cancelGeneration = () => {
    runRef.current?.controller.abort();
  };

  const requireSession = async () => {
    if (await getAccessToken()) {
      return true;
    }

    setNeedsLogin(true);
    return false;
  };

  const handleProcessMenu = async () => {
    if (!(await requireSession())) {
      return;
    }

    setIsLoading(true);
    setLoadingMode("import");
    setErrorMessage("");
    setErrorIsLimit(false);
    setUseWeekStatus("idle");
    setUseWeekMessage("");
    const previousRequestId = generationRequestId;
    setGenerationRequestId(null);
    const { run, finish, weekForRun } = beginRun("import");

    try {
      const response = await postAi("/api/import-menu", { text: menuText }, run.controller.signal);

      const data = (await response.json()) as
        | ImportedMenuResponse
        | { error?: string };

      if (!response.ok) {
        setImportedMenu(null);
        const isLimit = response.status === 429 || response.status === 503;
        setErrorIsLimit(isLimit);
        const fallbackMessage = "No se pudo procesar el menú.";
        const message = "error" in data ? data.error ?? fallbackMessage : fallbackMessage;
        setErrorMessage(message);
        setFailureCount((count) => count + 1);
        finish({ status: "error", message, limit: isLimit });
        return;
      }

      showNewProposal(data as ImportedMenuResponse, null, weekForRun);
      finish({ status: "proposal" });
    } catch (error: unknown) {
      // Cancelled: whatever was on screen before stays.
      if (run.controller.signal.aborted) {
        setGenerationRequestId(previousRequestId);
        setCancelledNotice(true);
        finish({ status: "cancelled" });
        return;
      }

      setImportedMenu(null);

      if (isAiLoginRequiredError(error)) {
        setNeedsLogin(true);
        finish({ status: "login_required" });
        return;
      }

      const message = "Ha fallado la conexión al procesar el menú.";
      setErrorMessage(message);
      setFailureCount((count) => count + 1);
      finish({ status: "error", message, limit: false });
    } finally {
      endRun(run);
      setIsLoading(false);
      setLoadingMode(null);
    }
  };

  const handleGenerateMenu = async () => {
    if (!(await requireSession())) {
      return;
    }

    const generationStartedAt = performance.now();
    let preparationMs = 0;
    let apiMs = 0;
    let persistenceMs = 0;
    setIsLoading(true);
    setLoadingMode("generate");
    setErrorMessage("");
    setErrorIsLimit(false);
    setUseWeekStatus("idle");
    setUseWeekMessage("");
    const previousRequestId = generationRequestId;
    setGenerationRequestId(null);
    const { run, finish } = beginRun("generate");

    const trimmedFreeTextPrompt = freeTextPrompt.trim();
    const profileForGeneration = profile;
    const pantryItemsForGeneration = activePantryItemNames;
    const menuStylesForGeneration = getMenuStylesForGeneration(menuStyles);
    const weekForGeneration = targetIsoWeek ?? getCurrentIsoWeek();
    let currentGenerationRequestId: string | null = null;
    let recentDishes: string[] = [];

    try {
      try {
        const { createMenuGenerationRequest } = await import(
          "@/lib/supabase/menu-generation-requests"
        );
        const currentUser = identity.userId ? { id: identity.userId } : null;

        if (currentUser?.id) {
          try {
            const { getRecentWeekDishNamesFromSupabase } = await import(
              "@/lib/supabase/weeks"
            );

            recentDishes = await getRecentWeekDishNamesFromSupabase({
              userId: currentUser.id,
              limit: 4,
              excludeIsoYear: weekForGeneration.isoYear,
              excludeIsoWeek: weekForGeneration.isoWeek,
            });
          } catch (error: unknown) {
            console.warn(
              "No se pudieron recuperar platos recientes para el prompt:",
              error instanceof Error ? error.message : error,
            );
          }
        }

        currentGenerationRequestId = await createMenuGenerationRequest({
          profileId: profileForGeneration?.id ?? null,
          userId: currentUser?.id,
          peopleCount,
          menuStyle: serializeMenuGenerationContext(
            menuStylesForGeneration,
            elaborationLevel,
          ),
          freeTextPrompt: trimmedFreeTextPrompt,
        });
        // Linked to the proposal only once it exists (a cancelled run must not take over the
        // id of the proposal still on screen).
      } catch (error: unknown) {
        console.warn(
          "No se pudo registrar la petición de generación de menú:",
          error instanceof Error ? error.message : error,
        );
      }

      preparationMs = Math.round(performance.now() - generationStartedAt);
      const apiStartedAt = performance.now();
      const response = await postAi("/api/generate-menu", {
        pantryItems: pantryItemsForGeneration,
        peopleCount,
        menuStyle: menuStylesForGeneration,
        elaborationLevel,
        recentDishes,
        freeTextPrompt: trimmedFreeTextPrompt,
      }, run.controller.signal);

      const data = (await response.json()) as
        | GeneratedMenuApiResponse
        | MenuGenerationApiErrorResponse;
      apiMs = Math.round(performance.now() - apiStartedAt);
      const persistenceStartedAt = performance.now();

      if (!response.ok) {
        setImportedMenu(null);
        setGenerationRequestId(null);
        const isLimit = response.status === 429 || response.status === 503;
        setErrorIsLimit(isLimit);

        if (currentGenerationRequestId) {
          try {
            const { markMenuGenerationRequestFailed } = await import(
              "@/lib/supabase/menu-generation-requests"
            );

            await markMenuGenerationRequestFailed(
              currentGenerationRequestId,
              data.openaiTelemetry,
            );
          } catch (error: unknown) {
            console.warn(
              "No se pudo marcar la petición de generación como fallida:",
              error instanceof Error ? error.message : error,
            );
          }
        }

        const fallbackMessage = "No se pudo crear el menú semanal.";
        const message = "error" in data ? data.error ?? fallbackMessage : fallbackMessage;
        setErrorMessage(message);
        setFailureCount((count) => count + 1);
        finish({ status: "error", message, limit: isLimit });
        return;
      }

      const generatedMenu = data as GeneratedMenuApiResponse;

      if (currentGenerationRequestId) {
        try {
          const { markMenuGenerationRequestGenerated } = await import(
            "@/lib/supabase/menu-generation-requests"
          );

          await markMenuGenerationRequestGenerated(
            currentGenerationRequestId,
            generatedMenu.openaiTelemetry,
          );
          setGenerationRequestId(currentGenerationRequestId);
        } catch (error: unknown) {
          console.warn(
            "No se pudo marcar la petición de generación como generada:",
            error instanceof Error ? error.message : error,
          );
        }
      }

      persistenceMs = Math.round(performance.now() - persistenceStartedAt);
      showNewProposal(generatedMenu, currentGenerationRequestId, weekForGeneration);
      setGenerationRequestId(currentGenerationRequestId);
      finish({ status: "proposal" });
    } catch (error: unknown) {
      const cancelled = run.controller.signal.aborted;

      // Cancelled: whatever was on screen before stays.
      if (!cancelled) {
        setImportedMenu(null);
        setGenerationRequestId(null);
      }

      if (currentGenerationRequestId) {
        try {
          const { markMenuGenerationRequestFailed } = await import(
            "@/lib/supabase/menu-generation-requests"
          );

          await markMenuGenerationRequestFailed(currentGenerationRequestId);
        } catch (error: unknown) {
          console.warn(
            "No se pudo marcar la petición de generación como fallida:",
            error instanceof Error ? error.message : error,
          );
        }
      }

      if (cancelled) {
        setGenerationRequestId(previousRequestId);
        setCancelledNotice(true);
        finish({ status: "cancelled" });
        return;
      }

      if (isAiLoginRequiredError(error)) {
        setNeedsLogin(true);
        finish({ status: "login_required" });
        return;
      }

      const message = "Ha fallado la conexión al crear el menú.";
      setErrorMessage(message);
      setFailureCount((count) => count + 1);
      finish({ status: "error", message, limit: false });
    } finally {
      endRun(run);
      if (process.env.NODE_ENV === "development") {
        console.info("menu_generation_browser", {
          preparationMs, apiMs, persistenceMs,
          totalMs: Math.round(performance.now() - generationStartedAt),
        });
      }
      setIsLoading(false);
      setLoadingMode(null);
    }
  };

  // D3, step 26: the replacement is confirmed in the page's own dialog, which shows the menu it
  // replaces. The promise settles when the user answers.
  const confirmReplaceInDialog = (current: WeekDay[]) =>
    new Promise<boolean>((resolve) => {
      setReplaceRequest({ current, resolve });
    });

  const answerReplace = (confirmed: boolean) => {
    replaceRequest?.resolve(confirmed);
    setReplaceRequest(null);
  };

  const clearUndoTimer = () => {
    if (undoTimeoutRef.current !== null) {
      window.clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = null;
    }
  };

  // The shopping list waits while the replacement can be undone (true: prepare it now).
  const releaseShopping = (prepare: boolean) => {
    releaseShoppingRef.current?.(prepare);
    releaseShoppingRef.current = null;
  };

  const openWeek = (weekForUse: IsoWeek) => {
    clearUndoTimer();
    releaseShopping(true);
    setUndo(null);
    router.push(buildWeekHref("/week", weekForUse));
  };

  useEffect(
    () => () => {
      // Leaving the page ends the undo window: the replacement stays and its list is prepared.
      if (undoTimeoutRef.current !== null) {
        window.clearTimeout(undoTimeoutRef.current);
      }
      releaseShoppingRef.current?.(true);
    },
    [],
  );

  const handleUseWeek = async () => {
    if (
      !importedMenu ||
      !importedWeekDays ||
      isApplyingWeekRef.current ||
      useWeekStatus === "applying" ||
      useWeekStatus === "success"
    ) {
      return;
    }

    isApplyingWeekRef.current = true;
    setUseWeekStatus("applying");
    setUseWeekMessage("");

    const weekForUse = targetIsoWeek ?? getCurrentIsoWeek();
    const weekHref = buildWeekHref("/week", weekForUse);
    const dataIdentity = { scope: identity.scope, userId: identity.userId };
    // Same menu and week → same attempt and request key, so a resend is applied only once.
    const attempt = resolveApplyWeekAttempt(
      applyAttemptRef.current,
      importedMenu,
      getIsoWeekStorageId(weekForUse),
      newRequestKey,
    );
    applyAttemptRef.current = attempt;
    // The proposal stays on this device until the menu is saved; a kept attempt is retried as is.
    const keepProposal = (keepAttempt: boolean) => {
      writeMenuProposal(dataIdentity, weekForUse, {
        menu: importedMenu,
        generationRequestId,
        attempt: keepAttempt
          ? { requestKey: attempt.requestKey, overwrite: attempt.overwrite, baseVersion: attempt.baseVersion }
          : null,
      });
    };
    let release: (prepare: boolean) => void = () => {};
    const holdShopping = new Promise<boolean>((resolve) => {
      release = resolve;
    });

    try {
      const { outcome, shopping, replaced } = await applyMenuToWeek({
        identity: dataIdentity,
        isoWeek: weekForUse,
        weekDays: importedWeekDays,
        attempt,
        generationRequestId,
        confirmReplace: confirmReplaceInDialog,
        prepareShopping: ensureShoppingList,
        holdShopping,
      });

      if (outcome.attempt === "discard") {
        applyAttemptRef.current = null;
      }

      setUseWeekMenu(outcome.menu);

      if (!outcome.openWeek) {
        release(false);
        isApplyingWeekRef.current = false;
        keepProposal(outcome.attempt === "keep");
        setUseWeekStatus(outcome.status === "idle" ? "idle" : "error");
        setUseWeekMessage(outcome.message);
        return;
      }

      // The menu is saved. The list is prepared apart (B6 keeps it if the dishes did not change)
      // and the Compra page shows its own state.
      clearMenuProposal(dataIdentity, weekForUse);
      setRestoredMenu(null);
      writeSelectedWeek(dataIdentity, weekForUse);
      void shopping.then((prepared) => {
        if (prepared === "failed") {
          console.warn("No se pudo preparar la lista de la compra; se intentará al abrir Compra.");
        }
      });

      setUseWeekStatus("success");

      if (replaced) {
        // A menu was replaced: for a short time it can be restored. Until then the current
        // shopping list is left as it is, so undoing keeps it and its marks.
        releaseShoppingRef.current = release;
        setUndo({ previous: replaced, requestKey: newRequestKey(), busy: false });
        setUseWeekMessage(`${outcome.message} Puedes deshacerlo durante unos segundos.`);
        undoTimeoutRef.current = window.setTimeout(() => openWeek(weekForUse), undoWindowMs);
        return;
      }

      release(true);
      setUseWeekMessage(
        outcome.menu === "account"
          ? `${outcome.message} La lista de la compra se prepara aparte.`
          : outcome.message,
      );
      navigationTimeoutRef.current = window.setTimeout(() => {
        router.push(weekHref);
      }, useWeekSuccessDelayMs);
    } catch (error: unknown) {
      console.warn(
        "No se pudo aplicar el menú semanal:",
        error instanceof Error ? error.message : error,
      );
      release(false);
      isApplyingWeekRef.current = false;
      keepProposal(true);
      setUseWeekStatus("error");
      setUseWeekMessage("No hemos podido aplicar el menú. Inténtalo de nuevo.");
    }
  };

  // «Deshacer»: the replaced menu goes back, only if the week is still the one just saved.
  const handleUndo = async () => {
    if (!undo || undo.busy) {
      return;
    }

    clearUndoTimer();
    const weekForUse = targetIsoWeek ?? getCurrentIsoWeek();
    setUndo({ ...undo, busy: true });
    let result;

    try {
      result = await undoAppliedMenu({ scope: identity.scope, userId: identity.userId }, weekForUse, undo);
    } catch {
      result = { status: "pending" as const, message: "No hemos podido deshacerlo. Inténtalo de nuevo." };
    }

    if (result.status === "pending") {
      // Same key on the next try: the restore is applied once.
      setUndo({ ...undo, busy: false });
      setUseWeekMessage(result.message);
      return;
    }

    setUndo(null);

    if (result.status === "conflict") {
      // The week changed elsewhere: nothing was undone and the list follows the account's week.
      releaseShopping(false);
      setUseWeekMessage(result.message);
      return;
    }

    // Restored: the list that was current stays current (it was never replaced). The proposal
    // comes back as it was, unsaved, in case the user wants it after all.
    releaseShopping(false);
    isApplyingWeekRef.current = false;
    applyAttemptRef.current = null;
    setUseWeekStatus("idle");
    setUseWeekMenu(null);
    setUseWeekMessage(`${result.message} La propuesta sigue aquí sin aplicar.`);
  };

  const handleReplaceDish = (dayName: string, mealKey: MealKey, dish: string) => {
    setImportedMenu((menu) => (menu ? replaceProposalDish(menu, { day: dayName, meal: mealKey }, dish) : menu));
    // A changed proposal is a new menu: a new «Usar este menú» attempt.
    if (useWeekStatus === "error") {
      setUseWeekStatus("idle");
      setUseWeekMessage("");
      setUseWeekMenu(null);
    }
  };

  const handleRequestProposalIdea: RequestProposalIdea = (dayName, mealKey, rejected, ideaMode, signal) => {
    if (!importedWeekDays) {
      return { status: "error", message: "No hay propuesta en pantalla." };
    }

    // A generated proposal carries the context the server used (C1): ideas honour it even before
    // this page has read the profile. Imported menus have none and need the profile.
    if (!profileReady && !proposalFoodContext) {
      return { status: "error", message: "Aún no hemos podido leer tu perfil. Inténtalo en unos segundos." };
    }

    return requestProposalIdea(
      importedWeekDays,
      { day: dayName, meal: mealKey },
      rejected,
      proposalIdeaProfile(proposalFoodContext, profileReady ? profile : null),
      ideaMode,
      Boolean(identity.userId),
      signal,
    );
  };

  const selectMode = (nextMode: CreateMenuMode) => {
    setMode(nextMode);
    setErrorMessage("");
  };

  return (
    <main className={pageShellClass}>
      <div className={`${pageContentClass} gap-5 sm:gap-6`}>
        <section>
          <p className="t-eyebrow">Crear menú</p>
          <h1 className="t-h1 mt-2 text-[color:var(--color-foreground)]">
            Prepara tu menú semanal
          </h1>
          {targetIsoWeek ? (
            <p className="t-meta mt-2">
              Se guardará en Semana {targetIsoWeek.isoWeek} ·{" "}
              {formatIsoWeekTitle(targetIsoWeek)}
            </p>
          ) : null}
          {weekNotice ? (
            <p
              role="status"
              className="mt-3 rounded-[var(--radius-control)] border border-[color:var(--color-warning)] bg-[color:var(--color-warning-soft)] px-4 py-3 text-sm leading-6 text-[#8a4e2a]"
            >
              {weekNotice}
            </p>
          ) : null}
          <ProfileReadinessNotice profile={profile} fromOnboarding={searchParams.get("from") === "onboarding"} />
        </section>

        <div
          className="grid grid-cols-2 gap-1.5 rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-1.5"
          role="tablist"
          aria-label="Modo de creación de menú"
        >
          {createMenuModes.map((option, index) => {
            const isSelected = mode === option.value;
            const ids = tabIds("create-menu", option.value);

            return (
              <button
                key={option.value}
                ref={(element) => {
                  modeTabRefs.current[index] = element;
                }}
                type="button"
                role="tab"
                id={ids.tab}
                aria-selected={isSelected}
                aria-controls={ids.panel}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => selectMode(option.value)}
                onKeyDown={(event) => {
                  const next = nextTabIndex(event.key, index, createMenuModes.length);
                  if (next === null) return;
                  event.preventDefault();
                  selectMode(createMenuModes[next].value);
                  modeTabRefs.current[next]?.focus();
                }}
                className={`min-h-11 rounded-[var(--radius-input)] px-3 text-sm font-semibold transition-colors ${
                  isSelected
                    ? "bg-[color:var(--color-accent-soft)] text-[color:var(--color-foreground)]"
                    : "text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-surface-muted)]"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {mode === "import" ? (
          <Card
            role="tabpanel"
            id={tabIds("create-menu", "import").panel}
            aria-labelledby={tabIds("create-menu", "import").tab}
            className="p-3.5 sm:p-5"
          >
            <div className="relative">
              <IconButton
                onClick={() => setMenuText("")}
                disabled={!menuText}
                aria-label="Limpiar texto"
                className="absolute right-3 top-3 z-10"
              >
                <Eraser aria-hidden="true" className="h-4 w-4" />
              </IconButton>

              {hasMounted ? (
                <TextArea
                  value={menuText}
                  onChange={(event) => setMenuText(event.target.value)}
                  placeholder={`Lunes\nComida: Salmón con calabacín\nCena: LIBRE\n\nMartes\tPollo con arroz\tTortilla francesa`}
                  className="min-h-[18rem] resize-y border-0 pr-16 shadow-none sm:min-h-[22rem] sm:text-lg"
                />
              ) : (
                <TextArea
                  defaultValue=""
                  placeholder={`Lunes\nComida: Salmón con calabacín\nCena: LIBRE\n\nMartes\tPollo con arroz\tTortilla francesa`}
                  className="min-h-[18rem] resize-y border-0 pr-16 shadow-none sm:min-h-[22rem] sm:text-lg"
                />
              )}
            </div>

            {needsLogin ? (
              <AiLoginNotice
                className="mt-3"
                returnPath={createMenuReturnPath}
                description="Tu texto se conserva en este dispositivo. Al volver podrás procesarlo."
                onBeforeNavigate={saveDraftForLogin}
              />
            ) : (
              <PrimaryButton
                onClick={handleProcessMenu}
                disabled={isLoading}
                size="lg"
                className="mt-3 w-full disabled:cursor-wait"
              >
                {isLoading && loadingMode === "import" ? (
                  "Estamos organizando tu menú..."
                ) : (
                  <>
                    <Check aria-hidden="true" className="h-4 w-4" />
                    Procesar menú
                  </>
                )}
              </PrimaryButton>
            )}
          </Card>
        ) : (
          <Card
            role="tabpanel"
            id={tabIds("create-menu", "generate").panel}
            aria-labelledby={tabIds("create-menu", "generate").tab}
            className="space-y-4 p-3.5 sm:p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2.5">
              <span className="t-body-strong text-[color:var(--color-foreground)]">
                Número de personas
              </span>
              <div className="inline-flex items-center gap-2 rounded-full bg-[color:var(--color-surface-muted)] p-1">
                <button
                  type="button"
                  disabled={peopleCount === 1 || isLoading}
                  onClick={() => setPeopleCount((value) => value - 1)}
                  aria-label="Reducir personas"
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-[color:var(--color-surface)] text-sm font-semibold text-[color:var(--color-foreground)] shadow-[var(--shadow-card)] disabled:cursor-not-allowed disabled:text-[color:var(--color-border-strong)]"
                >
                  -
                </button>
                <span className="t-body-strong min-w-10 text-center text-[color:var(--color-foreground)]">
                  {peopleCount}
                </span>
                <button
                  type="button"
                  disabled={peopleCount === 6 || isLoading}
                  onClick={() => setPeopleCount((value) => value + 1)}
                  aria-label="Aumentar personas"
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-[color:var(--color-surface)] text-sm font-semibold text-[color:var(--color-foreground)] shadow-[var(--shadow-card)] disabled:cursor-not-allowed disabled:text-[color:var(--color-border-strong)]"
                >
                  +
                </button>
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="t-body-strong text-[color:var(--color-foreground)]">
                Tipo de menú
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {menuStyleOptions.map((option) => {
                  const isSelected = menuStyles.includes(option.id);

                  return (
                    <label
                      key={option.id}
                      className={`inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border px-3.5 py-2 text-center text-sm font-semibold leading-tight transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-[color:var(--color-accent)] ${
                        isSelected
                          ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] text-[color:var(--color-foreground)]"
                          : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-muted-foreground)] hover:border-[color:var(--color-border-strong)]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        name="menuStyles"
                        checked={isSelected}
                        disabled={isLoading}
                        onChange={() =>
                          setMenuStyles((currentMenuStyles) =>
                            isSelected
                              ? currentMenuStyles.filter(
                                  (menuStyle) => menuStyle !== option.id,
                                )
                              : [...currentMenuStyles, option.id],
                          )
                        }
                        className="sr-only"
                      />
                      {option.label}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="t-body-strong text-[color:var(--color-foreground)]">
                Nivel de elaboración deseado
              </legend>
              <div className="grid grid-cols-3 gap-1 rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-1 sm:gap-1.5 sm:p-1.5">
                {elaborationOptions.map((option) => {
                  const isSelected = elaborationLevel === option.value;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      disabled={isLoading}
                      onClick={() => setElaborationLevel(option.value)}
                      aria-pressed={isSelected}
                      className={`flex min-h-11 min-w-0 items-center justify-center rounded-[var(--radius-input)] px-1 text-[0.8125rem] font-semibold transition-colors sm:px-2 sm:text-sm ${
                        isSelected
                          ? "bg-[color:var(--color-accent-hover)] text-white"
                          : "bg-[color:var(--color-surface-muted)] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent-soft)] hover:text-[color:var(--color-foreground)]"
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <label className="block space-y-2">
              <span className="t-body-strong text-[color:var(--color-foreground)]">
                ¿Qué te apetece esta semana?
              </span>
              <TextArea
                value={freeTextPrompt}
                maxLength={freeTextPromptMaxLength}
                onChange={(event) =>
                  setFreeTextPrompt(
                    event.target.value.slice(0, freeTextPromptMaxLength),
                  )
                }
                placeholder="Ejemplo: cenas ligeras, comidas fáciles de tupper, algo mediterráneo y sin mucho pescado."
                className="min-h-28 resize-y bg-[color:var(--color-surface)] text-sm"
              />
              <span className="t-meta block text-right">
                {freeTextPrompt.length}/{freeTextPromptMaxLength}
              </span>
            </label>

            <GenerationContextSummary
              profile={profile}
              peopleCount={peopleCount}
              styleLabels={getMenuStylesForGeneration(menuStyles).map(
                (style) => menuStyleOptions.find((option) => option.id === style)?.label ?? style,
              )}
              elaborationLabel={
                elaborationOptions.find((option) => option.value === elaborationLevel)?.label ?? "Equilibrado"
              }
              pantryCount={activePantryItemNames.length}
              generating={isLoading && loadingMode === "generate"}
            />

            {needsLogin ? (
              <AiLoginNotice
                returnPath={createMenuReturnPath}
                description="Tus preferencias se conservan en este dispositivo. Al volver podrás crear el menú."
                onBeforeNavigate={saveDraftForLogin}
              />
            ) : (
              <PrimaryButton
                onClick={handleGenerateMenu}
                disabled={isLoading}
                size="lg"
                className="w-full disabled:cursor-wait"
              >
                {isLoading && loadingMode === "generate" ? (
                  "Creando tu propuesta…"
                ) : (
                  <>
                    <Sparkles aria-hidden="true" className="h-4 w-4" />
                    Crear menú semanal
                  </>
                )}
              </PrimaryButton>
            )}
          </Card>
        )}

        {runView ? (
          <GenerationProgress
            mode={runView.mode}
            startedAt={runView.startedAt}
            maxSeconds={maxWaitSeconds[runView.mode]}
            onCancel={cancelGeneration}
          />
        ) : null}

        {cancelledNotice && !isLoading ? (
          <StateMessage className="mt-0" title="Has cancelado la creación del menú." variant="empty">
            <p>
              No ha cambiado nada en tu semana. Tus preferencias siguen aquí para volver a intentarlo cuando quieras.
            </p>
          </StateMessage>
        ) : null}

        {interruptedNotice && !isLoading ? (
          <StateMessage className="mt-0" title="La creación del menú se interrumpió." variant="empty">
            <p>
              Recargaste o cerraste la página mientras se creaba y no hemos podido recuperar la propuesta. Tus
              preferencias siguen aquí. Si la respuesta ya estaba lista, puede haber contado como uno de tus menús de
              hoy.
            </p>
          </StateMessage>
        ) : null}

        {errorMessage ? (
          <StateMessage
            className="mt-0"
            title={
              mode === "generate"
                ? "No hemos podido crear este menú todavía."
                : "No hemos podido ordenar este menú todavía."
            }
            variant="error"
          >
            <p>{errorMessage}</p>
            {errorIsLimit ? null : failureCount >= maxConsecutiveFailures ? (
              <p className="mt-1">
                Ha fallado {failureCount} veces seguidas. Prueba de nuevo dentro de un rato.
              </p>
            ) : (
              <>
                <p className="mt-1">
                  {mode === "generate"
                    ? "Puedes reintentarlo tal cual o ajustar un poco las preferencias."
                    : "Revisa que el texto incluya días y platos, y vuelve a intentarlo."}
                </p>
                {needsLogin || isLoading ? null : (
                  <TertiaryButton
                    size="sm"
                    onClick={mode === "generate" ? handleGenerateMenu : handleProcessMenu}
                    className="mt-2 w-full sm:w-auto"
                  >
                    Reintentar
                  </TertiaryButton>
                )}
              </>
            )}
          </StateMessage>
        ) : null}

        {importedMenu && importedWeekDays ? (
          <section className="space-y-4 border-t border-[color:var(--color-border)] pt-5 transition-opacity duration-200 ease-out motion-reduce:transition-none sm:space-y-5">
            <h2 className="t-h2 text-[color:var(--color-foreground)]">
              Revisa tu semana
            </h2>
            {restoredMenu ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2">
                <p className="t-meta">
                  Propuesta sin aplicar, recuperada de este dispositivo.
                </p>
                <button
                  type="button"
                  onClick={discardProposal}
                  disabled={useWeekStatus === "applying"}
                  className="min-h-11 rounded-full px-3 text-sm font-semibold text-[color:var(--color-muted-foreground)] underline underline-offset-2 hover:text-[color:var(--color-foreground)] disabled:opacity-50"
                >
                  Descartar propuesta
                </button>
              </div>
            ) : null}

            {proposalFoodContext ? (
              <GenerationContextSummary verified={proposalFoodContext} peopleCount={peopleCount} />
            ) : null}

            <p className="t-meta">
              ¿Algún plato no encaja? Pulsa «Otra idea» para cambiar solo ese; el resto de la semana no cambia.
            </p>

            <div key={proposalKey} className="flex flex-col gap-2.5">
              {importedWeekDays.map((day) => (
                <ProposalDayCard
                  key={day.day}
                  day={day}
                  isToday={todayDayName === day.day}
                  locked={useWeekStatus === "applying" || useWeekStatus === "success"}
                  onRequestIdea={handleRequestProposalIdea}
                  onReplaceDish={handleReplaceDish}
                  loginReturnPath={createMenuReturnPath}
                />
              ))}
            </div>

            {/* Room for the fixed bar, so the last day is never hidden behind it. */}
            <div aria-hidden="true" className="h-28" />

            {isLoading ? null : (
              <ProposalActionBar
                summary={proposalSummary(importedWeekDays)}
                weekLabel={targetIsoWeek ? `Semana ${targetIsoWeek.isoWeek}` : "tu semana"}
                status={useWeekStatus}
                menu={useWeekMenu}
                message={useWeekMessage}
                onUse={() => void handleUseWeek()}
                undo={undo ? { busy: undo.busy, onUndo: () => void handleUndo() } : null}
                onOpenWeek={
                  useWeekStatus === "success"
                    ? () => openWeek(targetIsoWeek ?? getCurrentIsoWeek())
                    : null
                }
              />
            )}
          </section>
        ) : (
          <StateMessage title="Tu semana aparecerá aquí." variant="empty">
            <p>
              {mode === "generate"
                ? "Crea un menú semanal y podrás revisar la semana entera antes de guardarla."
                : "Pega el menú, procésalo y podrás revisar la semana entera antes de guardarla."}
            </p>
          </StateMessage>
        )}
      </div>

      {targetIsoWeek ? (
        <ReplaceMenuDialog
          open={replaceRequest !== null}
          weekTitle={`Semana ${targetIsoWeek.isoWeek}`}
          weekDates={formatIsoWeekTitle(targetIsoWeek)}
          current={replaceRequest?.current ?? []}
          signedIn={Boolean(identity.userId)}
          onConfirm={() => answerReplace(true)}
          onCancel={() => answerReplace(false)}
        />
      ) : null}
    </main>
  );
}
