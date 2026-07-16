"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import { WeekDayCard } from "@/components/features/WeekDayCard";
import { type MealKey, type WeekDay } from "@/data/mockWeek";
import {
  addIsoWeeks,
  formatDateForQuery,
  formatIsoWeekRange,
  getIsoWeekFromDate,
  getIsoWeekRange,
  getIsoWeekStartDate,
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
  return formatIsoWeekRange(isoWeek).replace("-", "–");
}

function formatTodayLabel() {
  const today = new Date();

  return `${today.getDate()} ${today.toLocaleDateString("es-ES", {
    month: "short",
  })}`;
}

const dayStrip = [
  { name: "Lunes", initial: "L" },
  { name: "Martes", initial: "M" },
  { name: "Miércoles", initial: "X" },
  { name: "Jueves", initial: "J" },
  { name: "Viernes", initial: "V" },
  { name: "Sábado", initial: "S" },
  { name: "Domingo", initial: "D" },
] as const;

function WeekPageContent() {
  const searchParams = useSearchParams();
  const isoYearParam = searchParams.get("isoYear");
  const isoWeekParam = searchParams.get("isoWeek");
  const [currentIsoWeek, setCurrentIsoWeek] = useState<IsoWeek | null>(null);
  const [selectedIsoWeek, setSelectedIsoWeek] = useState<IsoWeek | null>(null);
  const [weekDays, setWeekDays] = useState<WeekDay[] | null>(null);
  const [isLoadingWeek, setIsLoadingWeek] = useState(true);
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);

  const isCurrentWeek =
    selectedIsoWeek && currentIsoWeek
      ? isSameIsoWeek(selectedIsoWeek, currentIsoWeek)
      : false;
  const todayLabel = isCurrentWeek ? formatTodayLabel() : null;
  const todayIndex = isCurrentWeek ? (new Date().getDay() + 6) % 7 : null;
  const effectiveActiveDay = activeDay ?? todayIndex ?? 0;
  const weekDayNumbers = useMemo(() => {
    if (!selectedIsoWeek) {
      return null;
    }

    const startDate = getIsoWeekStartDate(selectedIsoWeek);

    return dayStrip.map((_, index) => {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + index);

      return date.getDate();
    });
  }, [selectedIsoWeek]);

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
      } else {
        setWeekDays(null);
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
          }

          return;
        }

        const restoredWeek = supabaseWeekToWeekDays(remoteWeek, weekToLoad);

        if (restoredWeek.length === 0) {
          setWeekDays(null);
          return;
        }

        setWeekDays(restoredWeek);
        saveWeek(restoredWeek, weekToLoad);
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

  const handleNavigateWeek = (offset: number) => {
    if (!selectedIsoWeek) {
      return;
    }

    setActiveDay(null);
    setSelectedIsoWeek((currentWeek) =>
      currentWeek ? addIsoWeeks(currentWeek, offset) : currentWeek,
    );
  };

  const handleSelectDay = (dayIndex: number) => {
    setActiveDay(dayIndex);

    const dayCard = document.getElementById(`week-day-${dayIndex}`);

    if (!dayCard) {
      return;
    }

    const headerOffset = (headerRef.current?.offsetHeight ?? 164) + 8;
    const top =
      dayCard.getBoundingClientRect().top + window.pageYOffset - headerOffset;

    window.scrollTo({ top, behavior: "smooth" });
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
        <section
          ref={headerRef}
          className="sticky top-0 z-30 -mx-3 border-b border-[color:var(--color-border)] bg-[color:var(--color-background)]/90 px-3 pb-3 pt-3 backdrop-blur sm:-mx-6 sm:px-6"
        >
          <div>
            <p className="t-eyebrow">Plan semanal</p>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <h1 className="t-h1 min-w-0 flex-1 truncate text-[color:var(--color-foreground)]">
                {selectedIsoWeek
                  ? formatWeekTitle(selectedIsoWeek)
                  : "Preparando calendario"}
              </h1>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleNavigateWeek(-1)}
                  disabled={!selectedIsoWeek}
                  aria-label="Semana anterior"
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-input)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-base font-semibold text-[color:var(--color-muted-foreground)] shadow-[0_8px_20px_rgba(32,28,23,0.04)] transition-colors hover:border-[color:var(--color-border-strong)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigateWeek(1)}
                  disabled={!selectedIsoWeek}
                  aria-label="Semana siguiente"
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-input)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-base font-semibold text-[color:var(--color-muted-foreground)] shadow-[0_8px_20px_rgba(32,28,23,0.04)] transition-colors hover:border-[color:var(--color-border-strong)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  ›
                </button>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              {isCurrentWeek ? (
                <span className="text-xs font-semibold text-[color:var(--color-muted-foreground)]">
                  Semana actual
                </span>
              ) : selectedIsoWeek && currentIsoWeek ? (
                <button
                  type="button"
                  onClick={() => {
                    setActiveDay(null);
                    setSelectedIsoWeek(currentIsoWeek);
                  }}
                  className="min-h-11 rounded-[var(--radius-input)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-xs font-semibold text-[color:var(--color-muted-foreground)] shadow-[0_8px_20px_rgba(32,28,23,0.04)] transition-colors hover:border-[color:var(--color-border-strong)] hover:text-[color:var(--color-foreground)]"
                >
                  ↩ Volver a hoy
                </button>
              ) : (
                <span />
              )}
              {weekDays && selectedIsoWeek ? (
                <Link
                  href={buildCreateMenuHref(selectedIsoWeek)}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-[color:var(--color-accent)] bg-[color:var(--color-accent)] px-4 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(46,42,38,0.04)] transition-colors hover:border-[color:var(--color-accent-hover)] hover:bg-[color:var(--color-accent-hover)]"
                >
                  Editar menú
                </Link>
              ) : null}
            </div>

            {selectedIsoWeek && weekDayNumbers ? (
              <div
                className="mt-2.5 grid grid-cols-7 gap-1.5"
                role="group"
                aria-label="Ir a un día de la semana"
              >
                {dayStrip.map((day, index) => {
                  const isActive = effectiveActiveDay === index;
                  const isTodayCell = todayIndex === index;

                  return (
                    <button
                      key={day.name}
                      type="button"
                      onClick={() => handleSelectDay(index)}
                      aria-label={`${day.name} ${weekDayNumbers[index]}`}
                      aria-current={isActive ? "true" : undefined}
                      className={`flex min-h-11 flex-col items-center justify-center rounded-xl border transition-colors ${
                        isActive
                          ? "border-[color:var(--color-secondary)] bg-[color:var(--color-secondary)] text-white"
                          : isTodayCell
                            ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] text-[color:var(--color-foreground)]"
                            : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-foreground)] hover:border-[color:var(--color-border-strong)]"
                      }`}
                    >
                      <span className="text-[0.82rem] font-bold leading-none">
                        {day.initial}
                      </span>
                      <span className="mt-0.5 text-[0.62rem] font-semibold leading-none opacity-75">
                        {weekDayNumbers[index]}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </section>

        <section>
          {weekDays ? (
            <div className="flex flex-col gap-2.5">
              {weekDays.map((day, index) => (
                <div
                  key={`${selectedIsoWeek?.isoYear}-${selectedIsoWeek?.isoWeek}-${day.day}`}
                  id={`week-day-${index}`}
                  className="scroll-mt-[172px]"
                >
                  <WeekDayCard
                    day={day}
                    isToday={todayLabel === day.date}
                    onMealChange={handleMealChange}
                  />
                </div>
              ))}
            </div>
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
