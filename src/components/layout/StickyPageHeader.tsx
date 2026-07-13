import type { ReactNode } from "react";

type StickyPageHeaderProps = {
  title: string;
  heading?: string;
  action?: ReactNode;
  children?: ReactNode;
};

export function StickyPageHeader({
  title,
  heading,
  action,
  children,
}: StickyPageHeaderProps) {
  return (
    <section className="sticky top-0 z-30 -mx-3 shrink-0 border-b border-[color:var(--color-border)] bg-[color:var(--color-background)]/95 px-3 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur sm:-mx-6 sm:px-6">
      <div>
        <div className="flex items-center justify-between gap-3">
          <p className="t-eyebrow min-w-0">{title}</p>
          {action}
        </div>

        {heading ? (
          <h1 className="t-h1 mt-1.5 text-[color:var(--color-foreground)]">
            {heading}
          </h1>
        ) : null}

        {children ? <div className="mt-2.5">{children}</div> : null}
      </div>
    </section>
  );
}
