"use client";

import { Check, Eraser, Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  DaySelector,
  getInitialSelectedDayName,
  type DayName,
} from "@/components/features/DaySelector";
import { ImportedDayPreview } from "@/components/features/ImportedDayPreview";
import { PrimaryButton, TertiaryButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { IconButton } from "@/components/ui/IconButton";
import { StateMessage } from "@/components/ui/StateMessage";
import { TextArea } from "@/components/ui/TextArea";
import {
  importedMenuToWeekDays,
  type ImportedMenuResponse,
} from "@/lib/importMenu";
import {
  formatIsoWeekRange,
  getIsoWeekFromDate,
  parseIsoWeek,
  type IsoWeek,
} from "@/lib/isoWeek";
import { readPantryItems } from "@/lib/pantryStorage";
import {
  clearShoppingListCache,
  generateAndCacheShoppingListForWeek,
  syncShoppingListToSupabase,
} from "@/lib/shoppingListStorage";
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
const defaultElaborationLevel = 4;
const elaborationLevels = [1, 2, 3, 4, 5, 6, 7] as const;

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

export default function CreateMenuPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isoYearParam = searchParams.get("isoYear");
  const isoWeekParam = searchParams.get("isoWeek");
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
  const [selectedDayName, setSelectedDayName] = useState<DayName>("Lunes");
  const [targetIsoWeek, setTargetIsoWeek] = useState<IsoWeek | null>(null);
  const importedWeekDays = importedMenu
    ? importedMenuToWeekDays(importedMenu.days)
    : null;
  const availableDayNames = useMemo(
    () => new Set(importedWeekDays?.map((day) => day.day) ?? []),
    [importedWeekDays],
  );
  const selectedDay = useMemo(
    () =>
      importedWeekDays?.find((day) => day.day === selectedDayName) ?? null,
    [importedWeekDays, selectedDayName],
  );

  useEffect(() => {
    setHasMounted(true);

    const weekFromUrl = parseIsoWeek({
      isoYear: isoYearParam,
      isoWeek: isoWeekParam,
    });
    const weekForMenu =
      weekFromUrl ?? readSelectedIsoWeek() ?? getIsoWeekFromDate();

    setTargetIsoWeek(weekForMenu);
    saveSelectedIsoWeek(weekForMenu);

    let isCancelled = false;

    async function loadProfile() {
      const savedProfile = readSavedProfile();

      if (savedProfile) {
        setProfile(savedProfile);
        setPeopleCount(normalizePeopleCount(savedProfile.householdSize));
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
        setPeopleCount(normalizePeopleCount(latestProfile.householdSize));
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
  }, [isoWeekParam, isoYearParam]);

  const handleProcessMenu = async () => {
    setIsLoading(true);
    setLoadingMode("import");
    setErrorMessage("");
    setGenerationRequestId(null);

    try {
      const response = await fetch("/api/import-menu", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: menuText }),
      });

      const data = (await response.json()) as
        | ImportedMenuResponse
        | { error?: string };

      if (!response.ok) {
        setImportedMenu(null);
        const fallbackMessage = "No se pudo procesar el menú.";
        setErrorMessage(
          "error" in data ? data.error ?? fallbackMessage : fallbackMessage,
        );
        return;
      }

      const processedMenu = data as ImportedMenuResponse;
      const processedWeekDays = importedMenuToWeekDays(processedMenu.days);

      setImportedMenu(processedMenu);
      setSelectedDayName(getInitialSelectedDayName(processedWeekDays));
    } catch {
      setImportedMenu(null);
      setErrorMessage("Ha fallado la conexión al procesar el menú.");
    } finally {
      setIsLoading(false);
      setLoadingMode(null);
    }
  };

  const handleGenerateMenu = async () => {
    setIsLoading(true);
    setLoadingMode("generate");
    setErrorMessage("");
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

      const response = await fetch("/api/generate-menu", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          profile: profileForGeneration,
          pantryItems: pantryItemsForGeneration,
          peopleCount,
          menuStyle: menuStylesForGeneration,
          elaborationLevel,
          recentDishes,
          freeTextPrompt: trimmedFreeTextPrompt,
        }),
      });

      const data = (await response.json()) as
        | ImportedMenuResponse
        | { error?: string };

      if (!response.ok) {
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

        const fallbackMessage = "No se pudo crear el menú semanal.";
        setErrorMessage(
          "error" in data ? data.error ?? fallbackMessage : fallbackMessage,
        );
        return;
      }

      const generatedMenu = data as ImportedMenuResponse;
      const generatedWeekDays = importedMenuToWeekDays(generatedMenu.days);

      if (currentGenerationRequestId) {
        try {
          const { markMenuGenerationRequestGenerated } = await import(
            "@/lib/supabase/menu-generation-requests"
          );

          await markMenuGenerationRequestGenerated(currentGenerationRequestId);
          setGenerationRequestId(currentGenerationRequestId);
        } catch (error: unknown) {
          console.warn(
            "No se pudo marcar la petición de generación como generada:",
            error instanceof Error ? error.message : error,
          );
        }
      }

      setImportedMenu(generatedMenu);
      setSelectedDayName(getInitialSelectedDayName(generatedWeekDays));
    } catch {
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

      setErrorMessage("Ha fallado la conexión al crear el menú.");
    } finally {
      setIsLoading(false);
      setLoadingMode(null);
    }
  };

  const handleUseWeek = async () => {
    if (!importedWeekDays) {
      return;
    }

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
      const generatedItems =
        await generateAndCacheShoppingListForWeek(importedWeekDays);
      const weekId = await weekIdPromise;

      if (weekId) {
        await syncShoppingListToSupabase(generatedItems, [], weekId);
      }

      router.push(weekHref);
    } catch (error: unknown) {
      console.warn(
        "No se pudo generar automáticamente la lista de la compra:",
        error instanceof Error ? error.message : error,
      );
      router.push(weekHref);
    }
  };

  return (
    <main className={pageShellClass}>
      <div className={`${pageContentClass} gap-5 sm:gap-6`}>
        <section>
          <p className="ui-eyebrow text-[0.78rem]">Crear menú</p>
          <h1 className="mt-2 text-2xl font-semibold text-[color:var(--color-foreground)] sm:text-3xl">
            Prepara tu menú semanal
          </h1>
          {targetIsoWeek ? (
            <p className="mt-2 text-sm font-medium text-[color:var(--color-muted-foreground)]">
              Se guardará en Semana {targetIsoWeek.isoWeek} ·{" "}
              {formatIsoWeekRange(targetIsoWeek)}
            </p>
          ) : null}
        </section>

        <div
          className="grid grid-cols-2 gap-1.5 rounded-[1rem] border border-[color:var(--color-border)] bg-white p-1.5"
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
            className={`min-h-11 rounded-[0.8rem] px-3 text-sm font-semibold transition-colors ${
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
            className={`min-h-11 rounded-[0.8rem] px-3 text-sm font-semibold transition-colors ${
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

            <PrimaryButton
              onClick={handleProcessMenu}
              disabled={isLoading}
              className="mt-3 w-full disabled:cursor-wait sm:w-auto sm:px-7"
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
          </Card>
        ) : (
          <Card className="space-y-4 p-3.5 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1rem] border border-[color:var(--color-border)] bg-white px-3 py-2.5">
              <span className="text-[0.78rem] font-semibold text-[color:var(--color-foreground)]">
                Número de personas
              </span>
              <div className="inline-flex items-center gap-2 rounded-full bg-[color:var(--color-surface-muted)] p-1">
                <button
                  type="button"
                  disabled={peopleCount === 1 || isLoading}
                  onClick={() => setPeopleCount((value) => value - 1)}
                  aria-label="Reducir personas"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[0.78rem] font-semibold text-[color:var(--color-foreground)] shadow-[var(--shadow-card)] disabled:cursor-not-allowed disabled:text-[color:var(--color-border-strong)]"
                >
                  -
                </button>
                <span className="min-w-10 text-center text-[0.78rem] font-semibold text-[color:var(--color-foreground)]">
                  {peopleCount}
                </span>
                <button
                  type="button"
                  disabled={peopleCount === 6 || isLoading}
                  onClick={() => setPeopleCount((value) => value + 1)}
                  aria-label="Aumentar personas"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[0.78rem] font-semibold text-[color:var(--color-foreground)] shadow-[var(--shadow-card)] disabled:cursor-not-allowed disabled:text-[color:var(--color-border-strong)]"
                >
                  +
                </button>
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-[0.78rem] font-semibold text-[color:var(--color-foreground)]">
                Tipo de menú
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {menuStyleOptions.map((option) => {
                  const isSelected = menuStyles.includes(option.id);

                  return (
                    <label
                      key={option.id}
                      className={`inline-flex min-h-8 cursor-pointer items-center justify-center rounded-full border px-2.5 py-1.5 text-center text-[0.78rem] font-semibold leading-tight transition-colors ${
                        isSelected
                          ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] text-[color:var(--color-foreground)]"
                          : "border-[color:var(--color-border)] bg-white text-[color:var(--color-muted-foreground)] hover:border-[color:var(--color-border-strong)]"
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
              <div className="flex items-center justify-between gap-3">
                <legend className="text-[0.78rem] font-semibold text-[color:var(--color-foreground)]">
                  Nivel de elaboración deseado
                </legend>
                <span className="rounded-full bg-[color:var(--color-accent-soft)] px-2.5 py-1 text-[0.72rem] font-semibold text-[color:var(--color-foreground)]">
                  {elaborationLevel}/7
                </span>
              </div>
              <div className="grid grid-cols-7 gap-1.5 rounded-[1rem] border border-[color:var(--color-border)] bg-white p-1.5">
                {elaborationLevels.map((level) => {
                  const isSelected = elaborationLevel === level;

                  return (
                    <button
                      key={level}
                      type="button"
                      disabled={isLoading}
                      onClick={() => setElaborationLevel(level)}
                      aria-pressed={isSelected}
                      className={`flex min-h-9 items-center justify-center rounded-[0.75rem] text-[0.78rem] font-semibold transition-colors ${
                        isSelected
                          ? "bg-[color:var(--color-accent)] text-white"
                          : "bg-[color:var(--color-surface-muted)] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent-soft)] hover:text-[color:var(--color-foreground)]"
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      {level}
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-between gap-3 text-[0.68rem] font-semibold text-[color:var(--color-muted-foreground)]">
                <span>Poco elaborado</span>
                <span>Muy elaborado</span>
              </div>
            </fieldset>

            <label className="block space-y-2">
              <span className="text-[0.78rem] font-semibold text-[color:var(--color-foreground)]">
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
                className="min-h-28 resize-y bg-white text-sm"
              />
              <span className="block text-right text-xs font-medium text-[color:var(--color-muted-foreground)]">
                {freeTextPrompt.length}/{freeTextPromptMaxLength}
              </span>
            </label>

            <PrimaryButton
              onClick={handleGenerateMenu}
              disabled={isLoading}
              className="w-full disabled:cursor-wait sm:w-auto sm:px-7"
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
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/65">
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
            <p className="mt-1">
              {mode === "generate"
                ? "Vuelve a intentarlo o ajusta un poco las preferencias."
                : "Revisa que el texto incluya días y platos, y vuelve a intentarlo."}
            </p>
          </StateMessage>
        ) : null}

        {importedMenu && importedWeekDays && selectedDay ? (
          <section className="space-y-4 border-t border-[color:var(--color-border)] pt-5 transition-opacity duration-200 ease-out motion-reduce:transition-none sm:space-y-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <DaySelector
                ariaLabel="Selecciona un día importado"
                availableDays={availableDayNames}
                selectedDayName={selectedDayName}
                onSelectDay={setSelectedDayName}
              />
              <TertiaryButton onClick={handleUseWeek} className="px-7">
                Usar esta semana
              </TertiaryButton>
            </div>

            <ImportedDayPreview day={selectedDay} />
          </section>
        ) : (
          <StateMessage title="Tu semana aparecerá aquí." variant="empty">
            <p>
              {mode === "generate"
                ? "Crea un menú semanal y podrás revisar cada día antes de guardarlo."
                : "Pega el menú, procésalo y podrás revisar cada día antes de guardarlo."}
            </p>
          </StateMessage>
        )}
      </div>
    </main>
  );
}
