"use client";

import {
  Check,
  Pencil,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { mockWeek, type MealKey, type WeekDay } from "@/data/mockWeek";
import {
  buttonPrimaryClass,
  pageShellClass,
  buttonSecondaryClass,
  inputClass,
} from "@/lib/ui";
import { readSavedWeek, saveWeek } from "@/lib/weekStorage";

const orderedDays = [
  { name: "Lunes", shortName: "L" },
  { name: "Martes", shortName: "M" },
  { name: "Miércoles", shortName: "X" },
  { name: "Jueves", shortName: "J" },
  { name: "Viernes", shortName: "V" },
  { name: "Sábado", shortName: "S" },
  { name: "Domingo", shortName: "D" },
] as const;

const mealLabels = [
  { key: "lunch", label: "Comida" },
  { key: "dinner", label: "Cena" },
] as const;

type DayName = (typeof orderedDays)[number]["name"];

type DaySelectorProps = {
  availableDays: Set<string>;
  selectedDayName: DayName;
  onSelectDay: (dayName: DayName) => void;
};

function DaySelector({
  availableDays,
  selectedDayName,
  onSelectDay,
}: DaySelectorProps) {
  return (
    <div
      className="grid w-full max-w-[23rem] grid-cols-7 gap-1.5 sm:gap-2"
      role="tablist"
      aria-label="Selecciona un día de la semana"
    >
      {orderedDays.map((day) => {
        const isAvailable = availableDays.has(day.name);
        const isSelected = selectedDayName === day.name;

        return (
          <button
            key={day.name}
            type="button"
            role="tab"
            aria-selected={isSelected}
            aria-label={day.name}
            disabled={!isAvailable}
            onClick={() => onSelectDay(day.name)}
            className={[
              "flex aspect-square min-h-9 w-full items-center justify-center rounded-full border text-sm font-semibold transition-colors sm:min-h-11",
              isSelected
                ? "border-[color:var(--color-foreground)] bg-[color:var(--color-foreground)] text-white shadow-[0_10px_22px_rgba(32,28,23,0.16)]"
                : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-foreground)] hover:border-[color:var(--color-border-strong)]",
              !isAvailable
                ? "cursor-not-allowed border-[color:var(--color-border)] bg-transparent text-[color:var(--color-border-strong)] opacity-45 hover:border-[color:var(--color-border)]"
                : "",
            ].join(" ")}
          >
            {day.shortName}
          </button>
        );
      })}
    </div>
  );
}

type SelectedDayCardProps = {
  day: WeekDay;
  onMealChange: (dayName: string, mealKey: MealKey, value: string) => void;
};

function SelectedDayCard({ day, onMealChange }: SelectedDayCardProps) {
  const [editingMeal, setEditingMeal] = useState<MealKey | null>(null);
  const [draftValue, setDraftValue] = useState("");

  const startEditing = (mealKey: MealKey) => {
    setEditingMeal(mealKey);
    setDraftValue(day[mealKey] === "LIBRE" ? "" : day[mealKey]);
  };

  const cancelEditing = () => {
    setEditingMeal(null);
    setDraftValue("");
  };

  const saveMeal = () => {
    if (!editingMeal) {
      return;
    }

    onMealChange(day.day, editingMeal, draftValue.trim());
    cancelEditing();
  };

  return (
    <article className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3.5 shadow-[0_18px_45px_rgba(32,28,23,0.07)] sm:p-5">
      <div className="border-b border-[color:var(--color-border)] pb-2.5">
        <h1 className="text-2xl font-semibold leading-none text-[color:var(--color-foreground)] sm:text-3xl">
          {day.day}
        </h1>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {mealLabels.map((meal) => {
          const value = day[meal.key];
          const isFree = value === "LIBRE";
          const isEditing = editingMeal === meal.key;

          return (
            <section
              key={meal.key}
              className="min-h-[126px] rounded-2xl border border-[color:var(--color-border)] bg-white p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-[color:var(--color-muted-foreground)]">
                  {meal.label}
                </h2>
                {isFree ? (
                  <span className="rounded-full bg-[color:var(--color-success-soft)] px-2.5 py-1 text-xs font-semibold text-[color:var(--color-muted-foreground)]">
                    Libre
                  </span>
                ) : null}
              </div>

              {isEditing ? (
                <div className="mt-2.5 space-y-2.5">
                  <input
                    type="text"
                    value={draftValue}
                    onChange={(event) => setDraftValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        saveMeal();
                      }

                      if (event.key === "Escape") {
                        cancelEditing();
                      }
                    }}
                    autoFocus
                    placeholder={`Escribe la ${meal.label.toLowerCase()}`}
                    className={`${inputClass} py-2.5`}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={saveMeal}
                      aria-label={`Guardar ${meal.label.toLowerCase()}`}
                      className={`${buttonPrimaryClass} min-h-9 px-3`}
                    >
                      <Check aria-hidden="true" className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditing}
                      aria-label={`Cancelar edición de ${meal.label.toLowerCase()}`}
                      className={`${buttonSecondaryClass} min-h-9 px-3`}
                    >
                      <X aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => startEditing(meal.key)}
                  className="mt-2.5 flex min-h-[64px] w-full items-start justify-between gap-2.5 rounded-xl bg-[color:var(--color-surface-muted)] px-3 py-2.5 text-left transition-colors hover:bg-[color:var(--color-accent-soft)]"
                >
                  <span
                    className={
                      isFree
                        ? "text-base font-semibold text-[color:var(--color-muted-foreground)]"
                        : "text-base font-semibold leading-6 text-[color:var(--color-foreground)] sm:text-lg"
                    }
                  >
                    {isFree ? "Añadir plato" : value}
                  </span>
                  <Pencil
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]"
                  />
                </button>
              )}
            </section>
          );
        })}
      </div>
    </article>
  );
}

export default function Home() {
  const [weekDays, setWeekDays] = useState<WeekDay[]>(mockWeek.days);
  const [hasLoadedWeek, setHasLoadedWeek] = useState(false);
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
    const loadWeek = window.setTimeout(() => {
      const savedWeek = readSavedWeek();

      if (savedWeek) {
        console.log("Cargando semana guardada:", savedWeek.length);
        setWeekDays(savedWeek);

        if (!savedWeek.some((day) => day.day === "Lunes")) {
          const firstAvailableDay = orderedDays.find((orderedDay) =>
            savedWeek.some((savedDay) => savedDay.day === orderedDay.name),
          );

          if (firstAvailableDay) {
            setSelectedDayName(firstAvailableDay.name);
          }
        }
      }

      setHasLoadedWeek(true);
    }, 0);

    return () => window.clearTimeout(loadWeek);
  }, []);

  useEffect(() => {
    if (!hasLoadedWeek) {
      return;
    }

    saveWeek(weekDays);
  }, [hasLoadedWeek, weekDays]);

  const handleMealChange = (
    dayName: string,
    mealKey: MealKey,
    value: string,
  ) => {
    setWeekDays((currentDays) =>
      currentDays.map((day) =>
        day.day === dayName
          ? {
              ...day,
              [mealKey]: value || "LIBRE",
            }
          : day,
      ),
    );
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
