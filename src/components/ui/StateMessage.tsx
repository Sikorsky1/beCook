import type { ReactNode } from "react";

type StateMessageVariant = "loading" | "empty" | "error" | "success";

type StateMessageProps = {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  variant?: StateMessageVariant;
};

const stateClasses: Record<StateMessageVariant, string> = {
  loading: "border-[color:var(--color-warning)] bg-[color:var(--color-warning-soft)] text-[color:var(--color-warning-foreground)]",
  empty:
    "border-dashed border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] text-[color:var(--color-muted-foreground)]",
  error: "border-[color:var(--color-border)] bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger)]",
  success: "border-[color:var(--color-success)] bg-[color:var(--color-success-soft)] text-[color:var(--color-success-hover)]",
};

export function StateMessage({
  title,
  children,
  action,
  className = "",
  variant = "empty",
}: StateMessageProps) {
  return (
    <article
      className={[
        "rounded-[var(--radius-control)] border px-4 py-3 text-sm leading-6 shadow-[0_10px_24px_rgba(32,28,23,0.035)] transition-[background-color,border-color,color,box-shadow,opacity] duration-200 ease-out motion-reduce:transition-none",
        stateClasses[variant],
        className,
      ].join(" ")}
    >
      <p
        className={
          variant === "error"
            ? "font-semibold text-[color:var(--color-danger)]"
            : "font-semibold text-[color:var(--color-foreground)]"
        }
      >
        {title}
      </p>
      {children ? <div className="mt-1">{children}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </article>
  );
}
