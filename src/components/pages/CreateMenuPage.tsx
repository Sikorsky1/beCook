"use client";

import { Check, Eraser, LoaderCircle, Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AiLoginNotice } from "@/components/features/AiLoginNotice";
import { PrimaryButton, SecondaryButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { IconButton } from "@/components/ui/IconButton";
import { StateMessage } from "@/components/ui/StateMessage";
import { TextArea } from "@/components/ui/TextArea";
import { isAiLoginRequiredError, postAi } from "@/lib/ai-client";
import { consumeCreateMenuDraft, saveCreateMenuDraft } from "@/lib/createMenuDraft";
import {
  importedMenuToWeekDays,
  type GeneratedMenuApiResponse,
  type ImportedMenuResponse,
  type MenuGenerationApiErrorResponse,
} from "@/lib/importMenu";
import {
  formatIsoWeekRange,
  getIsoWeekFromDate,
  isSameIsoWeek,
  parseIsoWeek,
  type IsoWeek,
} from "@/lib/isoWeek";
import { readPantryItems } from "@/lib/pantryStorage";
import {
  clearShoppingListCache,
  generateAndCacheShoppingListForWeek,
  syncShoppingListToSupabase,
} from "@/lib/shoppingListStorage";
import { getAccessToken } from "@/lib/supabase/auth";
import type { UserProfile } from "@/lib/supabase/profiles";
import { pageContentClass, pageShellClass } from "@/lib/ui";
import {
  readSelectedIsoWeek,
  saveSelectedIsoWeek,
  saveWeekWithSupabaseSync,
} from "@/lib/weekStorage";

const PROFILE_STORAGE_KEY = "becook-profile";
const freeTextPromptMaxLength = 300;

type CreateMenuMode = "import" | "generate";
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

const orderedDayNames = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
] as const;

function getTodayDayName() {
  return orderedDayNames[(new Date().getDay() + 6) % 7];
}

function isProfile(value: unknown): value is UserProfile {
  if (!value || typeof value !== "object") {
    return false;
  }

  const profile = value as Partial<UserProfile>;

  return (
    typeof profile.sex === "string" &&
    typeof profile.birthDate === "string" &&
    typeof profile.heightCm === "number" &&
    typeof profile.weightKg === "number" &&
    typeof profile.householdSize === "number" &&
    typeof profile.weeklyTrainingDays === "number" &&
    Array.isArray(profile.trainingTypes) &&
    (Array.isArray(profile.goals) || typeof profile.goal === "string") &&
    Array.isArray(profile.dietaryRestrictions) &&
    Array.isArray(profile.allergies) &&
    Array.isArray(profile.dislikedFoods)
  );
}

function readSavedProfile() {
  if (typeof window === "undefined") {
    return null;
  }

  const savedProfile = window.localStorage.getItem(PROFILE_STORAGE_KEY);

  if (!savedProfile) {
    return null;
  }

  try {
    const parsedProfile = JSON.parse(savedProfile);

    return isProfile(parsedProfile) ? parsedProfile : null;
  } catch {
    return null;
  }
}

function normalizePeopleCount(value: number) {
  return Math.min(Math.max(value, 1), 6);
}

function readActivePantryItemNames() {
  return readPantryItems()
    .filter((item) => item.active)
    .map((item) => item.name);
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

function sanitizeDateParam(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  return value;
}

export default function CreateMenuPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isoYearParam = searchParams.get("isoYear");
  const isoWeekParam = searchParams.get("isoWeek");
  const rawStartDateParam = searchParams.get("startDate");
  const rawEndDateParam = searchParams.get("endDate");
  const startDateParam = sanitizeDateParam(rawStartDateParam);
  const endDateParam = sanitizeDateParam(rawEndDateParam);
  const [hasMounted, setHasMounted] = useState(false);
  const [mode, setMode] = useState<CreateMenuMode>("generate");
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
  const [useWeekStatus, setUseWeekStatus] = useState<UseWeekStatus>("idle");
  const [useWeekMessage, setUseWeekMessage] = useState("");
  const isApplyingWeekRef = useRef(false);
  const navigationTimeoutRef = useRef<number | null>(null);
  const [targetIsoWeek, setTargetIsoWeek] = useState<IsoWeek | null>(null);
  const importedWeekDays = importedMenu
    ? importedMenuToWeekDays(importedMenu.days)
    : null;
  const isCurrentTargetWeek = targetIsoWeek
    ? isSameIsoWeek(targetIsoWeek, getIsoWeekFromDate())
    : false;
  const todayDayName = isCurrentTargetWeek ? getTodayDayName() : null;

  useEffect(() => {
    setHasMounted(true);

    const weekFromUrl = parseIsoWeek({
      isoYear: isoYearParam,
      isoWeek: isoWeekParam,
    });
    const weekForMenu =
      weekFromUrl ?? readSelectedIsoWeek() ?? getIsoWeekFromDate();

    if (
      (rawStartDateParam && !startDateParam) ||
      (rawEndDateParam && !endDateParam)
    ) {
      console.warn(
        "Parámetros de fecha de semana ignorados por formato inválido.",
      );
    }

    setTargetIsoWeek(weekForMenu);
    saveSelectedIsoWeek(weekForMenu);

    let isCancelled = false;
    const draft = consumeCreateMenuDraft();

    if (draft) {
      setMode(draft.mode);
      setMenuText(draft.menuText);
      setFreeTextPrompt(draft.freeTextPrompt.slice(0, freeTextPromptMaxLength));
      setPeopleCount(normalizePeopleCount(draft.peopleCount));
      const restoredStyles = draft.menuStyles.filter(isMenuStyle);
      setMenuStyles(restoredStyles.length ? restoredStyles : defaultMenuStyles);
      setElaborationLevel(draft.elaborationLevel);
    }

    void getAccessToken().then((accessToken) => {
      if (!isCancelled) {
        setNeedsLogin(!accessToken);
      }
    });

    async function loadProfile() {
      const savedProfile = readSavedProfile();

      if (savedProfile) {
        setProfile(savedProfile);
        if (!draft) {
          setPeopleCount(normalizePeopleCount(savedProfile.householdSize));
        }
        return;
      }

      try {
        const { getLatestProfileFromSupabase } = await import(
          "@/lib/supabase/profiles"
        );
        const latestProfile = await getLatestProfileFromSupabase();

        if (!latestProfile || isCancelled) {
          return;
        }

        setProfile(latestProfile);
        if (!draft) {
          setPeopleCount(normalizePeopleCount(latestProfile.householdSize));
        }
      } catch (error: unknown) {
        console.warn(
          "No se pudo recuperar el perfil para crear menú:",
          error instanceof Error ? error.message : error,
        );
      }
    }

    void loadProfile();

    return () => {
      isCancelled = true;
    };
  }, [
    endDateParam,
    isoWeekParam,
    isoYearParam,
    rawEndDateParam,
    rawStartDateParam,
    startDateParam,
  ]);

  useEffect(
    () => () => {
      if (navigationTimeoutRef.current !== null) {
        window.clearTimeout(navigationTimeoutRef.current);
      }
    },
    [],
  );

  const createMenuReturnPath = targetIsoWeek
    ? `/create-menu?isoYear=${targetIsoWeek.isoYear}&isoWeek=${targetIsoWeek.isoWeek}`
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
    setGenerationRequestId(null);

    try {
      const response = await postAi("/api/import-menu", { text: menuText });

      const data = (await response.json()) as
        | ImportedMenuResponse
        | { error?: string };

      if (!response.ok) {
        setImportedMenu(null);
        setErrorIsLimit(response.status === 429 || response.status === 503);
        const fallbackMessage = "No se pudo procesar el menú.";
        setErrorMessage(
          "error" in data ? data.error ?? fallbackMessage : fallbackMessage,
        );
        return;
      }

      setImportedMenu(data as ImportedMenuResponse);
    } catch (error: unknown) {
      setImportedMenu(null);

      if (isAiLoginRequiredError(error)) {
        setNeedsLogin(true);
        return;
      }

      setErrorMessage("Ha fallado la conexión al procesar el menú.");
    } finally {
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
    setGenerationRequestId(null);

    const trimmedFreeTextPrompt = freeTextPrompt.trim();
    const profileForGeneration = profile ?? readSavedProfile();
    const pantryItemsForGeneration = readActivePantryItemNames();
    const menuStylesForGeneration = getMenuStylesForGeneration(menuStyles);
    const weekForGeneration = targetIsoWeek ?? getIsoWeekFromDate();
    let currentGenerationRequestId: string | null = null;
    let recentDishes: string[] = [];

    if (!profile && profileForGeneration) {
      setProfile(profileForGeneration);
    }

    try {
      try {
        const { createMenuGenerationRequest } = await import(
          "@/lib/supabase/menu-generation-requests"
        );
        const { getCurrentUser } = await import("@/lib/supabase/auth");
        const currentUser = await getCurrentUser();

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
        setGenerationRequestId(currentGenerationRequestId);
      } catch (error: unknown) {
        console.warn(
          "No se pudo registrar la petición de generación de menú:",
          error instanceof Error ? error.message : error,
        );
      }

      preparationMs = Math.round(performance.now() - generationStartedAt);
      const apiStartedAt = performance.now();
      const response = await postAi("/api/generate-menu", {
        profile: profileForGeneration,
        pantryItems: pantryItemsForGeneration,
        peopleCount,
        menuStyle: menuStylesForGeneration,
        elaborationLevel,
        recentDishes,
        freeTextPrompt: trimmedFreeTextPrompt,
      });

      const data = (await response.json()) as
        | GeneratedMenuApiResponse
        | MenuGenerationApiErrorResponse;
      apiMs = Math.round(performance.now() - apiStartedAt);
      const persistenceStartedAt = performance.now();

      if (!response.ok) {
        setImportedMenu(null);
        setGenerationRequestId(null);
        setErrorIsLimit(response.status === 429 || response.status === 503);

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
        setErrorMessage(
          "error" in data ? data.error ?? fallbackMessage : fallbackMessage,
        );
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
      setImportedMenu(generatedMenu);
    } catch (error: unknown) {
      setImportedMenu(null);
      setGenerationRequestId(null);

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

      if (isAiLoginRequiredError(error)) {
        setNeedsLogin(true);
        return;
      }

      setErrorMessage("Ha fallado la conexión al crear el menú.");
    } finally {
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

  const handleUseWeek = async () => {
    if (
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

    const weekForUse = targetIsoWeek ?? getIsoWeekFromDate();
    const weekHref = `/week?isoYear=${weekForUse.isoYear}&isoWeek=${weekForUse.isoWeek}`;

    try {
      const { getCurrentUser } = await import("@/lib/supabase/auth");
      const { getWeekFromSupabaseByIsoWeek } = await import(
        "@/lib/supabase/weeks"
      );
      const currentUser = await getCurrentUser();

      if (currentUser?.id) {
        const existingWeek = await getWeekFromSupabaseByIsoWeek({
          isoYear: weekForUse.isoYear,
          isoWeek: weekForUse.isoWeek,
          userId: currentUser.id,
        });

        if (existingWeek) {
          const shouldReplace = window.confirm(
            "Ya hay menú para esta semana. ¿Quieres reemplazarlo?",
          );

          if (!shouldReplace) {
            isApplyingWeekRef.current = false;
            setUseWeekStatus("idle");
            return;
          }
        }
      }

      console.log("Guardando semana importada:", importedWeekDays.length);
      saveSelectedIsoWeek(weekForUse);
      clearShoppingListCache();

      const weekIdPromise = saveWeekWithSupabaseSync(importedWeekDays, {
        generationRequestId,
        isoYear: weekForUse.isoYear,
        isoWeek: weekForUse.isoWeek,
        replaceExisting: true,
      });
      let generatedItems:
        | Awaited<ReturnType<typeof generateAndCacheShoppingListForWeek>>
        | null = null;

      try {
        generatedItems =
          await generateAndCacheShoppingListForWeek(importedWeekDays);
      } catch (error: unknown) {
        console.warn(
          "No se pudo generar automáticamente la lista de la compra:",
          error instanceof Error ? error.message : error,
        );
      }

      const weekId = await weekIdPromise;

      if (weekId && generatedItems) {
        try {
          await syncShoppingListToSupabase(generatedItems, [], weekId);
        } catch (error: unknown) {
          console.warn(
            "No se pudo sincronizar automáticamente la lista de la compra:",
            error instanceof Error ? error.message : error,
          );
        }
      }

      setUseWeekStatus("success");
      setUseWeekMessage("Tu semana se ha actualizado correctamente.");
      navigationTimeoutRef.current = window.setTimeout(() => {
        router.push(weekHref);
      }, useWeekSuccessDelayMs);
    } catch (error: unknown) {
      console.warn(
        "No se pudo aplicar el menú semanal:",
        error instanceof Error ? error.message : error,
      );
      isApplyingWeekRef.current = false;
      setUseWeekStatus("error");
      setUseWeekMessage(
        "No hemos podido aplicar el menú. Inténtalo de nuevo.",
      );
    }
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
              {formatIsoWeekRange(targetIsoWeek)}
            </p>
          ) : null}
        </section>

        <div
          className="grid grid-cols-2 gap-1.5 rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-1.5"
          role="tablist"
          aria-label="Modo de creación de menú"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "generate"}
            onClick={() => {
              setMode("generate");
              setErrorMessage("");
            }}
            className={`min-h-11 rounded-[var(--radius-input)] px-3 text-sm font-semibold transition-colors ${
              mode === "generate"
                ? "bg-[color:var(--color-accent-soft)] text-[color:var(--color-foreground)]"
                : "text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-surface-muted)]"
            }`}
          >
            Crear menú con beCook
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "import"}
            onClick={() => {
              setMode("import");
              setErrorMessage("");
            }}
            className={`min-h-11 rounded-[var(--radius-input)] px-3 text-sm font-semibold transition-colors ${
              mode === "import"
                ? "bg-[color:var(--color-accent-soft)] text-[color:var(--color-foreground)]"
                : "text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-surface-muted)]"
            }`}
          >
            Tengo un menú
          </button>
        </div>

        {mode === "import" ? (
          <Card className="p-3.5 sm:p-5">
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
          <Card className="space-y-4 p-3.5 sm:p-5">
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
                      className={`inline-flex min-h-10 cursor-pointer items-center justify-center rounded-full border px-3 py-1.5 text-center text-[0.78rem] font-semibold leading-tight transition-colors ${
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
              <div className="grid grid-cols-3 gap-1.5 rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-1.5">
                {elaborationOptions.map((option) => {
                  const isSelected = elaborationLevel === option.value;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      disabled={isLoading}
                      onClick={() => setElaborationLevel(option.value)}
                      aria-pressed={isSelected}
                      className={`flex min-h-10 items-center justify-center rounded-[var(--radius-input)] px-2 text-[0.78rem] font-semibold transition-colors ${
                        isSelected
                          ? "bg-[color:var(--color-accent)] text-white"
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
                  "Estamos creando tu semana..."
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

        {isLoading ? (
          <StateMessage
            className="mt-0"
            title="Estamos preparando tu semana..."
            variant="loading"
          >
            <p>
              {loadingMode === "generate"
                ? "Creamos una propuesta con comidas y cenas para que puedas revisarla antes de usarla."
                : "Leemos el menú con calma y lo ordenamos por días para que puedas revisarlo antes de usarlo."}
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[color:var(--color-surface)]/65">
              <div className="h-full w-2/3 rounded-full bg-[color:var(--color-warning)] transition-all duration-700 ease-out motion-reduce:transition-none motion-safe:animate-pulse" />
            </div>
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
            {errorIsLimit ? null : (
              <p className="mt-1">
                {mode === "generate"
                  ? "Vuelve a intentarlo o ajusta un poco las preferencias."
                  : "Revisa que el texto incluya días y platos, y vuelve a intentarlo."}
              </p>
            )}
          </StateMessage>
        ) : null}

        {importedMenu && importedWeekDays ? (
          <section className="space-y-4 border-t border-[color:var(--color-border)] pt-5 transition-opacity duration-200 ease-out motion-reduce:transition-none sm:space-y-5">
            <h2 className="t-h2 text-[color:var(--color-foreground)]">
              Revisa tu semana
            </h2>

            <div className="flex flex-col gap-2.5">
              {importedWeekDays.map((day) => {
                const isToday = todayDayName === day.day;

                return (
                  <Card key={day.day} className="overflow-hidden">
                    <div className="flex items-center gap-2 border-b border-[color:var(--color-border)] px-4 py-3">
                      <h3 className="text-[1.05rem] font-semibold text-[color:var(--color-foreground)]">
                        {day.day}
                        <span className="ml-1.5 text-[0.85rem] font-normal text-[color:var(--color-muted-foreground)]">
                          · {day.date}
                        </span>
                      </h3>
                      {isToday ? (
                        <span className="ml-auto shrink-0 rounded-full bg-[color:var(--color-accent-soft)] px-2.5 py-[3px] text-[0.64rem] font-bold uppercase tracking-[0.1em] text-[color:var(--color-accent)]">
                          Hoy
                        </span>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-2">
                      {(
                        [
                          { label: "Comida", value: day.lunch },
                          { label: "Cena", value: day.dinner },
                        ] as const
                      ).map((meal, index) => {
                        const isFree = meal.value === "LIBRE";

                        return (
                          <div
                            key={meal.label}
                            className={`min-w-0 px-3.5 py-3 ${
                              index === 0
                                ? "border-r border-[color:var(--color-border)]"
                                : ""
                            }`}
                          >
                            <p className="mb-2 text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-muted-foreground)]">
                              {meal.label}
                            </p>
                            <div
                              className={`rounded-[var(--radius-input)] px-3 py-2.5 text-[0.88rem] font-medium leading-[1.4] ${
                                isFree
                                  ? "border border-dashed border-[color:var(--color-border)] italic text-[color:var(--color-muted-foreground)]"
                                  : "bg-[color:var(--color-surface-muted)] text-[color:var(--color-foreground)]"
                              }`}
                            >
                              {isFree ? "Libre" : meal.value}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                );
              })}
            </div>

            <div className="w-full">
              <SecondaryButton
                onClick={handleUseWeek}
                disabled={
                  useWeekStatus === "applying" ||
                  useWeekStatus === "success"
                }
                size="lg"
                className={`w-full sm:w-auto ${
                  useWeekStatus === "applying"
                    ? "cursor-wait"
                    : useWeekStatus === "success"
                      ? "border-[color:var(--color-success)] bg-[color:var(--color-success-soft)] text-[color:var(--color-success-hover)] disabled:opacity-100 disabled:grayscale-0"
                      : ""
                }`}
              >
                {useWeekStatus === "applying" ? (
                  <>
                    <LoaderCircle
                      aria-hidden="true"
                      className="h-4 w-4 animate-spin motion-reduce:animate-none"
                    />
                    Aplicando menú...
                  </>
                ) : useWeekStatus === "success" ? (
                  <>
                    <Check aria-hidden="true" className="h-4 w-4" />
                    Menú aplicado
                  </>
                ) : (
                  "Usar este menú"
                )}
              </SecondaryButton>
              {useWeekMessage ? (
                <p
                  className={`mt-2 text-center text-xs font-semibold sm:text-left ${
                    useWeekStatus === "error"
                      ? "text-[color:var(--color-danger)]"
                      : "text-[color:var(--color-success-hover)]"
                  }`}
                  role={useWeekStatus === "error" ? "alert" : "status"}
                  aria-live="polite"
                >
                  {useWeekMessage}
                </p>
              ) : null}
            </div>
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
    </main>
  );
}
