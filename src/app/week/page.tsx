"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import {
  DaySelector,
  getInitialSelectedDayName,
  type DayName,
} from "@/components/features/DaySelector";
import { SelectedDayCard } from "@/components/features/SelectedDayCard";
import { type MealKey, type WeekDay } from "@/data/mockWeek";
import {
  addIsoWeeks,
  formatDateForQuery,
  formatIsoWeekRange,
  getIsoWeekFromDate,
  getIsoWeekKey,
  getIsoWeekRange,
  isSameIsoWeek,
  parseIsoWeek,
  type IsoWeek,
} from "@/lib/isoWeek";
import type { SupabaseMealSlot, SupabaseWeek } from "@/lib/supabase/weeks";
import { pageShellClass } from "@/lib/ui";
import {
  clearSavedWeek,
  readSavedWeek,
  saveSelectedIsoWeek,
  saveWeek,
  saveWeekWithSupabaseSync,
  withWeekDates,
} from "@/lib/weekStorage";

function supabaseMealSlotToWeekMeal(slot: SupabaseMealSlot) {
  return slot.status === "free" ? "LIBRE" : slot.dishName;
}

function supabaseWeekToWeekDays(week: SupabaseWeek, isoWeek: IsoWeek): WeekDay[] {
  return withWeekDates(
    week.days.map((day) => ({
      day: day.dayName,
      date: "",
      lunch: supabaseMealSlotToWeekMeal(day.lunch),
      dinner: supabaseMealSlotToWeekMeal(day.dinner),
    })),
    isoWeek,
  );
}

function buildCreateMenuHref(isoWeek: IsoWeek) {
  const { startDate, endDate } = getIsoWeekRange(isoWeek);
  const searchParams = new URLSearchParams({
    isoYear: String(isoWeek.isoYear),
    isoWeek: String(isoWeek.isoWeek),
    startDate: formatDateForQuery(startDate),
    endDate: formatDateForQuery(endDate),
  });

  return `/create-menu?${searchParams.toString()}`;
}

function formatWeekTitle(isoWeek: IsoWeek) {
  return formatIsoWeekRange(isoWeek).replace("-", " - ");
}

function getNearbyIsoWeeks(isoWeek: IsoWeek) {
  return [-2, -1, 0, 1, 2].map((offset) => addIsoWeeks(isoWeek, offset));
}

function WeekPageContent() {
  const searchParams = useSearchParams();
  const isoYearParam = searchParams.get("isoYear");
  const isoWeekParam = searchParams.get("isoWeek");
  const [currentIsoWeek, setCurrentIsoWeek] = useState<IsoWeek | null>(null);
  const [selectedIsoWeek, setSelectedIsoWeek] = useState<IsoWeek | null>(null);
  const [weekDays, setWeekDays] = useState<WeekDay[] | null>(null);
  const [selectedDayName, setSelectedDayName] = useState<DayName>("Lunes");
  const [isLoadingWeek, setIsLoadingWeek] = useState(true);
  const [weeksWithMenu, setWeeksWithMenu] = useState<Set<string>>(
    () => new Set(),
  );

  const availableDayNames = useMemo(
    () => new Set(weekDays?.map((day) => day.day) ?? []),
    [weekDays],
  );
  const selectedDay = useMemo(
    () => weekDays?.find((day) => day.day === selectedDayName) ?? null,
    [selectedDayName, weekDays],
  );
  const isCurrentWeek =
    selectedIsoWeek && currentIsoWeek
      ? isSameIsoWeek(selectedIsoWeek, currentIsoWeek)
      : false;
  const nearbyIsoWeeks = useMemo(
    () => (selectedIsoWeek ? getNearbyIsoWeeks(selectedIsoWeek) : []),
    [selectedIsoWeek],
  );

  useEffect(() => {
    const realCurrentIsoWeek = getIsoWeekFromDate();
    setCurrentIsoWeek(realCurrentIsoWeek);

    const nextIsoWeek = parseIsoWeek({
      isoYear: isoYearParam,
      isoWeek: isoWeekParam,
    }) ?? realCurrentIsoWeek;

    setSelectedIsoWeek((currentWeek) =>
      currentWeek && isSameIsoWeek(nextIsoWeek, currentWeek)
        ? currentWeek
        : nextIsoWeek,
    );
  }, [isoWeekParam, isoYearParam]);

  useEffect(() => {
    if (!selectedIsoWeek) {
      return;
    }

    let isCancelled = false;
    const weekToLoad = selectedIsoWeek;

    async function loadSelectedWeek() {
      setIsLoadingWeek(true);
      saveSelectedIsoWeek(weekToLoad);

      const cachedWeek = readSavedWeek(weekToLoad);
      if (cachedWeek) {
        setWeekDays(withWeekDates(cachedWeek, weekToLoad));
        setSelectedDayName(getInitialSelectedDayName(cachedWeek));
      } else {
        setWeekDays(null);
        setSelectedDayName("Lunes");
      }

      try {
        const { getCurrentUser } = await import("@/lib/supabase/auth");
        const { getWeekFromSupabaseByIsoWeek } = await import(
          "@/lib/supabase/weeks"
        );
        const currentUser = await getCurrentUser();
        const remoteWeek = await getWeekFromSupabaseByIsoWeek({
          isoYear: weekToLoad.isoYear,
          isoWeek: weekToLoad.isoWeek,
          userId: currentUser?.id,
        });

        if (isCancelled) {
          return;
        }

        if (!remoteWeek) {
          if (currentUser) {
            clearSavedWeek(weekToLoad);
            setWeekDays(null);
            setSelectedDayName("Lunes");
          }

          return;
        }

        const restoredWeek = supabaseWeekToWeekDays(remoteWeek, weekToLoad);

        if (restoredWeek.length === 0) {
          setWeekDays(null);
          setSelectedDayName("Lunes");
          return;
        }

        setWeekDays(restoredWeek);
        saveWeek(restoredWeek, weekToLoad);
        setSelectedDayName(getInitialSelectedDayName(restoredWeek));
      } catch (error: unknown) {
        console.warn(
          "No se pudo recuperar la semana calendario desde Supabase:",
          error instanceof Error ? error.message : error,
        );
      } finally {
        if (!isCancelled) {
          setIsLoadingWeek(false);
        }
      }
    }

    void loadSelectedWeek();

    return () => {
      isCancelled = true;
    };
  }, [selectedIsoWeek]);

  useEffect(() => {
    if (!selectedIsoWeek || nearbyIsoWeeks.length === 0) {
      setWeeksWithMenu(new Set());
      return;
    }

    let isCancelled = false;

    async function loadWeeksPresence() {
      try {
        const { getCurrentUser } = await import("@/lib/supabase/auth");
        const { getWeeksPresenceForIsoWeeks } = await import(
          "@/lib/supabase/weeks"
        );
        const currentUser = await getCurrentUser();
        const presence = await getWeeksPresenceForIsoWeeks({
          isoWeeks: nearbyIsoWeeks,
          userId: currentUser?.id,
        });

        if (!isCancelled) {
          setWeeksWithMenu(presence);
        }
      } catch (error: unknown) {
        console.warn(
          "No se pudo recuperar la presencia de menús cercanos:",
          error instanceof Error ? error.message : error,
        );

        if (!isCancelled) {
          setWeeksWithMenu(new Set());
        }
      }
    }

    void loadWeeksPresence();

    return () => {
      isCancelled = true;
    };
  }, [nearbyIsoWeeks, selectedIsoWeek]);

  const handleNavigateWeek = (offset: number) => {
    if (!selectedIsoWeek) {
      return;
    }

    setSelectedIsoWeek((currentWeek) =>
      currentWeek ? addIsoWeeks(currentWeek, offset) : currentWeek,
    );
  };

  const handleMealChange = (
    dayName: string,
    mealKey: MealKey,
    value: string,
  ) => {
    if (!weekDays || !selectedIsoWeek) {
      return;
    }

    const updatedWeekDays = weekDays.map((day) =>
      day.day === dayName
        ? {
            ...day,
            [mealKey]: value || "LIBRE",
          }
        : day,
    );

    setWeekDays(updatedWeekDays);
    saveWeekWithSupabaseSync(updatedWeekDays, {
      isoYear: selectedIsoWeek.isoYear,
      isoWeek: selectedIsoWeek.isoWeek,
      replaceExisting: true,
    });
  };

  return (
    <main
      className={`${pageShellClass} px-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pt-6`}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 sm:gap-5">
        <section className="sticky top-0 z-30 -mx-3 border-b border-[color:var(--color-border)] bg-[color:var(--color-background)]/95 px-3 pb-3 pt-3 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="space-y-2.5">
            <div>
              <p className="ui-eyebrow text-[0.78rem]">Plan semanal</p>
              <div className="mt-1 flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h1 className="text-2xl font-semibold leading-tight text-[color:var(--color-foreground)] sm:text-3xl">
                    {selectedIsoWeek
                      ? formatWeekTitle(selectedIsoWeek)
                      : "Preparando calendario"}
                  </h1>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleNavigateWeek(-1)}
                    disabled={!selectedIsoWeek}
                    className="min-h-8 rounded-[var(--radius-input)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2.5 text-xs font-semibold text-[color:var(--color-muted-foreground)] shadow-[0_8px_20px_rgba(32,28,23,0.04)] transition-colors hover:border-[color:var(--color-border-strong)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-50 sm:px-3"
                  >
                    ← Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNavigateWeek(1)}
                    disabled={!selectedIsoWeek}
                    className="min-h-8 rounded-[var(--radius-input)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2.5 text-xs font-semibold text-[color:var(--color-muted-foreground)] shadow-[0_8px_20px_rgba(32,28,23,0.04)] transition-colors hover:border-[color:var(--color-border-strong)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-50 sm:px-3"
                  >
                    Siguiente →
                  </button>
                </div>
              </div>
              {selectedIsoWeek && currentIsoWeek && !isCurrentWeek ? (
                <div className="mt-1.5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setSelectedIsoWeek(currentIsoWeek)}
                    className="min-h-7 rounded-[var(--radius-input)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2.5 text-[0.68rem] font-semibold text-[color:var(--color-muted-foreground)] shadow-[0_8px_20px_rgba(32,28,23,0.04)] transition-colors hover:border-[color:var(--color-border-strong)] hover:text-[color:var(--color-foreground)] sm:text-[0.72rem]"
                  >
                    Volver a semana actual
                  </button>
                </div>
              ) : null}
            </div>

            {selectedIsoWeek ? (
              <div
                className="grid grid-cols-5 gap-1"
                aria-label="Semanas cercanas"
              >
                {nearbyIsoWeeks.map((isoWeek) => {
                  const isSelected = isSameIsoWeek(isoWeek, selectedIsoWeek);
                  const isCurrent =
                    currentIsoWeek && isSameIsoWeek(isoWeek, currentIsoWeek);
                  const hasMenu = weeksWithMenu.has(getIsoWeekKey(isoWeek));

                  return (
                    <button
                      key={getIsoWeekKey(isoWeek)}
                      type="button"
                      onClick={() => setSelectedIsoWeek(isoWeek)}
                      aria-pressed={isSelected}
                      className={`min-h-10 rounded-[var(--radius-input)] border px-1.5 py-1 text-center transition-colors ${
                        isSelected
                          ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] text-[color:var(--color-foreground)]"
                          : "border-[color:var(--color-border)] bg-[color:var(--color-surface)]/70 text-[color:var(--color-muted-foreground)] hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-surface)] hover:text-[color:var(--color-foreground)]"
                      }`}
                    >
                      <span className="block text-[0.74rem] font-semibold leading-none sm:text-[0.82rem]">
                        S{isoWeek.isoWeek}
                      </span>
                      <span className="mt-1.5 flex h-1.5 items-center justify-center gap-1">
                        <span
                          aria-label={hasMenu ? "Con menú" : "Sin menú"}
                          className={`h-1.5 w-1.5 rounded-full ${
                            hasMenu
                              ? "bg-[color:var(--color-success)]"
                              : "bg-transparent"
                          }`}
                        />
                        {isCurrent ? (
                          <span
                            aria-label="Semana actual"
                            className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-warning)]"
                          />
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {weekDays ? (
              <DaySelector
                ariaLabel="Selecciona un día de la semana"
                availableDays={availableDayNames}
                selectedDayName={selectedDayName}
                onSelectDay={setSelectedDayName}
              />
            ) : null}
          </div>
        </section>

        <section>
          {selectedDay ? (
            <SelectedDayCard
              key={`${selectedIsoWeek?.isoYear}-${selectedIsoWeek?.isoWeek}-${selectedDay.day}`}
              day={selectedDay}
              onMealChange={handleMealChange}
            />
          ) : (
            <div className="rounded-[var(--radius-card)] border border-dashed border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] p-6 text-center">
              <p className="text-base font-semibold text-[color:var(--color-foreground)]">
                {isLoadingWeek
                  ? "Cargando esta semana..."
                  : "No hay menú para esta semana"}
              </p>
              {!isLoadingWeek && selectedIsoWeek ? (
                <Link
                  href={buildCreateMenuHref(selectedIsoWeek)}
                  className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-[color:var(--color-accent)] px-5 text-sm font-semibold text-white shadow-[var(--shadow-card)]"
                >
                  Crear menú
                </Link>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default function WeekPage() {
  return (
    <Suspense fallback={null}>
      <WeekPageContent />
    </Suspense>
  );
}
