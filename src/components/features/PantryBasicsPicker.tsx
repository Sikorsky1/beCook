"use client";

import { Plus } from "lucide-react";
import { useId, useRef, useState } from "react";

import { pantryCategoryOrder, type PantryCategory } from "@/lib/pantryStorage";

type Basic = { name: string; category: PantryCategory };

type PantryBasicsPickerProps = {
  // The basics of the catalogue the pantry does not have yet.
  offered: Basic[];
  onAdd: (basics: Basic[]) => void;
};

// D5 (roadmap step 31): several basics at once instead of one add per item.
export function PantryBasicsPicker({ offered, onAdd }: PantryBasicsPickerProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const id = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  if (offered.length === 0) return null;

  const visible = selected.filter((name) => offered.some((basic) => basic.name === name));
  const toggle = (name: string) =>
    setSelected((current) => (current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name]));
  const groups = pantryCategoryOrder
    .map((category) => ({ category, basics: offered.filter((basic) => basic.category === category) }))
    .filter((group) => group.basics.length > 0);

  return (
    <div className="rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[var(--radius-card)] px-4 py-3 text-left"
      >
        <span className="t-body-strong text-[color:var(--color-foreground)]">Añadir básicos que sueles tener</span>
        <Plus aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-45" : ""}`} />
      </button>
      {open ? (
        <div id={`${id}-panel`} className="border-t border-[color:var(--color-border)] px-4 pb-4 pt-3">
          <p className="t-meta">Marca todos los que tengas y añádelos de una vez.</p>
          <div className="mt-3 space-y-3">
            {groups.map((group) => (
              <fieldset key={group.category}>
                <legend className="text-sm font-semibold capitalize text-[color:var(--color-foreground)]">{group.category}</legend>
                <div className="mt-1 grid gap-x-3 sm:grid-cols-2">
                  {group.basics.map((basic) => (
                    <label key={basic.name} className="flex min-h-11 cursor-pointer items-center gap-3 text-base text-[color:var(--color-foreground)]">
                      <input
                        type="checkbox"
                        aria-label={basic.name}
                        checked={visible.includes(basic.name)}
                        onChange={() => toggle(basic.name)}
                        className="h-6 w-6 shrink-0 cursor-pointer accent-[color:var(--color-accent-strong)]"
                      />
                      {basic.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <button
            type="button"
            disabled={visible.length === 0}
            onClick={() => {
              onAdd(offered.filter((basic) => visible.includes(basic.name)));
              setSelected([]);
              setOpen(false);
              // The panel closes: the focus goes back to the button that opened it.
              requestAnimationFrame(() => toggleRef.current?.focus());
            }}
            className="mt-4 min-h-11 rounded-[var(--radius-control)] bg-[color:var(--color-accent-strong)] bg-[image:var(--accent-gradient)] px-4 text-sm font-semibold text-white hover:bg-[color:var(--color-accent-strong-hover)] hover:bg-[image:var(--accent-gradient-hover)] disabled:opacity-60"
          >
            {visible.length === 0 ? "Elige uno o varios" : `Añadir ${visible.length} a la despensa`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
