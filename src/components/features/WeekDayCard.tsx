"use client";

import { useState } from "react";

import { PrimaryButton, SecondaryButton } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import type { MealKey, WeekDay } from "@/data/mockWeek";

const mealLabels = [
  { key: "lunch", label: "Comida" },
  { key: "dinner", label: "Cena" },
] as const;

type WeekDayCardProps = {
  day: WeekDay;
  isToday?: boolean;
  onMealChange: (dayName: string, mealKey: MealKey, value: string) => void;
};

export function WeekDayCard({
  day,
  isToday = false,
  onMealChange,
}: WeekDayCardProps) {
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
    <article className="rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 shadow-[var(--shadow-card)] sm:p-4">
      <div className="flex items-center justify-between gap-2 border-b border-[color:var(--color-border)] pb-2">
        <h2 className="t-h3 text-[color:var(--color-foreground)]">
          {day.day}
          <span className="t-meta ml-1.5">{day.date}</span>
        </h2>
        {isToday ? (
          <span className="rounded-full bg-[color:var(--color-accent-soft)] px-2.5 py-1 text-xs font-semibold text-[color:var(--color-accent)]">
            Hoy
          </span>
        ) : null}
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-2">
        {mealLabels.map((meal) => {
          const value = day[meal.key];
          const isFree = value === "LIBRE";
          const isEditing = editingMeal === meal.key;

          return (
            <section
              key={meal.key}
              className={`min-w-0 ${isEditing ? "col-span-2" : ""}`}
            >
              <h3 className="t-micro">{meal.label}</h3>

              {isEditing ? (
                <div className="mt-1.5 space-y-2">
                  <TextInput
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
                    className="block w-full text-base font-semibold"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <PrimaryButton
                      onClick={saveMeal}
                      aria-label={`Guardar ${meal.label.toLowerCase()} de ${day.day}`}
                      className="w-full"
                    >
                      Guardar
                    </PrimaryButton>
                    <SecondaryButton
                      onClick={cancelEditing}
                      aria-label={`Cancelar edición de ${meal.label.toLowerCase()} de ${day.day}`}
                      className="w-full"
                    >
                      Cancelar
                    </SecondaryButton>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => startEditing(meal.key)}
                  className={`mt-1.5 flex min-h-11 w-full items-center rounded-[var(--radius-input)] px-3 py-2 text-left transition-[background-color,color,transform] duration-200 ease-out active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100 ${
                    isFree
                      ? "border border-dashed border-[color:var(--color-border-strong)] bg-transparent hover:bg-[color:var(--color-accent-soft)]/45"
                      : "bg-[color:var(--color-surface-muted)] hover:bg-[color:var(--color-accent-soft)]"
                  }`}
                >
                  <span
                    className={
                      isFree
                        ? "t-body-strong text-[color:var(--color-muted-foreground)]"
                        : "t-body-strong text-[color:var(--color-foreground)]"
                    }
                  >
                    {isFree ? "+ Añadir plato" : value}
                  </span>
                </button>
              )}
            </section>
          );
        })}
      </div>
    </article>
  );
}
