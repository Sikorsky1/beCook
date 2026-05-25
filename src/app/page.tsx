"use client";

import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import {
  DaySelector,
  getInitialSelectedDayName,
  type DayName,
} from "@/components/features/DaySelector";
import { SelectedDayCard } from "@/components/features/SelectedDayCard";
import { mockWeek, type MealKey, type WeekDay } from "@/data/mockWeek";
import type { SupabaseMealSlot, SupabaseWeek } from "@/lib/supabase/weeks";
import { pageShellClass } from "@/lib/ui";
import { readSavedWeek, saveWeek } from "@/lib/weekStorage";

const datesByDayName: Record<string, string> = {
  Lunes: "31 mar",
  Martes: "1 abr",
  Miércoles: "2 abr",
  Jueves: "3 abr",
  Viernes: "4 abr",
  Sábado: "5 abr",
  Domingo: "6 abr",
};

function supabaseMealSlotToWeekMeal(slot: SupabaseMealSlot) {
  return slot.status === "free" ? "LIBRE" : slot.dishName;
}

function supabaseWeekToWeekDays(week: SupabaseWeek): WeekDay[] {
  return week.days.map((day) => ({
    day: day.dayName,
    date: datesByDayName[day.dayName] ?? "",
    lunch: supabaseMealSlotToWeekMeal(day.lunch),
    dinner: supabaseMealSlotToWeekMeal(day.dinner),
  }));
}

export default function Home() {
  const [weekDays, setWeekDays] = useState<WeekDay[]>(mockWeek.days);
  const [selectedDayName, setSelectedDayName] = useState<DayName>("Lunes");
  const availableDayNames = useMemo(
    () => new Set(weekDays.map((day) => day.day)),
    [weekDays],
  );
  const selectedDay = useMemo(
    () => weekDays.find((day) => day.day === selectedDayName) ?? null,
    [selectedDayName, weekDays],
  );

  useEffect(() => {
    // Cargamos la semana guardada solo después del primer render para evitar hydration mismatch.
    let isCancelled = false;

    const loadWeek = window.setTimeout(() => {
      void loadInitialWeek();
    }, 0);

    async function loadInitialWeek() {
      const savedWeek = readSavedWeek();

      if (savedWeek) {
        setWeekDays(savedWeek);

        if (!savedWeek.some((day) => day.day === "Lunes")) {
          setSelectedDayName(getInitialSelectedDayName(savedWeek));
        }

        return;
      }

      try {
        const { getLatestWeekFromSupabase } = await import(
          "@/lib/supabase/weeks"
        );
        const latestWeek = await getLatestWeekFromSupabase();

        if (!latestWeek || isCancelled) {
          return;
        }

        const restoredWeek = supabaseWeekToWeekDays(latestWeek);

        if (restoredWeek.length === 0) {
          return;
        }

        setWeekDays(restoredWeek);
        saveWeek(restoredWeek);

        if (!restoredWeek.some((day) => day.day === "Lunes")) {
          setSelectedDayName(getInitialSelectedDayName(restoredWeek));
        }
      } catch (error: unknown) {
        console.warn(
          "No se pudo recuperar la última semana desde Supabase:",
          error instanceof Error ? error.message : error,
        );
      }
    }

    return () => {
      isCancelled = true;
      window.clearTimeout(loadWeek);
    };
  }, []);

  const handleMealChange = (
    dayName: string,
    mealKey: MealKey,
    value: string,
  ) => {
    const updatedWeekDays = weekDays.map((day) =>
      day.day === dayName
        ? {
            ...day,
            [mealKey]: value || "LIBRE",
          }
        : day,
    );

    setWeekDays(updatedWeekDays);
    saveWeek(updatedWeekDays);
  };

  return (
    <main className={`${pageShellClass} px-3 py-3 sm:px-6 sm:py-6`}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 sm:gap-5">
        <section className="sticky top-0 z-30 -mx-3 border-b border-[color:var(--color-border)] bg-[color:var(--color-background)]/95 px-3 pb-3 pt-3 backdrop-blur sm:-mx-6 sm:px-6">
          <AppHeader sticky={false} />

          <div className="mt-4 border-t border-[color:var(--color-border)] pt-3">
            <p className="ui-eyebrow text-[0.78rem]">Plan semanal</p>
            <div className="mt-3">
              <DaySelector
                ariaLabel="Selecciona un día de la semana"
                availableDays={availableDayNames}
                selectedDayName={selectedDayName}
                onSelectDay={setSelectedDayName}
              />
            </div>
          </div>
        </section>

        <section>
          {selectedDay ? (
            <SelectedDayCard
              key={selectedDay.day}
              day={selectedDay}
              onMealChange={handleMealChange}
            />
          ) : (
            <div className="rounded-[var(--radius-card)] border border-dashed border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] p-6 text-sm font-medium text-[color:var(--color-muted-foreground)]">
              No hay comidas guardadas para este día.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
