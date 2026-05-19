import type { ReactNode } from "react";

type SectionHeaderProps = {
  eyebrow: string;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
};

export function SectionHeader({
  eyebrow,
  title,
  children,
  action,
}: SectionHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="ui-eyebrow text-[0.78rem]">{eyebrow}</p>
        {title ? (
          <h2 className="mt-3 text-2xl font-semibold leading-tight text-[color:var(--color-foreground)] sm:text-3xl">
            {title}
          </h2>
        ) : null}
        {children ? <div className="ui-copy mt-2 text-base">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

