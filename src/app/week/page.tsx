"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import { DishCard } from "@/components/features/DishCard";
import { dishCardRestrictions } from "@/lib/recipes/dishCardFlow";
import { type RequestDishIdea, WeekDayCard } from "@/components/features/WeekDayCard";
import { useIdentity } from "@/components/session/IdentityProvider";
import { OnboardingGate } from "@/components/session/OnboardingGate";
import { SyncNotice, type SyncState } from "@/components/session/SyncNotice";
import { SyncStatus } from "@/components/session/SyncStatus";
import { StateMessage } from "@/components/ui/StateMessage";
import { type MealKey, type WeekDay } from "@/data/mockWeek";
import {
  addIsoWeeks,
  formatIsoWeekTitle,
  getDayPosition,
  getIsoWeekDays,
  getIsoWeekStorageId,
  getMadridToday,
  isSameIsoWeek,
  type IsoWeek,
} from "@/lib/isoWeek";
import { resolveApplyWeekAttempt, type ApplyWeekAttempt } from "@/lib/applyWeek";
import { nextCatalogIdea, requestAiIdea } from "@/lib/dishSubstitution";
import { foodContextChangeNotice, type WeekFoodContextStatus } from "@/lib/menu-generation/food-context";
import {
  loadProfile,
  loadWeek,
  loadWeekFoodContext,
  newRequestKey,
  readCachedWeek,
  readSelectedWeek,
  saveWeekSlot,
  writeSelectedWeek,
} from "@/lib/data/repositories";
import { createMenuImportHref } from "@/lib/navigation";
import { hasPlannedMeals, repeatPreviousWeek, type RepeatWeekResult } from "@/lib/repeatWeek";
import { pageShellClass } from "@/lib/ui";
import { buildWeekHref, resolveWeekSelection } from "@/lib/weekSelection";
import { withWeekDates } from "@/lib/weekStorage";
import {
  getDayStripCells,
  getWeekTodayLayout,
  nextMadridToday,
  selectedPositionFor,
  type DaySelection,
} from "@/lib/weekToday";

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
  // Dish edits on their way to the account, and «Reintentar» (reads the week again, which resends
  // what is pending on this device; never the AI).
  const [savingMeals, setSavingMeals] = useState(0);
  const [reloadCount, setReloadCount] = useState(0);
  // Week and identity of the last read: reading the same one again keeps its known state.
  const lastLoadRef = useRef<string | null>(null);
  const identity = useIdentity();
  const isSignedIn = identity.userId !== null;
  const [daySelection, setDaySelection] = useState<DaySelection>(null);
  // Restrictions for «Otra idea»; always this identity's profile (B1). Until it has been read
  // for the current identity, no idea is offered (an empty profile would skip allergies).
  const profileKey = `${identity.scope}:${identity.epoch}`;
  const [profileEntry, setProfileEntry] = useState<{ key: string; data: unknown } | null>(null);
  // C1: the food context this week was planned with, compared with the profile now.
  const [foodContextEntry, setFoodContextEntry] = useState<{ key: string; status: WeekFoodContextStatus | null } | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  // C2: the dish card open (one meal), and «Cambiar plato» handed to that day's editor.
  const [dishCardSlot, setDishCardSlot] = useState<{ day: string; meal: MealKey } | null>(null);
  const [dishEditRequest, setDishEditRequest] = useState<{ day: string; meal: MealKey; key: number } | null>(null);
  // Step 32: the previous week, read only when this one is empty, for «Repetir la semana N».
  const [previousWeekEntry, setPreviousWeekEntry] = useState<{ key: string; days: WeekDay[] | null } | null>(null);
  const [repeatNotice, setRepeatNotice] = useState<{ id: number; weekId: string; status: RepeatWeekResult["status"]; message: string } | null>(null);
  const repeatNoticeRef = useRef<HTMLParagraphElement | null>(null);
  // Identity and week of the last completed read: the empty state (and the read of the previous
  // week) only follow a read of the week that is selected now, never a stale one.
  const [loadedWeekKey, setLoadedWeekKey] = useState<string | null>(null);
  const [isRepeating, setIsRepeating] = useState(false);
  const isRepeatingRef = useRef(false);
  const repeatAttemptRef = useRef<ApplyWeekAttempt<WeekDay[]> | null>(null);

  const isCurrentWeek =
    selectedIsoWeek && today ? isSameIsoWeek(selectedIsoWeek, today.week) : false;
  const layout = useMemo(
    () => (weekDays && selectedIsoWeek ? getWeekTodayLayout(weekDays, selectedIsoWeek, today) : null),
    [weekDays, selectedIsoWeek, today],
  );
  const todayIndex = isCurrentWeek && today ? today.position : null;
  // Partial weeks only have cards for some days; the strip only jumps to those.
  const presentPositions = useMemo(
    () => new Set((weekDays ?? []).map((day) => getDayPosition(day.day))),
    [weekDays],
  );
  const stripCells = getDayStripCells(
    presentPositions,
    todayIndex,
    selectedIsoWeek ? selectedPositionFor(daySelection, selectedIsoWeek) : null,
  );
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
    // A page left open overnight shows the new «Hoy» when it is looked at again.
    const refreshToday = () => {
      if (document.visibilityState === "visible") {
        setToday((current) => (current ? nextMadridToday(current, getMadridToday()) : current));
      }
    };

    document.addEventListener("visibilitychange", refreshToday);
    window.addEventListener("focus", refreshToday);

    return () => {
      document.removeEventListener("visibilitychange", refreshToday);
      window.removeEventListener("focus", refreshToday);
    };
  }, []);

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
      // «Reintentar» on the same week: what is pending stays visible until the account answers.
      const loadKey = `${dataIdentity.scope}:${identity.epoch}:${getIsoWeekStorageId(weekToLoad)}`;
      const isSameLoad = lastLoadRef.current === loadKey;
      lastLoadRef.current = loadKey;
      setSyncState((current) => (isSameLoad ? { pending: current.pending, offline: current.offline } : {}));
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
      setLoadedWeekKey(loadKey);
      setIsLoadingWeek(false);
    }

    void loadSelectedWeek();

    return () => {
      isCancelled = true;
    };
    // epoch: any sign-in, sign-out or user switch reloads with the new identity.
  }, [selectedIsoWeek, identity.status, identity.scope, identity.userId, identity.epoch, reloadCount]);

  useEffect(() => {
    if (identity.status !== "ready") {
      return;
    }

    let isCancelled = false;
    const dataIdentity = { scope: identity.scope, userId: identity.userId };
    const key = `${identity.scope}:${identity.epoch}`;
    void loadProfile(dataIdentity).then((result) => {
      // Signed in, unreachable and nothing cached: restrictions are unknown.
      if (!isCancelled && !(result.offline && !result.data)) setProfileEntry({ key, data: result.data ?? null });
    });

    return () => {
      isCancelled = true;
    };
  }, [identity.status, identity.scope, identity.userId, identity.epoch]);

  const foodContextKey = selectedIsoWeek
    ? `${identity.scope}:${identity.epoch}:${getIsoWeekStorageId(selectedIsoWeek)}:${reloadCount}`
    : null;

  useEffect(() => {
    if (!selectedIsoWeek || identity.status !== "ready" || !identity.userId || !foodContextKey) {
      return;
    }

    let isCancelled = false;
    void loadWeekFoodContext({ scope: identity.scope, userId: identity.userId }, selectedIsoWeek).then((status) => {
      if (!isCancelled) setFoodContextEntry({ key: foodContextKey, status });
    });

    return () => {
      isCancelled = true;
    };
  }, [selectedIsoWeek, identity.status, identity.scope, identity.userId, foodContextKey]);

  const foodContextNotice =
    weekDays && foodContextEntry?.key === foodContextKey ? foodContextChangeNotice(foodContextEntry.status) : null;

  const previousIsoWeek = selectedIsoWeek ? addIsoWeeks(selectedIsoWeek, -1) : null;
  const selectedLoadKey = selectedIsoWeek
    ? `${identity.scope}:${identity.epoch}:${getIsoWeekStorageId(selectedIsoWeek)}`
    : null;
  const isEmptyWeek = selectedLoadKey !== null && loadedWeekKey === selectedLoadKey && !isLoadingWeek && !weekDays;
  const previousWeekKey =
    isEmptyWeek && previousIsoWeek && identity.status === "ready"
      ? `${identity.scope}:${identity.epoch}:${getIsoWeekStorageId(previousIsoWeek)}`
      : null;

  useEffect(() => {
    if (!previousWeekKey || !selectedIsoWeek) {
      return;
    }

    let isCancelled = false;
    // The usual read of that week (this identity's cache for a guest, the account otherwise).
    void loadWeek({ scope: identity.scope, userId: identity.userId }, addIsoWeeks(selectedIsoWeek, -1)).then((result) => {
      if (!isCancelled) setPreviousWeekEntry({ key: previousWeekKey, days: result.data?.length ? result.data : null });
    });

    return () => {
      isCancelled = true;
    };
  }, [previousWeekKey, selectedIsoWeek, identity.scope, identity.userId]);

  const previousWeekDays =
    previousWeekEntry?.key === previousWeekKey && hasPlannedMeals(previousWeekEntry.days) ? previousWeekEntry.days : null;
  const selectedWeekId = selectedIsoWeek ? getIsoWeekStorageId(selectedIsoWeek) : null;
  const visibleRepeatNotice = repeatNotice && repeatNotice.weekId === selectedWeekId ? repeatNotice : null;

  useEffect(() => {
    // The result of «Repetir» takes the focus (the button may disappear once the week is read
    // again). It is not a live region, so it is not announced on top of SyncStatus.
    if (repeatNotice) repeatNoticeRef.current?.focus();
  }, [repeatNotice]);

  // «Repetir la semana N»: copies dishes and cards into this empty week; never replaces a menu.
  const handleRepeatPreviousWeek = async () => {
    if (!selectedIsoWeek || !previousIsoWeek || !previousWeekDays || isRepeatingRef.current) {
      return;
    }

    isRepeatingRef.current = true;
    setIsRepeating(true);
    const weekId = getIsoWeekStorageId(selectedIsoWeek);
    // Same copy and week → same attempt and request key, so a resend is applied only once.
    const attempt = resolveApplyWeekAttempt(repeatAttemptRef.current, previousWeekDays, weekId, newRequestKey);
    repeatAttemptRef.current = attempt;
    const result = await repeatPreviousWeek({
      identity: { scope: identity.scope, userId: identity.userId },
      isoWeek: selectedIsoWeek,
      previousWeek: previousIsoWeek,
      previousDays: previousWeekDays,
      attempt,
    });

    if (result.attempt === "discard") {
      repeatAttemptRef.current = null;
    }
    setRepeatNotice({ id: Date.now(), weekId, status: result.status, message: result.message });
    if (result.reload) {
      setReloadCount((count) => count + 1);
    }
    isRepeatingRef.current = false;
    setIsRepeating(false);
  };

  // «Otra idea»: reviewed catalogue first (free); AI only when the user asks after it runs out.
  const handleRequestIdea: RequestDishIdea = (dayName, mealKey, rejected, mode, signal) => {
    if (!weekDays) {
      return { status: "error", message: "Carga la semana antes de pedir otra idea." };
    }

    if (profileEntry?.key !== profileKey) {
      return { status: "error", message: "Aún no hemos podido leer tu perfil. Inténtalo en unos segundos." };
    }

    const profile = profileEntry.data;

    const slot = { day: dayName, meal: mealKey };

    if (mode === "catalog") {
      const result = nextCatalogIdea(weekDays, slot, rejected, profile);
      return result.status === "catalog_exhausted" && !isSignedIn ? { status: "login_required" } : result;
    }

    return requestAiIdea(weekDays, slot, rejected, profile, signal);
  };

  // Navigation goes through the URL, so the week is shareable and survives a reload.
  const goToWeek = (isoWeek: IsoWeek) => {
    setDaySelection(null);
    setWeekNotice(null);
    setRepeatNotice(null);
    router.push(buildWeekHref("/week", isoWeek), { scroll: false });
  };

  const handleNavigateWeek = (offset: number) => {
    if (selectedIsoWeek) {
      goToWeek(addIsoWeeks(selectedIsoWeek, offset));
    }
  };

  const handleSelectDay = (dayIndex: number) => {
    if (selectedIsoWeek) {
      setDaySelection({ weekId: getIsoWeekStorageId(selectedIsoWeek), position: dayIndex });
    }

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
    setSavingMeals((count) => count + 1);
    // Only this meal is written, and only if the account week has not changed meanwhile.
    void saveWeekSlot(dataIdentity, weekToSave, updatedWeekDays, { day: dayName, meal: mealKey }).then(async (result) => {
      setSavingMeals((count) => count - 1);
      if (result.status === "conflict") {
        // The account wins: show its week (read again if the conflict response could not include it).
        const remoteDays = result.remoteData ?? (await loadWeek(dataIdentity, weekToSave)).data;
        setWeekDays(remoteDays?.length ? withWeekDates(remoteDays, weekToSave) : null);
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
                <span className="text-sm font-semibold text-[color:var(--color-muted-foreground)]">
                  Semana actual
                </span>
              ) : selectedIsoWeek && today ? (
                <button
                  type="button"
                  onClick={() => goToWeek(today.week)}
                  className="min-h-11 rounded-[var(--radius-input)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-sm font-semibold text-[color:var(--color-muted-foreground)] shadow-[0_8px_20px_rgba(32,28,23,0.04)] transition-colors hover:border-[color:var(--color-border-strong)] hover:text-[color:var(--color-foreground)]"
                >
                  <span aria-hidden="true">↩</span> Volver a hoy
                </button>
              ) : (
                <span />
              )}
              {weekDays && selectedIsoWeek ? (
                <Link
                  href={buildWeekHref("/create-menu", selectedIsoWeek)}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-[color:var(--color-accent-strong)] bg-[color:var(--color-accent-strong)] px-4 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(46,42,38,0.04)] transition-colors hover:border-[color:var(--color-accent-strong-hover)] hover:bg-[color:var(--color-accent-strong-hover)]"
                >
                  Editar menú
                </Link>
              ) : null}
            </div>

            {selectedIsoWeek && weekDayNumbers ? (
              <div
                className="mt-2.5 grid grid-cols-7 gap-1 sm:gap-1.5"
                role="group"
                aria-label="Ir a un día de la semana"
              >
                {stripCells.map((cell) => {
                  const day = dayStrip[cell.position];
                  const dayNumber = weekDayNumbers[cell.position];

                  return (
                    <button
                      key={day.name}
                      type="button"
                      onClick={() => handleSelectDay(cell.position)}
                      disabled={!cell.hasMenu}
                      aria-label={`${day.name} ${dayNumber}${cell.isToday ? ", hoy" : ""}${cell.hasMenu ? "" : ", sin menú"}`}
                      aria-current={cell.isToday ? "date" : undefined}
                      aria-pressed={cell.hasMenu ? cell.isSelected : undefined}
                      className={`flex min-h-11 flex-col items-center justify-center rounded-xl border-2 transition-colors disabled:cursor-default disabled:opacity-45 ${
                        cell.isToday
                          ? "bg-[color:var(--color-accent-strong)] text-white"
                          : "bg-[color:var(--color-surface)] text-[color:var(--color-foreground)]"
                      } ${
                        cell.isSelected
                          ? "border-[color:var(--color-foreground)]"
                          : cell.isToday
                            ? "border-[color:var(--color-accent-strong)]"
                            : "border-[color:var(--color-border)] hover:border-[color:var(--color-border-strong)]"
                      }`}
                    >
                      <span className="text-sm font-bold leading-none">
                        {day.initial}
                      </span>
                      <span className="mt-1 text-xs font-semibold leading-none">
                        {dayNumber}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </section>

        <OnboardingGate />

        {weekNotice ? (
          <p
            role="status"
            className="rounded-[var(--radius-control)] border border-[color:var(--color-warning)] bg-[color:var(--color-warning-soft)] px-4 py-3 text-sm leading-6 text-[color:var(--color-warning-foreground)]"
          >
            {weekNotice}
          </p>
        ) : null}

        {visibleRepeatNotice ? (
          <p
            ref={repeatNoticeRef}
            tabIndex={-1}
            className={`rounded-[var(--radius-control)] border px-4 py-3 text-sm leading-6 ${
              visibleRepeatNotice.status === "copied"
                ? "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-foreground)]"
                : "border-[color:var(--color-warning)] bg-[color:var(--color-warning-soft)] text-[color:var(--color-warning-foreground)]"
            }`}
          >
            {visibleRepeatNotice.message}
          </p>
        ) : null}

        {weekDays || syncState.offline || syncState.pending ? (
          <SyncStatus
            signedIn={isSignedIn}
            saving={savingMeals > 0}
            checking={isLoadingWeek}
            offline={syncState.offline}
            pending={syncState.pending}
            onRetry={() => setReloadCount((count) => count + 1)}
          />
        ) : null}
        {isSignedIn ? <SyncNotice state={syncState} /> : null}

        {foodContextNotice && selectedIsoWeek ? (
          <StateMessage
            className="mt-0"
            title={foodContextNotice.title}
            variant="loading"
            action={
              <Link
                href={buildWeekHref("/create-menu", selectedIsoWeek)}
                className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 text-sm font-semibold text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)]"
              >
                Crear un menú nuevo para esta semana
              </Link>
            }
          >
            {foodContextNotice.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </StateMessage>
        ) : null}

        <section>
          <DishCard
            slot={dishCardSlot}
            weekDays={weekDays}
            identity={{ scope: identity.scope, userId: identity.userId }}
            isoWeek={selectedIsoWeek}
            weekServings={foodContextEntry?.key === foodContextKey ? (foodContextEntry.status?.frozen?.servings ?? null) : null}
            restrictions={dishCardRestrictions(
              isSignedIn,
              foodContextEntry?.key === foodContextKey ? foodContextEntry.status : undefined,
              { loaded: profileEntry?.key === profileKey, data: profileEntry?.data ?? null },
            )}
            loginReturnPath={selectedIsoWeek ? buildWeekHref("/week", selectedIsoWeek) : "/week"}
            onClose={() => setDishCardSlot(null)}
            onChangeDish={(slot) => setDishEditRequest({ ...slot, key: Date.now() })}
            onWeekChanged={(days) => setWeekDays(days?.length && selectedIsoWeek ? withWeekDates(days, selectedIsoWeek) : null)}
          />
          {weekDays && layout ? (
            <div className="flex flex-col gap-4">
              {layout.todayPosition !== null ? (
                <div id={`week-day-${layout.todayPosition}`} className="scroll-mt-[172px]">
                  {layout.todayDay ? (
                    <WeekDayCard
                      key={`${selectedIsoWeek?.isoYear}-${selectedIsoWeek?.isoWeek}-${layout.todayDay.day}`}
                      day={layout.todayDay}
                      variant="today"
                      onMealChange={handleMealChange}
                      onRequestIdea={handleRequestIdea}
                      onOpenDish={(dayName, meal) => setDishCardSlot({ day: dayName, meal })}
                      editRequest={dishEditRequest?.day === layout.todayDay.day ? dishEditRequest : null}
                      onEditRequestHandled={() => setDishEditRequest(null)}
                      loginReturnPath={selectedIsoWeek ? buildWeekHref("/week", selectedIsoWeek) : "/week"}
                    />
                  ) : (
                    <p className="rounded-[var(--radius-card)] border-2 border-dashed border-[color:var(--color-accent)] bg-[color:var(--color-surface)] px-4 py-3 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                      <span className="mr-1.5 rounded-full bg-[color:var(--color-accent-strong)] px-2.5 py-1 text-xs font-semibold text-white">
                        Hoy
                      </span>
                      No hay comidas planificadas para hoy en este menú.
                    </p>
                  )}
                </div>
              ) : null}

              {layout.otherDays.length ? (
                <div className="flex flex-col gap-2">
                  {layout.todayPosition !== null ? (
                    <h2 className="t-micro px-1">Resto de la semana</h2>
                  ) : null}
                  {layout.otherDays.map((day) => (
                    <div
                      key={`${selectedIsoWeek?.isoYear}-${selectedIsoWeek?.isoWeek}-${day.day}`}
                      id={`week-day-${getDayPosition(day.day)}`}
                      className="scroll-mt-[172px]"
                    >
                      <WeekDayCard
                        day={day}
                        variant="compact"
                        onMealChange={handleMealChange}
                        onRequestIdea={handleRequestIdea}
                        onOpenDish={(dayName, meal) => setDishCardSlot({ day: dayName, meal })}
                        editRequest={dishEditRequest?.day === day.day ? dishEditRequest : null}
                        onEditRequestHandled={() => setDishEditRequest(null)}
                        loginReturnPath={selectedIsoWeek ? buildWeekHref("/week", selectedIsoWeek) : "/week"}
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyWeekState
              isLoading={isLoadingWeek || !isEmptyWeek}
              isoWeek={selectedIsoWeek}
              previousIsoWeek={previousWeekDays ? previousIsoWeek : null}
              isRepeating={isRepeating}
              isGuest={!isSignedIn}
              onRepeat={() => void handleRepeatPreviousWeek()}
            />
          )}
        </section>
      </div>
    </main>
  );
}

// Step 32: an empty week offers three ways to fill it (guests too): create a menu (main action),
// repeat the previous week when it has dishes, or import a menu the user already has.
function EmptyWeekState({
  isLoading,
  isoWeek,
  previousIsoWeek,
  isRepeating,
  isGuest,
  onRepeat,
}: {
  isLoading: boolean;
  isoWeek: IsoWeek | null;
  previousIsoWeek: IsoWeek | null;
  isRepeating: boolean;
  isGuest: boolean;
  onRepeat: () => void;
}) {
  const secondaryClass =
    "inline-flex min-h-11 w-full items-center justify-center rounded-full border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] px-5 text-sm font-semibold text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)] sm:w-auto";

  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] p-6 text-center">
      <p className="text-base font-semibold text-[color:var(--color-foreground)]">
        {isLoading ? "Cargando esta semana..." : "No hay menú para esta semana"}
      </p>
      {!isLoading && isoWeek ? (
        <div className="mt-4 flex flex-col items-center gap-3">
          <Link
            href={buildWeekHref("/create-menu", isoWeek)}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[color:var(--color-accent-strong)] px-5 text-sm font-semibold text-white shadow-[var(--shadow-card)] transition-colors hover:bg-[color:var(--color-accent-strong-hover)] sm:w-auto"
          >
            Crear menú
          </Link>
          {previousIsoWeek ? (
            <div className="flex w-full flex-col items-center gap-1.5">
              <button
                type="button"
                onClick={onRepeat}
                // Busy, not disabled: it keeps the focus and is not dimmed; a second press is ignored.
                aria-disabled={isRepeating}
                aria-busy={isRepeating}
                aria-describedby="repeat-week-help"
                className={secondaryClass}
              >
                {isRepeating ? "Copiando…" : `Repetir la semana ${previousIsoWeek.isoWeek}`}
              </button>
              <p id="repeat-week-help" className="max-w-sm text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                Copia los platos y sus fichas de esa semana ({formatIsoWeekTitle(previousIsoWeek)}).{" "}
                {isGuest
                  ? "Se copia en este dispositivo. Para la lista de la compra, inicia sesión."
                  : "Se guarda con tu perfil actual (raciones y restricciones de hoy). La lista de la compra se prepara cuando abras Compra."}
              </p>
            </div>
          ) : null}
          <Link href={createMenuImportHref(getIsoWeekStorageId(isoWeek))} className={secondaryClass}>
            Ya tengo un menú
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export default function WeekPage() {
  return (
    <Suspense fallback={null}>
      <WeekPageContent />
    </Suspense>
  );
}
