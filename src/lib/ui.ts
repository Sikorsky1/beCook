export const pageShellClass =
  "min-h-screen bg-[color:var(--color-background)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-5 text-[color:var(--color-foreground)] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] sm:pb-[calc(7.75rem+env(safe-area-inset-bottom))] sm:pt-8";

export const pageContainerClass =
  "mx-auto flex w-full max-w-7xl flex-col gap-6";

export const pageContentClass =
  "mx-auto flex w-full max-w-6xl flex-col gap-10 sm:gap-12";

export const pageHeroClass = "pt-5 sm:pt-8 lg:pt-12";

export const pageHeroInnerClass =
  "flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between";

export const pageHeroCopyClass = "max-w-3xl";

export const pageActionsClass = "flex w-full flex-col gap-3 lg:max-w-[20rem]";

export const sectionBlockClass =
  "space-y-6 border-t border-[color:var(--color-border)] pt-8 sm:space-y-8";

export const sectionHeaderClass =
  "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between";

export const panelClass =
  "overflow-hidden rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-[var(--shadow-card)]";

export const panelSectionClass =
  "border-[color:var(--color-border)]";

export const buttonPrimaryClass =
  "inline-flex min-h-12 items-center justify-center rounded-[calc(var(--radius-control)-0.125rem)] border border-transparent bg-[color:var(--color-accent)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[color:var(--color-accent-hover)] disabled:cursor-not-allowed disabled:bg-[color:var(--color-border)] disabled:text-[color:var(--color-muted-foreground)]";

export const buttonSecondaryClass =
  "inline-flex min-h-12 items-center justify-center rounded-[calc(var(--radius-control)-0.125rem)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-5 text-sm font-semibold text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)] disabled:cursor-not-allowed disabled:text-[color:var(--color-border-strong)]";

export const buttonGhostClass =
  "inline-flex min-h-12 items-center justify-center rounded-[calc(var(--radius-control)-0.125rem)] border border-[color:var(--color-border)] bg-transparent px-5 text-sm font-semibold text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)] disabled:cursor-not-allowed disabled:text-[color:var(--color-border-strong)]";

export const navButtonClass =
  "flex min-h-14 items-center justify-center px-4 text-center text-sm font-semibold tracking-[-0.02em] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)]";

export const inputClass =
  "w-full rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-white px-4 py-3.5 text-sm text-[color:var(--color-foreground)] outline-none transition-colors placeholder:text-[color:var(--color-muted-foreground)] focus:border-[color:var(--color-accent)] focus:bg-[color:var(--color-surface)] sm:text-[15px]";

export const textareaClass = `${inputClass} min-h-72 leading-6`;

export const listCardClass =
  "rounded-[calc(var(--radius-card)-0.375rem)] border border-[color:var(--color-border)] bg-white px-4 py-3.5 transition-colors";

export const badgeClass =
  "shrink-0 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)] px-3 py-1 text-sm font-semibold text-[color:var(--color-foreground)]";

export const statusPillClass =
  "inline-flex w-fit items-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-2 text-sm font-medium text-[color:var(--color-muted-foreground)] shadow-[var(--shadow-card)]";

export const cardClass =
  "rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-[var(--shadow-card)]";

export const emptyStateClass =
  "rounded-[var(--radius-card)] border border-dashed border-[color:var(--color-border-strong)] p-6 sm:p-7";
