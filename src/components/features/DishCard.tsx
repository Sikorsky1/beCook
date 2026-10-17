"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { PrimaryButton, SecondaryButton, TertiaryButton } from "@/components/ui/Button";
import type { MealKey, WeekDay } from "@/data/mockWeek";
import type { DataIdentity } from "@/lib/data/repositories";
import { newRequestKey } from "@/lib/data/repositories";
import type { IsoWeek } from "@/lib/isoWeek";
import { loginHrefFor } from "@/lib/navigation";
import { highMercury } from "@/lib/menu-generation/food-groups";
import { formatIngredientAmount, recipeAllergenLabels, type RecipeCard, type RecipeCardContent } from "@/lib/recipes/card";
import { normalizeFood } from "@/lib/recipes/food-lexicon";
import {
  cardToShow,
  dishCardSlotKey,
  dishConflictLabels,
  linkCatalogCard,
  loadDishCardView,
  requestEstimatedCard,
  type DishCardAction,
  type DishCardRestrictions,
  type DishCardView,
} from "@/lib/recipes/dishCardFlow";
import { mealRecipeLink } from "@/lib/weekStorage";

// C2 (step 17): the card of one planned meal, as a native modal dialog (pattern of
// ReplaceMenuDialog: showModal traps focus, Escape closes). It never claims more than it knows:
// reviewed catalogue card, card estimated by AI (not reviewed), or only the title.
type DishCardProps = {
  slot: { day: string; meal: MealKey } | null;
  weekDays: WeekDay[] | null;
  identity: DataIdentity;
  isoWeek: IsoWeek | null;
  // Servings the week was planned for (C1). Not shown since 2026-10-15: the recipe says its own.
  weekServings: number | null;
  // C3: the current restrictions (account profile when signed in, device profile for a guest).
  restrictions: DishCardRestrictions;
  loginReturnPath: string;
  onClose: () => void;
  // «Cambiar plato»: opens the usual editor of that meal.
  onChangeDish: (slot: { day: string; meal: MealKey }) => void;
  // The week after linking a card (or the account's week after a conflict).
  onWeekChanged: (days: WeekDay[] | null) => void;
};

const mealLabels: Record<MealKey, string> = { lunch: "Comida", dinner: "Cena" };

// C3, simplified (2026-10-15): only what the dish certainly breaks, in one short line of labels
// («Alergia: Gluten»). Nothing when no certain conflict is found.
function ConflictLabels({ labels }: { labels: string[] }) {
  if (!labels.length) return null;
  return (
    <ul aria-label="Incompatible con tu perfil" className="flex flex-wrap gap-1.5">
      {labels.map((label) => (
        <li
          key={label}
          className="t-meta rounded-full border border-[color:var(--color-danger)] bg-[color:var(--color-danger-soft)] px-2.5 py-0.5 font-semibold text-[color:var(--color-danger)]"
        >
          {label}
        </li>
      ))}
    </ul>
  );
}

// Ingredients first, then the steps, then the allergens the recipe may contain (N03).
// review: «reviewed»; «estimated», a card the AI estimated from the title; «draft», a catalogue
// recipe not yet reviewed by a professional. base: the catalogue recipe the dish starts with, when
// the dish adds something to it.
function RecipeBody({
  recipe,
  review,
  title,
  base = null,
}: {
  recipe: RecipeCardContent;
  review: "reviewed" | "estimated" | "draft";
  title: string;
  base?: string | null;
}) {
  const id = useId();
  const ingredientsId = `${id}-dish-card-ingredients`;
  const stepsId = `${id}-dish-card-steps`;
  const allergensId = `${id}-dish-card-allergens`;
  const meta = [
    `Para ${recipe.baseServings} ${recipe.baseServings === 1 ? "persona" : "personas"}`,
    recipe.totalMinutes ? `${recipe.totalMinutes} min` : null,
    review === "estimated" ? "Estimada por IA · sin revisar" : review === "draft" ? "Receta sin revisar por un profesional" : null,
    base ? `Receta de «${base}»` : null,
  ].filter(Boolean);
  const allergens = recipe.possibleAllergens.map((allergen) => recipeAllergenLabels[allergen].toLowerCase());
  // N15: the AESAN advice on mercury, on the recipes with those species.
  const mercury = [title, ...recipe.ingredients.map((ingredient) => ingredient.name)].some((text) => highMercury.test(normalizeFood(text)));

  return (
    <div className="space-y-4">
      <p className="t-meta">{meta.join(" · ")}</p>

      <section aria-labelledby={ingredientsId}>
        <h3 id={ingredientsId} className="t-body-strong">
          Ingredientes
        </h3>
        <ul className="mt-2 space-y-1.5">
          {recipe.ingredients.map((ingredient, index) => (
            <li key={`${ingredient.name}-${index}`} className="t-body flex justify-between gap-3">
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {ingredient.name}
                {ingredient.optional ? <span className="t-meta"> (opcional)</span> : null}
              </span>
              <span className="t-meta shrink-0">{formatIngredientAmount(ingredient) || "al gusto"}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby={stepsId}>
        <h3 id={stepsId} className="t-body-strong">
          Pasos
        </h3>
        <ol className="t-body mt-2 list-decimal space-y-2 pl-5">
          {recipe.steps.map((step, index) => (
            <li key={index} className="[overflow-wrap:anywhere]">
              {step}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby={allergensId} className="space-y-1">
        <h3 id={allergensId} className="t-body-strong">
          Alérgenos
        </h3>
        {/* No list is never «sin alérgenos»: only the labelling line. */}
        {allergens.length ? <p className="t-body">Puede contener: {allergens.join(", ")}.</p> : null}
        <p className="t-meta">Revisa siempre el etiquetado de los productos que compres.</p>
        {mercury ? (
          <p className="t-meta">
            La AESAN recomienda que embarazadas, lactantes y niños menores de 10 años eviten el pez espada, el atún rojo, el
            tiburón y el lucio, por su contenido en mercurio.
          </p>
        ) : null}
      </section>
    </div>
  );
}

export function DishCard({
  slot,
  weekDays,
  identity,
  isoWeek,
  restrictions,
  loginReturnPath,
  onClose,
  onChangeDish,
  onWeekChanged,
}: DishCardProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = `${useId()}-dish-card-title`;
  const day = slot && weekDays ? (weekDays.find((candidate) => candidate.day === slot.day) ?? null) : null;
  const title = day && slot ? day[slot.meal] : "";
  const open = Boolean(slot && day && title && title !== "LIBRE");
  const link = day && slot ? mealRecipeLink(day, slot.meal) : null;
  const viewKey = open && slot ? JSON.stringify([slot.day, slot.meal, title, link?.versionId ?? null]) : null;

  const [viewEntry, setViewEntry] = useState<{ key: string; view: DishCardView } | null>(null);
  // A card just estimated or linked is shown at once, before the week is read again.
  const [shownCard, setShownCard] = useState<{ key: string; card: RecipeCard } | null>(null);
  const [busy, setBusy] = useState<"catalog" | "ai" | null>(null);
  const [notice, setNotice] = useState<{ key: string; text: string; tone: "info" | "error"; login?: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  // One request key per estimate attempt of a meal; reused if the answer was lost.
  const attemptRef = useRef<{ key: string; requestKey: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!viewKey || !day || !slot) return;
    let cancelled = false;
    void loadDishCardView(day, slot.meal).then((view) => {
      if (!cancelled) setViewEntry({ key: viewKey, view });
    });
    return () => {
      cancelled = true;
    };
    // day/slot are read through viewKey (title and link); retry reads again after an error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, retry]);

  const close = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(null);
    onClose();
  };

  const view = viewEntry && viewEntry.key === viewKey ? viewEntry.view : null;
  const slotKey = slot ? dishCardSlotKey(slot, title) : "";
  const card = cardToShow(shownCard, slotKey, title, link?.versionId ?? null, view?.kind === "card" ? view.card : null);
  const currentNotice = notice && notice.key === slotKey ? notice : null;

  const settle = (action: DishCardAction) => {
    if (action.status === "login_required") {
      setNotice({ key: slotKey, text: "Inicia sesión para crear una ficha estimada con IA.", tone: "info", login: true });
      return;
    }
    if (action.status === "error") {
      setNotice({ key: slotKey, text: action.message, tone: "error" });
      if (!action.retryable) attemptRef.current = null;
      return;
    }
    attemptRef.current = null;
    if (action.status === "linked" && action.card) setShownCard({ key: slotKey, card: action.card });
    if ("message" in action && action.message) {
      setNotice({ key: slotKey, text: action.message, tone: action.status === "linked" ? "info" : "error" });
    }
    if (action.days) onWeekChanged(action.days);
  };

  const applyCatalog = async (versionId: string) => {
    if (!slot || !weekDays || !isoWeek || busy) return;
    setBusy("catalog");
    setNotice(null);
    settle(await linkCatalogCard(identity, isoWeek, weekDays, slot, versionId));
    setBusy(null);
  };

  const estimate = async () => {
    if (!slot || !isoWeek || busy) return;
    if (attemptRef.current?.key !== slotKey) attemptRef.current = { key: slotKey, requestKey: newRequestKey() };
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy("ai");
    setNotice(null);
    const action = await requestEstimatedCard(identity, isoWeek, slot, title, attemptRef.current.requestKey, controller.signal);
    if (controller.signal.aborted) return;
    abortRef.current = null;
    settle(action);
    setBusy(null);
    // The button that asked for the card is gone: take the focus to the dish title, so keyboard
    // and screen reader users land at the start of the new card instead of on the page body.
    if (action.status === "linked" && action.card) requestAnimationFrame(() => titleRef.current?.focus());
  };

  const signedIn = identity.userId !== null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-0 text-[color:var(--color-foreground)] shadow-[0_24px_60px_rgba(32,28,23,0.22)] backdrop:bg-[rgba(46,42,38,0.45)]"
    >
      {open && slot ? (
        <div className="space-y-4 p-5">
          <div>
            <p className="t-meta">
              {mealLabels[slot.meal]} · {slot.day}
            </p>
            <h2 id={titleId} ref={titleRef} tabIndex={-1} className="t-h2 mt-1 text-[color:var(--color-foreground)] [overflow-wrap:anywhere]">
              {title}
            </h2>
          </div>

          {card || view ? (
            <ConflictLabels
              labels={dishConflictLabels(title, card ?? (view?.kind === "catalog_recipe" ? view.recipe : null), restrictions)}
            />
          ) : null}

          {card ? (
            <RecipeBody recipe={card} title={title} review={card.reviewStatus === "reviewed" ? "reviewed" : "estimated"} />
          ) : !view ? (
            <p className="t-body" role="status">
              Cargando la ficha…
            </p>
          ) : view.kind === "catalog_recipe" ? (
            <RecipeBody recipe={view.recipe} title={title} review="draft" base={view.base} />
          ) : view.kind === "error" ? (
            <div className="space-y-2">
              <p className="t-body text-[color:var(--color-danger)]" role="alert">
                {view.message}
              </p>
              <SecondaryButton onClick={() => setRetry((count) => count + 1)} className="w-full">
                Reintentar
              </SecondaryButton>
            </div>
          ) : view.kind === "title_only" ? (
            <div className="space-y-3">
              <p className="t-body-strong">Solo tenemos el título</p>
              <p className="t-meta">
                {view.unreadableLink
                  ? "No hemos podido leer la ficha que tenía este plato."
                  : "Este plato no tiene ficha: no sabemos sus ingredientes, cantidades ni pasos."}
              </p>
              {view.catalog?.reviewedVersionId ? (
                <PrimaryButton
                  onClick={() => void applyCatalog(view.catalog!.reviewedVersionId!)}
                  disabled={busy !== null}
                  className="w-full"
                >
                  {busy === "catalog" ? "Enlazando receta…" : "Usar receta del catálogo"}
                </PrimaryButton>
              ) : (
                <>
                  {view.catalog ? (
                    <p className="t-meta rounded-[var(--radius-input)] bg-[color:var(--color-surface-muted)] px-3 py-2">
                      Es una receta del catálogo de beCook. Ficha pendiente de revisión.
                    </p>
                  ) : null}
                  {signedIn ? (
                    <div className="space-y-2">
                      <SecondaryButton onClick={() => void estimate()} disabled={busy !== null} className="w-full">
                        {busy === "ai" ? "Preparando ficha…" : "Crear ficha estimada (IA)"}
                      </SecondaryButton>
                      <p className="t-meta">
                        La IA estima ingredientes y pasos a partir del título; quedará marcada como sin revisar. Cuenta
                        en tu límite diario junto a las listas de la compra.
                      </p>
                    </div>
                  ) : (
                    <p className="t-meta">
                      <Link
                        href={loginHrefFor(loginReturnPath)}
                        className="inline-flex min-h-11 items-center font-semibold underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
                      >
                        Inicia sesión para crear una ficha estimada con IA
                      </Link>
                    </p>
                  )}
                </>
              )}
            </div>
          ) : null}

          {currentNotice ? (
            <p
              className={`t-meta ${currentNotice.tone === "error" ? "text-[color:var(--color-danger)]" : ""}`}
              role={currentNotice.tone === "error" ? "alert" : "status"}
            >
              {currentNotice.login ? (
                <Link
                  href={loginHrefFor(loginReturnPath)}
                  className="inline-flex min-h-11 items-center font-semibold underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
                >
                  {currentNotice.text}
                </Link>
              ) : (
                currentNotice.text
              )}
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-2 border-t border-[color:var(--color-border)] pt-4 sm:flex-row sm:justify-end">
            <TertiaryButton onClick={close} className="w-full sm:w-auto">
              Cerrar
            </TertiaryButton>
            <SecondaryButton
              onClick={() => {
                const current = slot;
                // Close the native dialog now, so it gives focus back to the dish before the
                // editor mounts and its field takes the focus (not after, which would steal it).
                dialogRef.current?.close();
                close();
                onChangeDish(current);
              }}
              aria-label={`Cambiar plato de la ${mealLabels[slot.meal].toLowerCase()} del ${slot.day}`}
              className="w-full sm:w-auto"
            >
              Cambiar plato
            </SecondaryButton>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
