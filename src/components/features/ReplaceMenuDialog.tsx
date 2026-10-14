"use client";

import { useEffect, useRef } from "react";

import { PrimaryButton, TertiaryButton } from "@/components/ui/Button";
import type { WeekDay } from "@/data/mockWeek";

// D3, step 26: replacing a week's menu is confirmed here, not with the browser's dialog. It names
// the week, shows the menu that is replaced and what happens to the shopping list.
type ReplaceMenuDialogProps = {
  open: boolean;
  weekTitle: string;
  weekDates: string;
  current: WeekDay[];
  signedIn: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const mealText = (value: string) => (value === "LIBRE" || !value.trim() ? "Libre" : value);

export function ReplaceMenuDialog({
  open,
  weekTitle,
  weekDates,
  current,
  signedIn,
  onConfirm,
  onCancel,
}: ReplaceMenuDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // autoFocus does not act here (the dialog opens after mounting): the safe choice gets focus.
      keepRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="replace-menu-title"
      aria-describedby="replace-menu-consequences"
      onCancel={(event) => {
        // Escape keeps the current menu.
        event.preventDefault();
        onCancel();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-0 text-[color:var(--color-foreground)] shadow-pop backdrop:bg-[color:var(--color-foreground)]/40"
    >
      {/* Only the content scrolls: the two actions stay visible on short screens (320×640). */}
      <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 pb-3">
          <div>
            <h2 id="replace-menu-title" className="t-h2 text-[color:var(--color-foreground)]">
              ¿Reemplazar el menú de la {weekTitle}?
            </h2>
            <p className="t-meta mt-1">{weekDates}</p>
          </div>

          <div>
            <p className="t-body-strong">Menú que se reemplaza</p>
            <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto rounded-[var(--radius-input)] bg-[color:var(--color-surface-muted)] px-3 py-2.5 text-sm leading-5">
              {current.map((day) => (
                <li key={day.day} className="min-w-0">
                  <span className="font-semibold">{day.day}:</span>{" "}
                  <span className="break-words">
                    {mealText(day.lunch)} · {mealText(day.dinner)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <ul id="replace-menu-consequences" className="list-disc space-y-1.5 pl-5 text-sm leading-6">
            <li>La propuesta sustituye este menú entero; los platos no se mezclan.</li>
            <li>
              {signedIn
                ? "Si tienes lista de la compra para esta semana, se preparará otra para los platos nuevos y las marcas de la lista actual no pasan a ella."
                : "Si tienes lista de la compra para esta semana, dejará de corresponder al menú."}
            </li>
            <li>La despensa no cambia.</li>
            <li>Justo después podrás deshacerlo durante unos segundos.</li>
          </ul>
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-[color:var(--color-border)] px-5 pt-3 pb-5 sm:flex-row sm:justify-end">
          <TertiaryButton ref={keepRef} onClick={onCancel} autoFocus className="w-full sm:w-auto">
            Mantener el actual
          </TertiaryButton>
          <PrimaryButton onClick={onConfirm} className="w-full sm:w-auto">
            Reemplazar menú
          </PrimaryButton>
        </div>
      </div>
    </dialog>
  );
}
