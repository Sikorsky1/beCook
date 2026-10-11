"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { SecondaryButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { MealKey, WeekDay } from "@/data/mockWeek";
import { aiLoginRequiredMessage } from "@/lib/ai-client";
import type { DishIdea } from "@/lib/dishSubstitution";
import { loginHrefFor } from "@/lib/navigation";

// One day of the proposal in Crear menú, with «Otra idea» per dish (D3, step 28). An idea
// replaces that dish of the proposal at once (nothing is saved until «Usar este menú»); the
// other dishes never change. The reviewed catalogue goes first; the AI only if the user asks.
export type RequestProposalIdea = (
  dayName: string,
  mealKey: MealKey,
  rejected: string[],
  mode: "catalog" | "ai",
  signal?: AbortSignal,
) => DishIdea | Promise<DishIdea>;

type ProposalDayCardProps = {
  day: WeekDay;
  isToday: boolean;
  // While the menu is being saved, or once it is, the dishes cannot change.
  locked: boolean;
  onRequestIdea: RequestProposalIdea;
  onReplaceDish: (dayName: string, mealKey: MealKey, dish: string) => void;
  loginReturnPath: string;
};

const meals = [
  { key: "lunch", label: "Comida" },
  { key: "dinner", label: "Cena" },
] as const;

export function ProposalDayCard({ day, isToday, locked, onRequestIdea, onReplaceDish, loginReturnPath }: ProposalDayCardProps) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[color:var(--color-border)] px-4 py-3">
        <h3 className="text-[1.05rem] font-semibold text-[color:var(--color-foreground)]">
          {day.day}
          <span className="ml-1.5 text-[0.85rem] font-normal text-[color:var(--color-muted-foreground)]">· {day.date}</span>
        </h3>
        {isToday ? (
          <span className="ml-auto shrink-0 rounded-full bg-[color:var(--color-accent-soft)] px-2.5 py-[3px] text-[0.64rem] font-bold uppercase tracking-[0.1em] text-[color:var(--color-accent)]">
            Hoy
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-2">
        {meals.map((meal, index) => (
          <ProposalMeal
            key={meal.key}
            dayName={day.day}
            mealKey={meal.key}
            label={meal.label}
            value={day[meal.key]}
            bordered={index === 0}
            locked={locked}
            onRequestIdea={onRequestIdea}
            onReplaceDish={onReplaceDish}
            loginReturnPath={loginReturnPath}
          />
        ))}
      </div>
    </Card>
  );
}

type IdeaState = {
  // The dish the proposal had for this meal, which «Volver» brings back.
  original: string;
  rejected: string[];
  source: "catalog" | "ai" | null;
  offerAi: boolean;
  loading: boolean;
  loginRequired: boolean;
  message: string | null;
};

function ProposalMeal({
  dayName,
  mealKey,
  label,
  value,
  bordered,
  locked,
  onRequestIdea,
  onReplaceDish,
  loginReturnPath,
}: {
  dayName: string;
  mealKey: MealKey;
  label: string;
  value: string;
  bordered: boolean;
  locked: boolean;
  onRequestIdea: RequestProposalIdea;
  onReplaceDish: ProposalDayCardProps["onReplaceDish"];
  loginReturnPath: string;
}) {
  const isFree = value === "LIBRE";
  const [idea, setIdea] = useState<IdeaState>(() => ({
    original: value,
    rejected: [],
    source: null,
    offerAi: false,
    loading: false,
    loginRequired: false,
    message: null,
  }));
  const abortRef = useRef<AbortController | null>(null);
  const mealName = `${label.toLowerCase()} del ${dayName.toLowerCase()}`;

  useEffect(() => () => abortRef.current?.abort(), []);

  const applyResult = (result: DishIdea, rejected: string[]) => {
    const base = { ...idea, rejected, offerAi: false, loading: false, loginRequired: false, message: null };
    if (result.status === "found") {
      onReplaceDish(dayName, mealKey, result.dish);
      setIdea({ ...base, source: result.source });
    } else if (result.status === "catalog_exhausted") {
      setIdea({ ...base, offerAi: true });
    } else if (result.status === "login_required") {
      setIdea({ ...base, loginRequired: true });
    } else {
      setIdea({ ...base, offerAi: !result.limit && idea.offerAi, message: result.message });
    }
  };

  const requestIdea = async (mode: "catalog" | "ai") => {
    if (locked || idea.loading) return;
    // The dish on screen is discarded when asking for another.
    const rejected = [...new Set([...idea.rejected, value])];

    if (mode === "catalog") {
      applyResult(await onRequestIdea(dayName, mealKey, rejected, "catalog"), rejected);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIdea({ ...idea, loading: true, message: null });
    const result = await onRequestIdea(dayName, mealKey, rejected, "ai", controller.signal);
    if (!controller.signal.aborted) {
      abortRef.current = null;
      applyResult(result, rejected);
    }
  };

  const cancelAi = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIdea({ ...idea, loading: false, offerAi: true, message: null });
  };

  const restoreOriginal = () => {
    onReplaceDish(dayName, mealKey, idea.original);
    setIdea({ ...idea, source: null, offerAi: false, loginRequired: false, message: null });
  };

  return (
    <div className={`min-w-0 px-3.5 py-3 ${bordered ? "border-r border-[color:var(--color-border)]" : ""}`}>
      <p className="mb-2 text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-muted-foreground)]">
        {label}
      </p>
      <div
        className={`rounded-[var(--radius-input)] px-3 py-2.5 text-[0.88rem] font-medium leading-[1.4] break-words ${
          isFree
            ? "border border-dashed border-[color:var(--color-border)] italic text-[color:var(--color-muted-foreground)]"
            : "bg-[color:var(--color-surface-muted)] text-[color:var(--color-foreground)]"
        }`}
      >
        {isFree ? "Libre" : value}
      </div>

      {isFree ? null : (
        <div className="mt-1.5 space-y-1.5" aria-live="polite">
          {idea.source && value !== idea.original ? (
            <p className="t-meta">
              {idea.source === "catalog" ? "Receta del catálogo revisado." : "Idea propuesta por IA."}{" "}
              <button
                type="button"
                onClick={restoreOriginal}
                disabled={locked || idea.loading}
                className="font-semibold underline underline-offset-2 disabled:opacity-50"
              >
                Volver al plato anterior
              </button>
            </p>
          ) : null}

          {idea.offerAi || idea.loading ? (
            <div className="space-y-1.5 rounded-[var(--radius-input)] border border-[color:var(--color-border)] px-2.5 py-2">
              <p className="t-meta">
                No quedan recetas del catálogo que encajen con tu perfil y el resto de la semana. Una idea con IA cuenta
                como uno de tus menús de hoy.
              </p>
              {idea.loading ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="t-meta inline-flex items-center gap-1.5" role="status">
                    <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                    Pidiendo una idea…
                  </span>
                  <button type="button" onClick={cancelAi} className="t-meta font-semibold underline underline-offset-2">
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="space-y-1">
                  <SecondaryButton size="sm" onClick={() => void requestIdea("ai")} disabled={locked} className="w-full">
                    Pedir idea a la IA
                  </SecondaryButton>
                  <button
                    type="button"
                    onClick={() => setIdea({ ...idea, offerAi: false, message: null })}
                    className="t-meta min-h-9 w-full font-semibold underline underline-offset-2"
                  >
                    Mantener este plato
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {idea.message ? (
            <p className="text-xs leading-5 text-[color:var(--color-danger)]" role="alert">
              {idea.message}
            </p>
          ) : null}

          {idea.loginRequired ? (
            <p className="t-meta">
              No quedan recetas del catálogo que encajen.{" "}
              <Link href={loginHrefFor(loginReturnPath)} className="font-semibold underline">
                {aiLoginRequiredMessage}
              </Link>
            </p>
          ) : null}

          {idea.offerAi || idea.loading ? null : (
            <button
              type="button"
              onClick={() => void requestIdea("catalog")}
              disabled={locked || idea.loading}
              aria-label={`Otra idea para la ${mealName}`}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-1 text-xs font-semibold text-[color:var(--color-secondary-hover)] underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
              Otra idea
            </button>
          )}
        </div>
      )}
    </div>
  );
}
