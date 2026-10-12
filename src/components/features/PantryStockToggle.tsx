"use client";

type PantryStockToggleProps = {
  name: string;
  active: boolean;
  onChange: (active: boolean) => void;
};

const optionClass = "min-h-11 rounded-[calc(var(--radius-control)-2px)] px-3 text-sm font-semibold transition-colors duration-150 ease-out motion-reduce:transition-none";

// D5 (roadmap step 31): «Tengo / Se acabó» as two explicit buttons (one pressed). It replaces the
// pantry checkbox, which meant something else than the checkbox of Compra (bought).
export function PantryStockToggle({ name, active, onChange }: PantryStockToggleProps) {
  return (
    <div
      role="group"
      aria-label={`¿Tienes ${name} en casa?`}
      className="inline-flex shrink-0 rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)] p-0.5"
    >
      <button
        type="button"
        aria-pressed={active}
        onClick={() => {
          if (!active) onChange(true);
        }}
        className={`${optionClass} ${
          active
            ? "bg-[color:var(--color-success-soft)] text-[color:var(--color-success-hover)] shadow-[inset_0_0_0_1px_var(--color-success)]"
            : "text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
        }`}
      >
        Tengo
      </button>
      <button
        type="button"
        aria-pressed={!active}
        onClick={() => {
          if (active) onChange(false);
        }}
        className={`${optionClass} ${
          !active
            ? "bg-[color:var(--color-warning-soft)] text-[color:var(--color-foreground)] shadow-[inset_0_0_0_1px_var(--color-warning)]"
            : "text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
        }`}
      >
        Se acabó
      </button>
    </div>
  );
}
