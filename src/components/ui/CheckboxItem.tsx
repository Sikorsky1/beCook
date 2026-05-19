import type { ReactNode } from "react";

type CheckboxItemProps = {
  checked: boolean;
  children?: ReactNode;
  label: string;
  meta?: ReactNode;
  onChange: () => void;
  status?: string;
  strikeWhenChecked?: boolean;
  valueBadge?: ReactNode;
};

export function CheckboxItem({
  checked,
  children,
  label,
  meta,
  onChange,
  status,
  strikeWhenChecked = false,
  valueBadge,
}: CheckboxItemProps) {
  return (
    <label
      data-checked={checked ? "true" : undefined}
      className={`flex min-h-16 touch-manipulation cursor-pointer items-center gap-3 px-4 py-3 transition-[background-color,color,transform] duration-200 ease-out active:scale-[0.995] motion-reduce:transition-none motion-reduce:active:scale-100 sm:gap-4 sm:px-5 ${
        checked
          ? "bg-[color:var(--color-surface-muted)] text-[color:var(--color-muted-foreground)]"
          : "text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent-soft)]/45"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-7 w-7 shrink-0 rounded-md border-[color:var(--color-border-strong)] accent-[color:var(--color-accent)] transition-transform duration-150 ease-out focus-visible:shadow-[0_0_0_4px_rgba(224,112,60,0.16)] active:scale-90 motion-reduce:transition-none motion-reduce:active:scale-100"
      />
      <span className="min-w-0 flex-1">
        <span
          className={`block text-base font-medium leading-6 transition-[color,opacity,text-decoration-color] duration-200 ease-out motion-reduce:transition-none sm:text-lg ${
            checked && strikeWhenChecked ? "line-through opacity-60" : ""
          }`}
        >
          {label}
        </span>
        {status ? (
          <span className="mt-0.5 block text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--color-muted-foreground)] transition-opacity duration-200 ease-out motion-reduce:transition-none">
            {status}
          </span>
        ) : null}
        {meta}
      </span>
      {valueBadge ? (
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold transition-colors duration-200 ease-out motion-reduce:transition-none ${
            checked
              ? "bg-white text-[color:var(--color-muted-foreground)]"
              : "bg-[color:var(--color-accent-soft)] text-[color:var(--color-foreground)]"
          }`}
        >
          {valueBadge}
        </span>
      ) : null}
      {children}
    </label>
  );
}
