"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import { WeekDayCard } from "@/components/features/WeekDayCard";
import { useIdentity } from "@/components/session/IdentityProvider";
import { SyncNotice, type SyncState } from "@/components/session/SyncNotice";
import { type MealKey, type WeekDay } from "@/data/mockWeek";
import {
  addIsoWeeks,
  formatIsoWeekTitle,
  getDayPosition,
  getIsoWeekDays,
  getMadridToday,
  isSameIsoWeek,
  type IsoWeek,
} from "@/lib/isoWeek";
import {
  loadWeek,
  readCachedWeek,
  readSelectedWeek,
  saveWeek,
  writeSelectedWeek,
} from "@/lib/data/repositories";
import { pageShellClass } from "@/lib/ui";
import { buildWeekHref, resolveWeekSelection } from "@/lib/weekSelection";
import { withWeekDates } from "@/lib/weekStorage";

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const weekParam = searchParams.get("week");
  const isoYearParam = searchParams.get("isoYear");
  const isoWeekParam = searchParams.get("isoWeek");
  const [today, setToday] = useState<ReturnType<typeof getMadridToday> | null>(null);
  const [weekNotice, setWeekNotice] = useState<string | null>(null);
  const [selectedIsoWeek, setSelectedIsoWeek] = useState<IsoWeek | null>(null);
  const [weekDays, setWeekDays] = useState<WeekDay[] | null>(null);
  const [isLoadingWeek, setIsLoadingWeek] = useState(true);
  const [syncState, setSyncState] = useState<SyncState>({});
  const identity = useIdentity();
  const isSignedIn = identity.userId !== null;
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);

  const isCurrentWeek =
    selectedIsoWeek && today ? isSameIsoWeek(selectedIsoWeek, today.week) : false;
  const todayIndex = isCurrentWeek && today ? today.position : null;
  // Partial weeks only have cards for some days; the strip only jumps to those.
  const presentPositions = useMemo(
    () => new Set((weekDays ?? []).map((day) => getDayPosition(day.day))),
    [weekDays],
  );
  const firstPresentPosition = weekDays?.length ? getDayPosition(weekDays[0].day) : 0;
  const effectiveActiveDay =
    activeDay ??
    (todayIndex !== null && presentPositions.has(todayIndex) ? todayIndex : firstPresentPosition);
  const weekDayNumbers = useMemo(
    () => (selectedIsoWeek ? getIsoWeekDays(selectedIsoWeek).map((day) => day.dayOfMonth) : null),
    [selectedIsoWeek],
  );

  useEffect(() => {
    // The URL is the selected week. The scoped preference (B1) and today only fill a missing
    // parameter; an invalid one is replaced with an explicit notice. Deferred: «today» is only
    // known in the browser, and the preference belongs to the current identity.
    if (identity.status !== "ready") {
      return;
    }

    const dataIdentity = { scope: identity.scope, userId: identity.userId };
    const timer = window.setTimeout(() => {
      const madridToday = getMadridToday();
      setToday(madridToday);

      const selection = resolveWeekSelection({
        weekParam,
        isoYearParam,
        isoWeekParam,
        preference: readSelectedWeek(dataIdentity),
        today: madridToday.week,
      });

      if (selection.notice) {
        setWeekNotice(selection.notice);
      }

      if (selection.needsReplace) {
        router.replace(buildWeekHref("/week", selection.week), { scroll: false });
        return;
      }

      setSelectedIsoWeek((currentWeek) =>
        currentWeek && isSameIsoWeek(selection.week, currentWeek)
          ? currentWeek
          : selection.week,
      );
    }, 0);

    return () => window.clearTimeout(timer);
  }, [router, weekParam, isoWeekParam, isoYearParam, identity.status, identity.scope, identity.userId]);

  useEffect(() => {
    // Identity first: nothing is read until we know whose data this is.
    if (!selectedIsoWeek || identity.status !== "ready") {
      return;
    }

    let isCancelled = false;
    const weekToLoad = selectedIsoWeek;
    const dataIdentity = { scope: identity.scope, userId: identity.userId };

    async function loadSelectedWeek() {
      setIsLoadingWeek(true);
      setSyncState({});
      writeSelectedWeek(dataIdentity, weekToLoad);

      // Fast paint from this identity's cache; signed-in users are then revalidated.
      const cachedWeek = readCachedWeek(dataIdentity, weekToLoad);
      setWeekDays(cachedWeek ? withWeekDates(cachedWeek, weekToLoad) : null);

      const result = await loadWeek(dataIdentity, weekToLoad);

      if (isCancelled) {
        return;
      }

      setWeekDays(result.data?.length ? withWeekDates(result.data, weekToLoad) : null);
      setSyncState({
        offline: result.offline,
        discardedLocalChanges: result.discardedLocalChanges,
        pending: result.pending,
      });
      setIsLoadingWeek(false);
    }

    void loadSelectedWeek();

    return () => {
      isCancelled = true;
    };
    // epoch: any sign-in, sign-out or user switch reloads with the new identity.
  }, [selectedIsoWeek, identity.status, identity.scope, identity.userId, identity.epoch]);

  // Navigation goes through the URL, so the week is shareable and survives a reload.
  const goToWeek = (isoWeek: IsoWeek) => {
    setActiveDay(null);
    setWeekNotice(null);
    router.push(buildWeekHref("/week", isoWeek), { scroll: false });
  };

  const handleNavigateWeek = (offset: number) => {
    if (selectedIsoWeek) {
      goToWeek(addIsoWeeks(selectedIsoWeek, offset));
    }
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
    const dataIdentity = { scope: identity.scope, userId: identity.userId };
    const weekToSave = selectedIsoWeek;
    void saveWeek(dataIdentity, weekToSave, updatedWeekDays).then((result) => {
      if (result.status === "conflict") {
        setWeekDays(result.remoteData?.length ? withWeekDates(result.remoteData, weekToSave) : null);
        setSyncState({ conflict: true });
      } else {
        setSyncState(result.status === "pending" ? { pending: true } : {});
      }
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
              <h1
                aria-label={selectedIsoWeek ? formatIsoWeekTitle(selectedIsoWeek) : undefined}
                className="t-h1 min-w-0 flex-1 text-balance text-[color:var(--color-foreground)]"
              >
                {selectedIsoWeek ? (
                  <>
                    <span className="sm:hidden">
                      {formatIsoWeekTitle(selectedIsoWeek, { compact: true })}
                    </span>
                    <span className="hidden sm:inline">
                      {formatIsoWeekTitle(selectedIsoWeek)}
                    </span>
                  </>
                ) : (
                  "Preparando calendario"
                )}
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
              ) : selectedIsoWeek && today ? (
                <button
                  type="button"
                  onClick={() => goToWeek(today.week)}
                  className="min-h-11 rounded-[var(--radius-input)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-xs font-semibold text-[color:var(--color-muted-foreground)] shadow-[0_8px_20px_rgba(32,28,23,0.04)] transition-colors hover:border-[color:var(--color-border-strong)] hover:text-[color:var(--color-foreground)]"
                >
                  ↩ Volver a hoy
                </button>
              ) : (
                <span />
              )}
              {weekDays && selectedIsoWeek ? (
                <Link
                  href={buildWeekHref("/create-menu", selectedIsoWeek)}
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
                  const hasCard = presentPositions.has(index);
                  const isActive = hasCard && effectiveActiveDay === index;
                  const isTodayCell = todayIndex === index;

                  return (
                    <button
                      key={day.name}
                      type="button"
                      onClick={() => handleSelectDay(index)}
                      disabled={!hasCard}
                      aria-label={`${day.name} ${weekDayNumbers[index]}${hasCard ? "" : ", sin menú"}`}
                      aria-current={isActive ? "true" : undefined}
                      className={`flex min-h-11 flex-col items-center justify-center rounded-xl border transition-colors disabled:cursor-default disabled:opacity-45 ${
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

        {weekNotice ? (
          <p
            role="status"
            className="rounded-[var(--radius-control)] border border-[color:var(--color-warning)] bg-[color:var(--color-warning-soft)] px-4 py-3 text-sm leading-6 text-[#8a4e2a]"
          >
            {weekNotice}
          </p>
        ) : null}

        {isSignedIn ? <SyncNotice state={syncState} /> : null}

        <section>
          {weekDays ? (
            <div className="flex flex-col gap-2.5">
              {weekDays.map((day) => (
                <div
                  key={`${selectedIsoWeek?.isoYear}-${selectedIsoWeek?.isoWeek}-${day.day}`}
                  id={`week-day-${getDayPosition(day.day)}`}
                  className="scroll-mt-[172px]"
                >
                  <WeekDayCard
                    day={day}
                    isToday={todayIndex !== null && getDayPosition(day.day) === todayIndex}
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
                  href={buildWeekHref("/create-menu", selectedIsoWeek)}
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
