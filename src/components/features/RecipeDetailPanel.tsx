"use client";

import { ArrowLeft, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { mockRecipeCatalog } from "@/data/mockRecipes";
import { pantryHasItem, readPantryBase } from "@/lib/pantryStorage";

type RecipeDetailPanelProps = {
  recipeName: string | null;
  onClose: () => void;
};

export function RecipeDetailPanel({ recipeName, onClose }: RecipeDetailPanelProps) {
  const [visibleRecipe, setVisibleRecipe] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [pantryBase, setPantryBase] = useState<string[]>([]);
  const closingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closingTimerRef.current !== null) {
        window.clearTimeout(closingTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (recipeName !== null) {
      setVisibleRecipe(recipeName);
      setIsClosing(false);
      setPantryBase(readPantryBase());
    }
  }, [recipeName]);

  const handleClose = () => {
    setIsClosing(true);
    closingTimerRef.current = window.setTimeout(() => {
      closingTimerRef.current = null;
      setVisibleRecipe(null);
      setIsClosing(false);
      onClose();
    }, 400);
  };

  if (!visibleRecipe) return null;

  const ingredients = mockRecipeCatalog[visibleRecipe] ?? [];

  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-[color:var(--color-background)]"
      style={{
        animation: isClosing
          ? "panel-exit 380ms cubic-bezier(.22,.61,.36,1) both"
          : "panel-enter 380ms cubic-bezier(.22,.61,.36,1) both",
      }}
      aria-modal="true"
      role="dialog"
      aria-label={visibleRecipe}
    >
      <div className="mx-auto flex max-w-3xl flex-col px-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pt-6">
        <button
          type="button"
          onClick={handleClose}
          className="mb-5 flex w-fit items-center gap-1.5 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-1.5 text-sm font-semibold text-[color:var(--color-muted-foreground)] shadow-[var(--shadow-card)] transition-colors hover:text-[color:var(--color-foreground)]"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Volver
        </button>

        <h1 className="text-2xl font-semibold leading-tight text-[color:var(--color-foreground)] sm:text-3xl">
          {visibleRecipe}
        </h1>

        <section className="mt-5">
          <p className="ui-eyebrow mb-3">Ingredientes</p>
          {ingredients.length > 0 ? (
            <ul className="divide-y divide-[color:var(--color-border)] rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-[var(--shadow-card)]">
              {ingredients.map((ingredient) => {
                const inPantry = pantryHasItem(pantryBase, ingredient.name);
                return (
                  <li
                    key={ingredient.name}
                    className="flex items-center gap-3 px-4 py-3 sm:px-5"
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                        inPantry
                          ? "bg-[color:var(--color-secondary-soft)] text-[color:var(--color-secondary)]"
                          : "border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]"
                      }`}
                      aria-label={inPantry ? "En despensa" : "No en despensa"}
                    >
                      {inPantry ? (
                        <Check aria-hidden="true" className="h-3.5 w-3.5" />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1 text-base font-medium text-[color:var(--color-foreground)]">
                      {ingredient.name}
                    </span>
                    <span className="shrink-0 text-sm text-[color:var(--color-muted-foreground)]">
                      {ingredient.quantity} {ingredient.unit}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-[color:var(--color-muted-foreground)]">
              Sin información disponible.
            </p>
          )}
        </section>
      </div>
    </div>,
    document.body,
  );
}
