import type { ReactNode } from "react";

import { pageBleedClass } from "@/lib/ui";

type StickyPageHeaderProps = {
  // Section name, always visible in the fixed bar.
  title: string;
  // The page's h1 and what goes under it (tabs, week line): they scroll away.
  heading?: ReactNode;
  headingLabel?: string;
  children?: ReactNode;
  // Right side of the fixed bar (progress, week arrows).
  action?: ReactNode;
  // Fixed row under the bar (section links, day strip), for what is needed while scrolling.
  pinned?: ReactNode;
};

// Step 34: a header that compacts with CSS only. Its three parts are siblings in the page column
// (a sticky element only sticks inside its parent): the bar (56 px + top safe area) and the pinned
// row (57 px) stick; the h1 block between them scrolls. At most 113 px stay fixed.
// The pinned row sticks right under the bar: its `top` is the bar's height.
// The scrolling block cancels the gap of pageStickyColumnClass (gap-4 sm:gap-5) to sit close to the bar.
export function StickyPageHeader({
  title,
  heading,
  headingLabel,
  children,
  action,
  pinned,
}: StickyPageHeaderProps) {
  const surface = "bg-[color:var(--color-background)]/90 backdrop-blur-md";

  return (
    <>
      <div
        data-sticky-header
        className={`sticky top-0 z-30 shrink-0 pt-[env(safe-area-inset-top)] ${pageBleedClass} ${surface} ${
          pinned ? "" : "border-b border-[color:var(--color-border)]"
        }`}
      >
        <div className="flex h-14 items-center justify-between gap-3">
          <p className="line-clamp-2 min-w-0 text-[0.9375rem] font-semibold tracking-[-0.01em] text-[color:var(--color-foreground)]">{title}</p>
          {action}
        </div>
      </div>

      {heading || children ? (
        <div className="-mt-4 sm:-mt-5">
          {heading ? (
            <h1
              aria-label={headingLabel}
              className="t-h1 text-balance text-[color:var(--color-foreground)]"
            >
              {heading}
            </h1>
          ) : null}
          {children ? <div className={heading ? "mt-2.5" : ""}>{children}</div> : null}
        </div>
      ) : null}

      {pinned ? (
        <div
          className={`sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-30 shrink-0 border-b border-[color:var(--color-border)] py-1.5 ${pageBleedClass} ${surface}`}
        >
          {pinned}
        </div>
      ) : null}
    </>
  );
}
