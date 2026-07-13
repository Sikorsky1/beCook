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
        <p className="t-eyebrow">{eyebrow}</p>
        {title ? (
          <h2 className="t-h2 mt-2.5 text-[color:var(--color-foreground)]">
            {title}
          </h2>
        ) : null}
        {children ? <div className="ui-copy mt-2 text-base">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

