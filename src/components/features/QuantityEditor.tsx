"use client";

import { Pencil } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";

import { formatShoppingAmount } from "@/lib/shopping/units";

type QuantityEditorProps = {
  name: string;
  quantity: number | null;
  unit: string;
  // One row with an amount (lines made of several rows of an old list, and «al gusto», are not).
  editable: boolean;
  // Items added by hand may change their unit too; items of the dishes keep it.
  manual: boolean;
  checked: boolean;
  onSave: (quantity: number, unit?: string) => void;
};

// D5 (roadmap step 31): the amount of a line, and the form to change it. Rendered inside a
// flex-wrap row: the amount sits on the right and the form takes the whole width below.
export function QuantityEditor({ name, quantity, unit, editable, manual, checked, onSave }: QuantityEditorProps) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [unitText, setUnitText] = useState(unit);
  const [error, setError] = useState("");
  const formId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Saving or cancelling closes the form and gives the focus back to the amount.
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const shown = formatShoppingAmount(quantity, unit);
  const badgeClass = `inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold ${
    checked ? "bg-white text-[color:var(--color-muted-foreground)]" : "bg-[color:var(--color-accent-soft)] text-[color:var(--color-foreground)]"
  }`;

  if (!editable || quantity === null) return <span className={badgeClass}>{shown}</span>;

  const openForm = () => {
    setAmount(String(quantity).replace(".", ","));
    setUnitText(unit);
    setError("");
    setOpen(true);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Number(amount.replace(",", ".").trim());
    if (!Number.isFinite(value) || value <= 0 || value > 100000) {
      setError("Escribe una cantidad mayor que 0.");
      return;
    }
    if (manual && !unitText.trim()) {
      setError("Escribe una unidad (por ejemplo, ud, g o paquete).");
      return;
    }
    onSave(value, manual ? unitText.trim() : undefined);
    close();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openForm())}
        aria-expanded={open}
        aria-controls={open ? formId : undefined}
        aria-label={`Cambiar la cantidad de ${name} (${shown})`}
        className={`${badgeClass} border border-transparent hover:border-[color:var(--color-border-strong)]`}
      >
        {shown}
        <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <form id={formId} onSubmit={submit} className="order-last mt-2 grid basis-full gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]" noValidate>
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[color:var(--color-foreground)]">Cantidad</span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${formId}-error` : undefined}
              className="min-h-11 w-full rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-white px-3 text-base text-[color:var(--color-foreground)]"
              autoFocus
            />
          </label>
          {manual ? (
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-[color:var(--color-foreground)]">Unidad</span>
              <input
                type="text"
                value={unitText}
                maxLength={40}
                onChange={(event) => setUnitText(event.target.value)}
                className="min-h-11 w-full rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-white px-3 text-base text-[color:var(--color-foreground)]"
              />
            </label>
          ) : (
            <p className="t-meta self-end pb-3">Unidad: {unit}</p>
          )}
          <button
            type="submit"
            className="min-h-11 self-end rounded-[var(--radius-control)] bg-[color:var(--color-accent-strong)] px-4 text-sm font-semibold text-white hover:bg-[color:var(--color-accent-strong-hover)]"
          >
            Guardar
          </button>
          <button
            type="button"
            onClick={close}
            className="min-h-11 self-end rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] px-4 text-sm font-semibold text-[color:var(--color-foreground)]"
          >
            Cancelar
          </button>
          {error ? (
            <p id={`${formId}-error`} role="alert" className="text-sm font-semibold text-[color:var(--color-danger)] sm:col-span-4">
              {error}
            </p>
          ) : null}
          {!manual ? (
            <p className="t-meta sm:col-span-4">
              Se mantiene mientras no cambien los platos que usan este ingrediente.
            </p>
          ) : null}
        </form>
      ) : null}
    </>
  );
}
