"use client";

import { useState } from "react";

import type { MealKey, WeekDay } from "@/data/mockWeek";
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  inputClass,
} from "@/lib/ui";

type DayCardProps = {
  day: WeekDay;
  onMealChange?: (dayName: string, mealKey: MealKey, value: string) => void;
  isEditable?: boolean;
  appearance?: "default" | "home";
};

const mealLabels = [
  { key: "lunch", label: "Comida" },
  { key: "dinner", label: "Cena" },
] as const;

const dayAccentClasses: Record<WeekDay["day"], string> = {
  Lunes: "bg-[#2563eb]",
  Martes: "bg-[#e35d4f]",
  Miércoles: "bg-[#d7a71d]",
  Jueves: "bg-[#2f9d6a]",
  Viernes: "bg-[#8b5cf6]",
  Sábado: "bg-[#e87538]",
  Domingo: "bg-[#0f766e]",
};

export function DayCard({
  day,
  onMealChange,
  isEditable = true,
  appearance = "default",
}: DayCardProps) {
  const [editingMeal, setEditingMeal] = useState<MealKey | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const isHomeAppearance = appearance === "home";

  const startEditing = (mealKey: MealKey) => {
    if (!isEditable) {
      return;
    }

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

    if (!onMealChange) {
      cancelEditing();
      return;
    }

    onMealChange(day.day, editingMeal, draftValue.trim());
    cancelEditing();
  };

  return (
    <article
      className={
        isHomeAppearance
          ? "rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5 shadow-[var(--shadow-card)] transition-colors hover:border-[color:var(--color-border-strong)] sm:p-6"
          : "rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5 shadow-[var(--shadow-card)]"
      }
    >
      <div
        className={
          isHomeAppearance
            ? "flex items-start justify-between gap-4 pb-5"
            : "flex items-baseline justify-between gap-3 border-b border-[color:var(--color-border)] pb-3"
        }
      >
        {isHomeAppearance ? (
          <div className="min-w-0">
            <h3 className="text-2xl font-semibold leading-none text-[color:var(--color-foreground)]">
              {day.day}
            </h3>
            <p className="mt-2 text-sm font-medium text-[color:var(--color-muted-foreground)]">
              {day.date}
            </p>
          </div>
        ) : (
          <h3 className="text-lg font-semibold text-[color:var(--color-foreground)]">
            {day.day}
          </h3>
        )}
        {isHomeAppearance ? (
          <span
            aria-hidden="true"
            className={`mt-1 h-3 w-3 shrink-0 rounded-full ${dayAccentClasses[day.day]}`}
          />
        ) : (
          <p className="text-sm font-medium text-[color:var(--color-muted-foreground)]">
            {day.date}
          </p>
        )}
      </div>

      <div
        className={
          isHomeAppearance
            ? "divide-y divide-[color:var(--color-border)] border-t border-[color:var(--color-border)]"
            : "mt-4 space-y-3"
        }
      >
        {mealLabels.map((meal) => {
          const value = day[meal.key];
          const isFree = value === "LIBRE";
          const isEditing = editingMeal === meal.key;

          return (
            <div
              key={meal.key}
              className={
                isHomeAppearance
                  ? "py-5 first:pt-5 last:pb-0"
                  : "rounded-[calc(var(--radius-card)-0.375rem)] border border-[color:var(--color-border)] bg-white px-4 py-3.5 transition-colors"
              }
            >
              <div className="flex items-start justify-between gap-4">
                <p
                  className={
                    isHomeAppearance
                      ? "text-sm font-semibold text-[color:var(--color-muted-foreground)]"
                      : "text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--color-muted-foreground)]"
                  }
                >
                  {meal.label}
                </p>
                {isHomeAppearance && isFree ? (
                  <span className="rounded-full bg-[color:var(--color-success-soft)] px-3 py-1 text-xs font-semibold text-[color:var(--color-muted-foreground)]">
                    Libre
                  </span>
                ) : null}
              </div>
              {isEditing ? (
                <div
                  className={
                    isHomeAppearance ? "mt-4 space-y-3" : "mt-2 space-y-3"
                  }
                >
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
                    className={inputClass}
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={saveMeal}
                      className={`${buttonPrimaryClass} min-h-11 px-4`}
                    >
                      Guardar
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditing}
                      className={`${buttonSecondaryClass} min-h-11 px-4`}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : isFree ? (
                isEditable ? (
                  <button
                    type="button"
                    onClick={() => startEditing(meal.key)}
                    className={
                      isHomeAppearance
                        ? "mt-3 block min-h-11 w-full rounded-[var(--radius-control)] border border-dashed border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-muted)] px-4 py-3 text-left text-base font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent-soft)] hover:text-[color:var(--color-foreground)]"
                        : `mt-2 ${buttonSecondaryClass} min-h-0 rounded-full px-3 py-1`
                    }
                  >
                    Añadir plato
                  </button>
                ) : (
                  <span
                    className={
                      isHomeAppearance
                        ? "mt-3 inline-flex min-h-11 items-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)] px-4 py-2 text-sm font-semibold text-[color:var(--color-muted-foreground)]"
                        : "mt-2 inline-flex rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)] px-3 py-1 text-sm font-semibold text-[color:var(--color-muted-foreground)]"
                    }
                  >
                    LIBRE
                  </span>
                )
              ) : isEditable ? (
                <button
                  type="button"
                  onClick={() => startEditing(meal.key)}
                  className={
                    isHomeAppearance
                      ? "mt-3 block w-full rounded-[var(--radius-control)] px-0 py-1 text-left text-lg leading-7 font-medium text-[color:var(--color-foreground)] transition-colors hover:text-[color:var(--color-accent)] sm:text-xl"
                      : `mt-2 ${buttonSecondaryClass} min-h-0 rounded-full px-3 py-1`
                  }
                >
                  {value}
                </button>
              ) : (
                <p
                  className={
                    isHomeAppearance
                      ? "mt-3 text-lg leading-7 text-[color:var(--color-foreground)] sm:text-xl"
                      : "mt-2 text-sm leading-6 text-stone-700 sm:text-[15px]"
                  }
                >
                  {value}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </article>
  );
}
