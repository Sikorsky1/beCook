"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

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

const shortDayNames: Record<string, string> = {
  Lunes: "Lun",
  Martes: "Mar",
  Miércoles: "Mié",
  Jueves: "Jue",
  Viernes: "Vie",
  Sábado: "Sáb",
  Domingo: "Dom",
};

const shortDayName = (dayName: string) => shortDayNames[dayName] ?? dayName;

type WeekDayCardProps = {
  day: WeekDay;
  // «today»: the featured block of step 29; «compact»: the remaining days.
  variant?: "today" | "compact";
  onMealChange: (dayName: string, mealKey: MealKey, value: string) => void;
  // «Otra idea» (step 21). Without it the card only offers manual editing.
  onRequestIdea?: RequestDishIdea;
  loginReturnPath?: string;
  // C2: tapping a planned dish opens its card. Without it, tapping edits the meal (as before).
  onOpenDish?: (dayName: string, mealKey: MealKey) => void;
  // «Cambiar plato» from the card: opens this card's editor for that meal (a new key each time).
  editRequest?: { meal: MealKey; key: number } | null;
  // Called once the request has opened the editor, so a later remount does not open it again.
  onEditRequestHandled?: () => void;
  // «today» only: breakfast, mid-morning, snack… of the day (src/lib/data/dailyMeals.ts), shown
  // under lunch and dinner, which stay the featured meals.
  dailyMeals?: { label: string; text: string }[];
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
  variant = "compact",
  onMealChange,
  onRequestIdea,
  loginReturnPath = "/week",
  onOpenDish,
  editRequest = null,
  onEditRequestHandled,
  dailyMeals = [],
}: WeekDayCardProps) {
  const [editingMeal, setEditingMeal] = useState<MealKey | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [idea, setIdea] = useState<IdeaState>(emptyIdeaState(""));
  const ideaAbortRef = useRef<AbortController | null>(null);
  const headingId = `${useId()}-day`;
  const [handledEditKey, setHandledEditKey] = useState<number | null>(null);

  const startEditing = (mealKey: MealKey) => {
    const current = day[mealKey] === "LIBRE" ? "" : day[mealKey];
    setEditingMeal(mealKey);
    setDraftValue(current);
    setIdea(emptyIdeaState(current));
  };

  // «Cambiar plato» in the dish card: adjust state while rendering (no effect needed).
  if (editRequest && editRequest.key !== handledEditKey) {
    setHandledEditKey(editRequest.key);
    startEditing(editRequest.meal);
  }

  useEffect(() => {
    if (handledEditKey !== null) onEditRequestHandled?.();
    // Only when a new request has been handled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handledEditKey]);

  // A planned dish opens its card (C2); a free meal opens the editor to add one.
  const openMeal = (mealKey: MealKey) => {
    if (onOpenDish && day[mealKey] !== "LIBRE") {
      onOpenDish(day.day, mealKey);
      return;
    }
    startEditing(mealKey);
  };
  const mealAction = (mealKey: MealKey) => (onOpenDish && day[mealKey] !== "LIBRE" ? "Ver ficha" : "Editar");

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

  const renderEditor = (meal: (typeof mealLabels)[number]) => (
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
        aria-label={`${meal.label} del ${day.day}`}
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
  );

  // Tapping a planned dish opens its card (C2); editing that meal (saved per slot, B4) is
  // «Cambiar plato» inside the card. A free meal is edited directly.
  const mealButtonClass = (isFree: boolean, size: string) =>
    `flex w-full rounded-[var(--radius-input)] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)] transition-[background-color,color,transform] duration-200 ease-out active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100 ${size} ${
      isFree
        ? "border border-dashed border-[color:var(--color-border-strong)] bg-transparent hover:bg-[color:var(--color-accent-soft)]/45"
        : "bg-[color:var(--color-surface-muted)] hover:bg-[color:var(--color-accent-soft)]"
    }`;

  const dishText = (value: string, isFree: boolean) => (isFree ? "+ Añadir plato" : value);
  const dishTextColor = (isFree: boolean) =>
    isFree ? "text-[color:var(--color-muted-foreground)]" : "text-[color:var(--color-foreground)]";

  if (variant === "today") {
    return (
      <article
        aria-labelledby={headingId}
        className="relative overflow-hidden rounded-[var(--radius-card)] border border-[color:var(--color-accent)]/45 bg-gradient-to-br from-[color:var(--color-surface)] via-[color:var(--color-surface)] to-[color:var(--color-accent-soft)] p-4 shadow-[var(--shadow-float)] sm:p-6"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-[color:var(--color-glow)] blur-2xl"
        />
        <div className="relative flex items-baseline gap-2.5">
          <span className="t-meta inline-flex items-center gap-1.5 rounded-full bg-[color:var(--color-ink)] px-3 py-1.5 font-semibold leading-none text-[color:var(--color-ink-foreground)]">
            <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--color-accent)] motion-reduce:animate-none" />
            Hoy
          </span>
          <h2 id={headingId} className="t-h2 text-[color:var(--color-foreground)]">
            {day.day}
            <span className="t-meta ml-1.5">{day.date}</span>
          </h2>
        </div>

        <div className="relative mt-4 grid gap-3 sm:grid-cols-2">
          {mealLabels.map((meal) => {
            const value = day[meal.key];
            const isFree = value === "LIBRE";
            const isEditing = editingMeal === meal.key;

            return (
              <section key={meal.key} className={`min-w-0 ${isEditing ? "sm:col-span-2" : ""}`}>
                <h3 className="t-micro">{meal.label}</h3>
                {isEditing ? (
                  renderEditor(meal)
                ) : (
                  <button
                    type="button"
                    onClick={() => openMeal(meal.key)}
                    aria-haspopup={onOpenDish && !isFree ? "dialog" : undefined}
                    aria-label={`${meal.label} de hoy: ${isFree ? "sin plato, añadir" : value}. ${mealAction(meal.key)}`}
                    className={`mt-1.5 ${mealButtonClass(isFree, "min-h-16 items-center px-4 py-3")}`}
                  >
                    <span
                      className={`text-lg font-semibold leading-snug [overflow-wrap:anywhere] ${dishTextColor(isFree)}`}
                    >
                      {dishText(value, isFree)}
                    </span>
                  </button>
                )}
              </section>
            );
          })}
        </div>

        {dailyMeals.length ? (
          <section aria-labelledby={`${headingId}-daily`} className="relative mt-4 border-t border-[color:var(--color-border)] pt-3">
            <h3 id={`${headingId}-daily`} className="t-micro">
              Resto del día
            </h3>
            <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
              {dailyMeals.map((meal) => (
                <div key={meal.label} className="contents">
                  <dt className="t-meta font-semibold">{meal.label}</dt>
                  <dd className="t-body min-w-0 text-[color:var(--color-foreground)] [overflow-wrap:anywhere]">{meal.text}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
      </article>
    );
  }

  // Compact row: short day label, then lunch and dinner stacked so long titles keep the full width.
  const editedMeal = mealLabels.find((meal) => meal.key === editingMeal);

  return (
    <article
      aria-labelledby={headingId}
      className="rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)]/90 px-3 py-3 shadow-[var(--shadow-card)] backdrop-blur transition-[border-color,box-shadow] duration-200 hover:border-[color:var(--color-border-strong)]"
    >
      <div className="flex gap-3">
        <h2 id={headingId} className="flex w-12 shrink-0 flex-col items-center self-start rounded-[var(--radius-input)] bg-[color:var(--color-surface-muted)] px-1 py-2 text-center leading-tight">
          <span aria-hidden="true" className="block font-[family-name:var(--font-fraunces)] text-base font-semibold text-[color:var(--color-foreground)]">
            {shortDayName(day.day)}
          </span>
          <span aria-hidden="true" className="t-meta block">
            {day.date}
          </span>
          <span className="sr-only">
            {day.day} {day.date}
          </span>
        </h2>
        <div className="min-w-0 flex-1 space-y-1.5">
          {mealLabels.map((meal) => {
            const value = day[meal.key];
            const isFree = value === "LIBRE";

            return (
              <button
                key={meal.key}
                type="button"
                onClick={() => openMeal(meal.key)}
                aria-haspopup={onOpenDish && !isFree ? "dialog" : undefined}
                aria-label={`${meal.label} del ${day.day}: ${isFree ? "sin plato, añadir" : value}. ${mealAction(meal.key)}`}
                aria-expanded={editingMeal === meal.key}
                className={`${mealButtonClass(isFree, "min-h-11 flex-col items-start gap-1 px-2.5 py-1.5")} ${
                  editingMeal === meal.key ? "ring-2 ring-[color:var(--color-border-strong)]" : ""
                }`}
              >
                <span className="t-micro">{meal.label}</span>
                <span
                  className={`max-w-full text-[0.9375rem] font-semibold leading-snug [overflow-wrap:anywhere] ${dishTextColor(isFree)}`}
                >
                  {dishText(value, isFree)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {editedMeal ? (
        <section className="mt-2.5 border-t border-[color:var(--color-border)] pt-2.5">
          <h3 className="t-micro">
            {editedMeal.label} · {day.day}
          </h3>
          {renderEditor(editedMeal)}
        </section>
      ) : null}
    </article>
  );
}
