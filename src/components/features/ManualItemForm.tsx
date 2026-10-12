"use client";

import { Plus } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { supermarketCategoryLabels, type SupermarketCategory } from "@/lib/shoppingList";

import { capitalize } from "./ShoppingSection";

export type ManualItemDraft = { name: string; quantity: number | null; unit: string; category: SupermarketCategory };

type ManualItemFormProps = {
  // Resolves with a message for the user (what happened with the item).
  onAdd: (draft: ManualItemDraft) => Promise<string>;
};

const fieldClass =
  "min-h-11 w-full rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-white px-3 text-base text-[color:var(--color-foreground)]";

// D5 (roadmap step 31): add something that is not in the menu (papel de cocina, leche…). It goes to
// this week's list; without connection it stays on this device and is sent later.
export function ManualItemForm({ onAdd }: ManualItemFormProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("ud");
  const [category, setCategory] = useState<SupermarketCategory>("otros");
  const [error, setError] = useState("");
  // Which field the error is about (its input gets aria-invalid and the message).
  const [errorField, setErrorField] = useState<"name" | "quantity" | null>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  // While saving, the submit button is disabled and the focus would fall to the page: it goes back
  // to «Artículo», ready for the next item (or to fix this one).
  const nameInputRef = useRef<HTMLInputElement>(null);
  const focusOpenButton = useRef(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const id = useId();

  // Closing the form gives the focus back to the button that opened it.
  useEffect(() => {
    if (!open && focusOpenButton.current) {
      focusOpenButton.current = false;
      openButtonRef.current?.focus();
    }
  }, [open]);

  const reset = () => {
    setName("");
    setQuantity("1");
    setUnit("ud");
    setError("");
    setErrorField(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanName = name.trim().replace(/\s+/g, " ");
    const amount = quantity.trim() === "" ? 1 : Number(quantity.replace(",", ".").trim());
    if (!cleanName) {
      setError("Escribe qué quieres añadir.");
      setErrorField("name");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
      setError("Escribe una cantidad mayor que 0.");
      setErrorField("quantity");
      return;
    }
    setError("");
    setErrorField(null);
    setSaving(true);
    try {
      setMessage(await onAdd({ name: cleanName, quantity: amount, unit: unit.trim() || "ud", category }));
      reset();
    } finally {
      setSaving(false);
      nameInputRef.current?.focus();
    }
  };

  return (
    <div className="space-y-2">
      {open ? (
        <form id={`${id}-form`} onSubmit={submit} noValidate className="rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4">
          <h2 className="t-h3 text-[color:var(--color-foreground)]">Añadir algo que no está en el menú</h2>
          <p className="t-meta mt-1">Solo para la lista de esta semana. Los platos no lo cambian.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 sm:col-span-2">
              <span className="text-sm font-semibold text-[color:var(--color-foreground)]">Artículo</span>
              <input
                ref={nameInputRef}
                type="text"
                value={name}
                maxLength={120}
                required
                autoComplete="off"
                aria-invalid={errorField === "name" ? true : undefined}
                aria-describedby={errorField === "name" ? `${id}-error` : undefined}
                className={fieldClass}
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
            </label>
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-[color:var(--color-foreground)]">Cantidad</span>
              <input
                type="text"
                inputMode="decimal"
                value={quantity}
                aria-invalid={errorField === "quantity" ? true : undefined}
                aria-describedby={errorField === "quantity" ? `${id}-error` : undefined}
                className={fieldClass}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-[color:var(--color-foreground)]">Unidad</span>
              <input type="text" value={unit} maxLength={40} className={fieldClass} onChange={(event) => setUnit(event.target.value)} />
            </label>
            <label className="grid gap-1 sm:col-span-2">
              <span className="text-sm font-semibold text-[color:var(--color-foreground)]">Sección</span>
              <select value={category} className={fieldClass} onChange={(event) => setCategory(event.target.value as SupermarketCategory)}>
                {supermarketCategoryLabels.map((label) => (
                  <option key={label} value={label}>
                    {capitalize(label)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error ? (
            <p id={`${id}-error`} role="alert" className="mt-3 text-sm font-semibold text-[color:var(--color-danger)]">
              {error}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={saving}
              className="min-h-11 rounded-[var(--radius-control)] bg-[color:var(--color-accent-strong)] px-4 text-sm font-semibold text-white hover:bg-[color:var(--color-accent-strong-hover)] disabled:opacity-60"
            >
              {saving ? "Añadiendo…" : "Añadir a la lista"}
            </button>
            <button
              type="button"
              onClick={() => {
                focusOpenButton.current = true;
                setOpen(false);
                reset();
              }}
              className="min-h-11 rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] px-4 text-sm font-semibold text-[color:var(--color-foreground)]"
            >
              Cerrar
            </button>
          </div>
        </form>
      ) : (
        <button
          ref={openButtonRef}
          type="button"
          aria-expanded={false}
          onClick={() => {
            setMessage("");
            setOpen(true);
          }}
          className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] px-4 text-sm font-semibold text-[color:var(--color-foreground)]"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Añadir un artículo
        </button>
      )}
      <p role="status" className="t-meta px-1 empty:hidden">
        {message}
      </p>
    </div>
  );
}
