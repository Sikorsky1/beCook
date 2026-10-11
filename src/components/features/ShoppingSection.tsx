"use client";

import { useId } from "react";

import { QuantityEditor } from "@/components/features/QuantityEditor";
import { Card } from "@/components/ui/Card";
import { shoppingLineLabels, type ShoppingLineStatus } from "@/lib/shopping/build";
import { formatShoppingAmount } from "@/lib/shopping/units";
import type { ShoppingViewItem, SupermarketCategory } from "@/lib/shoppingList";

// Anchor of a section of the list («#compra-fruteria»), used by the quick links of the header.
export function shoppingSectionId(category: SupermarketCategory | "en-casa") {
  return `compra-${category.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "-")}`;
}

export const capitalize = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

export type ShoppingRowData = {
  item: ShoppingViewItem;
  status: ShoppingLineStatus;
  checked: boolean;
  // «Para: Lunes comida, …» (empty for items added by hand or no longer needed).
  forDishes: string[];
  // Bought and not in the pantry yet: «Añadir a despensa» is offered.
  canAddToPantry: boolean;
};

export type ShoppingRowActions = {
  onToggle: (item: ShoppingViewItem) => void;
  onSaveQuantity: (item: ShoppingViewItem, quantity: number, unit?: string) => void;
  onRemove: (item: ShoppingViewItem) => void;
  onAddToPantry: (item: ShoppingViewItem) => void;
};

// Where the focus goes when a line disappears: the next (or previous) line's checkbox, else the
// next (or previous) block of the list (a section title, the folded group, the add form).
export function focusTargetAfterRemoval(from: HTMLElement): HTMLElement | null {
  const line = from.closest("li");
  const sibling = line?.nextElementSibling ?? line?.previousElementSibling;
  if (sibling) return sibling.querySelector<HTMLElement>('input[type="checkbox"], button');
  const block = line?.closest("section");
  const other = block?.nextElementSibling ?? block?.previousElementSibling;
  return other?.querySelector<HTMLElement>("h2[tabindex], summary, button") ?? null;
}

const secondaryButtonClass =
  "inline-flex min-h-11 items-center rounded-[var(--radius-control)] px-2 text-sm font-semibold text-[color:var(--color-accent-hover)] underline-offset-4 hover:underline";

// One line: a checkbox with its own name (never the browser's «on»), what it is for, its state and
// its actions (amount, remove an item added by hand, add a bought item to the pantry).
export function ShoppingRow({ row, actions }: { row: ShoppingRowData; actions: ShoppingRowActions }) {
  const { item, status, checked, forDishes, canAddToPantry } = row;
  const baseId = useId();
  const name = capitalize(item.name);
  const amount = formatShoppingAmount(item.quantity, item.unit);
  const strike = checked && status !== "review";

  return (
    <li
      className={`transition-colors duration-200 ease-out motion-reduce:transition-none ${
        checked ? "bg-[color:var(--color-surface-muted)] text-[color:var(--color-muted-foreground)]" : "text-[color:var(--color-foreground)]"
      }`}
    >
      <div className="flex flex-wrap items-start gap-x-2 px-2 py-2 sm:px-3">
        <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
          <input
            id={`${baseId}-check`}
            type="checkbox"
            checked={checked}
            aria-label={`${name}, ${amount}`}
            aria-describedby={`${baseId}-state`}
            onChange={() => actions.onToggle(item)}
            className="h-6 w-6 cursor-pointer accent-[color:var(--color-accent-strong)]"
          />
        </label>
        <div className="min-w-0 flex-1 py-2.5">
          <label htmlFor={`${baseId}-check`} className={`t-body-strong block cursor-pointer ${strike ? "line-through opacity-70" : ""}`}>
            {name}
          </label>
          <div id={`${baseId}-state`} className="mt-1 space-y-1">
            {forDishes.length > 0 ? <p className="t-meta">Para: {forDishes.join(", ")}</p> : null}
            {item.manual ? <p className="t-meta">Añadido por ti</p> : null}
            {item.adjusted && !item.manual ? <p className="t-meta">Cantidad cambiada por ti</p> : null}
            {status === "review" ? (
              <p className="inline-flex w-fit rounded-full bg-[color:var(--color-warning-soft)] px-2.5 py-1 text-sm font-semibold text-[color:var(--color-foreground)]">
                Revisar: ahora hace falta más de lo que compraste
              </p>
            ) : checked ? (
              <p className="text-sm font-semibold">{shoppingLineLabels[status]}</p>
            ) : null}
          </div>
          {item.manual || canAddToPantry ? (
            <div className="mt-1 flex flex-wrap gap-x-2">
              {canAddToPantry ? (
                <button
                  type="button"
                  onClick={(event) => {
                    // The button goes away once it is in the pantry: the focus stays on the line.
                    const checkbox = event.currentTarget.closest("li")?.querySelector<HTMLElement>('input[type="checkbox"]');
                    actions.onAddToPantry(item);
                    requestAnimationFrame(() => checkbox?.focus());
                  }}
                  className={secondaryButtonClass}
                  aria-label={`Añadir a despensa: ${name}`}
                >
                  Añadir a despensa
                </button>
              ) : null}
              {item.manual ? (
                <button
                  type="button"
                  onClick={(event) => {
                    const target = focusTargetAfterRemoval(event.currentTarget);
                    actions.onRemove(item);
                    requestAnimationFrame(() => target?.focus());
                  }}
                  className={secondaryButtonClass}
                  aria-label={`Quitar ${name} de la lista`}
                >
                  Quitar
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex py-0.5">
          <QuantityEditor
            name={name}
            quantity={item.quantity}
            unit={item.unit}
            editable={item.editable && !item.removed}
            manual={item.manual}
            checked={checked}
            onSave={(quantity, unit) => actions.onSaveQuantity(item, quantity, unit)}
          />
        </div>
      </div>
    </li>
  );
}

type ShoppingSectionProps = {
  category: SupermarketCategory;
  rows: ShoppingRowData[];
  // Needed lines of the section and how many are bought (lines no longer needed do not count).
  done: number;
  total: number;
  actions: ShoppingRowActions;
};

// D5 (roadmap step 30): one section of the continuous list, reachable from the header's links
// (scroll margin so the sticky header does not cover its title).
export function ShoppingSection({ category, rows, done, total, actions }: ShoppingSectionProps) {
  const id = shoppingSectionId(category);
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-64">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 id={`${id}-title`} tabIndex={-1} className="t-h3 text-[color:var(--color-foreground)]">
          {capitalize(category)}
        </h2>
        <p className="t-meta">{done} de {total} comprados</p>
      </div>
      <Card className="mt-2 overflow-visible">
        <ul className="divide-y divide-[color:var(--color-border)]">
          {rows.map((row) => (
            <ShoppingRow key={row.item.id} row={row} actions={actions} />
          ))}
        </ul>
      </Card>
    </section>
  );
}
