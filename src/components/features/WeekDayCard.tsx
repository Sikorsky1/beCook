"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { GhostButton, PrimaryButton, SecondaryButton } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import type { MealKey, WeekDay } from "@/data/mockWeek";
import { aiLoginRequiredMessage } from "@/lib/ai-client";
import type { DishIdea } from "@/lib/dishSubstitution";
import { loginHrefFor } from "@/lib/navigation";

const mealLabels = [
  { key: "lunch", label: "Comida" },
  { key: "dinner", label: "Cena" },
] as const;

export type RequestDishIdea = (
  dayName: string,
  mealKey: MealKey,
  rejected: string[],
  mode: "catalog" | "ai",
  signal?: AbortSignal,
) => DishIdea | Promise<DishIdea>;

type WeekDayCardProps = {
  day: WeekDay;
  isToday?: boolean;
  onMealChange: (dayName: string, mealKey: MealKey, value: string) => void;
  // «Otra idea» (step 21). Without it the card only offers manual editing.
  onRequestIdea?: RequestDishIdea;
  loginReturnPath?: string;
};

// What the «Otra idea» helper shows for the meal being edited.
type IdeaState = {
  rejected: string[];
  source: "catalog" | "ai" | null;
  offerAi: boolean;
  loading: boolean;
  loginRequired: boolean;
  message: string | null;
};

const emptyIdeaState = (current: string): IdeaState => ({
  rejected: current ? [current] : [],
  source: null,
  offerAi: false,
  loading: false,
  loginRequired: false,
  message: null,
});

export function WeekDayCard({
  day,
  isToday = false,
  onMealChange,
  onRequestIdea,
  loginReturnPath = "/week",
}: WeekDayCardProps) {
  const [editingMeal, setEditingMeal] = useState<MealKey | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [idea, setIdea] = useState<IdeaState>(emptyIdeaState(""));
  const ideaAbortRef = useRef<AbortController | null>(null);

  const startEditing = (mealKey: MealKey) => {
    const current = day[mealKey] === "LIBRE" ? "" : day[mealKey];
    setEditingMeal(mealKey);
    setDraftValue(current);
    setIdea(emptyIdeaState(current));
  };

  const cancelEditing = () => {
    ideaAbortRef.current?.abort();
    ideaAbortRef.current = null;
    setEditingMeal(null);
    setDraftValue("");
    setIdea(emptyIdeaState(""));
  };

  const applyIdea = (result: DishIdea, rejected: string[]) => {
    if (result.status === "found") {
      setDraftValue(result.dish);
      setIdea({ ...emptyIdeaState(""), rejected, source: result.source });
    } else if (result.status === "catalog_exhausted") {
      setIdea({ ...emptyIdeaState(""), rejected, offerAi: true });
    } else if (result.status === "login_required") {
      setIdea({ ...emptyIdeaState(""), rejected, loginRequired: true });
    } else {
      setIdea({ ...emptyIdeaState(""), rejected, offerAi: !result.limit, message: result.message });
    }
  };

  const requestIdea = async (mode: "catalog" | "ai") => {
    if (!editingMeal || !onRequestIdea || idea.loading) {
      return;
    }

    // The idea on screen (or the typed dish) is discarded when asking for another.
    const shown = draftValue.trim();
    const rejected = [...new Set([...idea.rejected, ...(shown ? [shown] : [])])];

    if (mode === "catalog") {
      applyIdea(await onRequestIdea(day.day, editingMeal, rejected, "catalog"), rejected);
      return;
    }

    const controller = new AbortController();
    ideaAbortRef.current = controller;
    setIdea({ ...idea, loading: true, message: null });
    const result = await onRequestIdea(day.day, editingMeal, rejected, "ai", controller.signal);

    if (!controller.signal.aborted) {
      ideaAbortRef.current = null;
      applyIdea(result, rejected);
    }
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
                  {onRequestIdea ? (
                    <div className="space-y-2">
                      <GhostButton
                        onClick={() => void requestIdea("catalog")}
                        disabled={idea.loading}
                        aria-label={`Otra idea para la ${meal.label.toLowerCase()} de ${day.day}`}
                        className="w-full"
                      >
                        Otra idea
                      </GhostButton>
                      {idea.source ? (
                        <p className="t-meta" role="status">
                          {idea.source === "catalog"
                            ? "Receta del catálogo revisado. Guarda para cambiar solo este plato."
                            : "Idea propuesta por IA. Guarda para cambiar solo este plato."}
                        </p>
                      ) : null}
                      {idea.message ? (
                        <p className="text-sm leading-6 text-[color:var(--color-danger)]" role="alert">
                          {idea.message}
                        </p>
                      ) : null}
                      {idea.loginRequired ? (
                        <p className="t-meta" role="status">
                          No quedan recetas del catálogo que encajen con tu semana.{" "}
                          <Link href={loginHrefFor(loginReturnPath)} className="font-semibold underline">
                            {aiLoginRequiredMessage}
                          </Link>
                        </p>
                      ) : null}
                      {idea.offerAi || idea.loading ? (
                        <div className="space-y-2">
                          {!idea.message ? (
                            <p className="t-meta" role="status">
                              No quedan recetas del catálogo que encajen con tu perfil y tu semana.
                              Una idea con IA cuenta como uno de tus menús de hoy.
                            </p>
                          ) : null}
                          <SecondaryButton
                            onClick={() => void requestIdea("ai")}
                            disabled={idea.loading}
                            className="w-full"
                          >
                            {idea.loading ? "Pidiendo idea…" : "Pedir idea a la IA"}
                          </SecondaryButton>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
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
