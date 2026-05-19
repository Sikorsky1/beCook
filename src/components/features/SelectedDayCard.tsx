"use client";

import { Check, Pencil, X } from "lucide-react";
import { useState } from "react";

import { PrimaryButton, SecondaryButton } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import type { MealKey, WeekDay } from "@/data/mockWeek";

const mealLabels = [
  { key: "lunch", label: "Comida" },
  { key: "dinner", label: "Cena" },
] as const;

type SelectedDayCardProps = {
  day: WeekDay;
  onMealChange: (dayName: string, mealKey: MealKey, value: string) => void;
};

export function SelectedDayCard({ day, onMealChange }: SelectedDayCardProps) {
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
    <article className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3.5 shadow-[0_18px_45px_rgba(32,28,23,0.07)] transition-[box-shadow,border-color,transform] duration-200 ease-out motion-reduce:transition-none sm:p-5">
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
                    className="py-2.5"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <PrimaryButton
                      onClick={saveMeal}
                      aria-label={`Guardar ${meal.label.toLowerCase()}`}
                      className="min-h-9 px-3"
                    >
                      <Check aria-hidden="true" className="h-4 w-4" />
                    </PrimaryButton>
                    <SecondaryButton
                      onClick={cancelEditing}
                      aria-label={`Cancelar edición de ${meal.label.toLowerCase()}`}
                      className="min-h-9 px-3"
                    >
                      <X aria-hidden="true" className="h-4 w-4" />
                    </SecondaryButton>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => startEditing(meal.key)}
                  className="mt-2.5 flex min-h-[64px] w-full items-start justify-between gap-2.5 rounded-xl bg-[color:var(--color-surface-muted)] px-3 py-2.5 text-left transition-[background-color,color,transform] duration-200 ease-out hover:bg-[color:var(--color-accent-soft)] active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100"
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

