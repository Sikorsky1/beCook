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
        "flex min-h-12 min-w-0 touch-manipulation items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-200 ease-out hover:-translate-y-0.5 focus-visible:shadow-[0_0_0_4px_rgba(224,112,60,0.16)] active:translate-y-0 active:scale-[0.98] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-65 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100 sm:min-h-[3.25rem] sm:px-3.5",
        isCompleted
          ? "border-[#6b7f4a] bg-[color:var(--color-success-soft)] text-[#55633a] shadow-[0_10px_24px_rgba(107,127,74,0.12)] hover:border-[#55633a]"
          : isSelected
            ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-white shadow-[0_14px_28px_rgba(224,112,60,0.18)]"
            : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-foreground)] hover:border-[color:var(--color-border-strong)]",
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
              "mt-0.5 block text-[0.7rem] font-semibold leading-4 transition-colors duration-200 ease-out motion-reduce:transition-none",
              isCompleted
                ? "text-[#55633a]"
                : isSelected
                  ? "text-white/72"
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
