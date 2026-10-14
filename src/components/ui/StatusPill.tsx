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
        "inline-flex w-fit shrink-0 items-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-1 text-[0.8125rem] font-semibold text-[color:var(--color-muted-foreground)] shadow-xs",
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}

