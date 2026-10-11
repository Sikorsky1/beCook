import type { HTMLAttributes, ReactNode } from "react";

type StatusPillProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function StatusPill({
  children,
  className = "",
  ...props
}: StatusPillProps) {
  return (
    <div
      className={[
        "inline-flex w-fit shrink-0 items-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-1.5 text-sm font-semibold text-[color:var(--color-muted-foreground)] shadow-[0_10px_24px_rgba(32,28,23,0.045)] sm:px-4 sm:py-2",
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}

