import type { ButtonHTMLAttributes, ReactNode } from "react";

type CategoryPillProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  isCompleted?: boolean;
  isSelected?: boolean;
  label: string;
  meta?: ReactNode;
};

export function CategoryPill({
  className = "",
  isCompleted = false,
  isSelected = false,
  label,
  meta,
  type = "button",
  ...props
}: CategoryPillProps) {
  return (
    <button
      type={type}
      aria-pressed={isSelected}
      data-completed={isCompleted ? "true" : undefined}
      className={[
        "flex min-h-11 min-w-0 touch-manipulation items-center justify-between gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-left transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-150 ease-out focus-visible:shadow-focus active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100 sm:px-3.5",
        isCompleted
          ? "border-[color:color-mix(in_oklch,var(--color-success)_45%,transparent)] bg-[color:var(--color-success-soft)] text-[color:var(--color-success-hover)] hover:border-[color:var(--color-success)]"
          : isSelected
            ? "border-transparent bg-[color:var(--color-accent-strong)] bg-[image:var(--accent-gradient)] text-[color:var(--color-primary-foreground)] shadow-primary"
            : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-foreground)] shadow-xs hover:border-[color:var(--color-border-strong)]",
        className,
      ].join(" ")}
      {...props}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold capitalize leading-5 transition-colors duration-200 ease-out motion-reduce:transition-none">
          {label}
        </span>
        {meta ? (
          <span
            className={[
              "mt-0.5 block text-xs font-semibold leading-4 transition-colors duration-200 ease-out motion-reduce:transition-none",
              isCompleted
                ? "text-[color:var(--color-success-hover)]"
                : isSelected
                  ? "text-white"
                  : "text-[color:var(--color-muted-foreground)]",
            ].join(" ")}
          >
            {meta}
          </span>
        ) : null}
      </span>
    </button>
  );
}
