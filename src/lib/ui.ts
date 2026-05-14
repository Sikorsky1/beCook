export const pageShellClass =
  "min-h-screen bg-[color:var(--color-background)] px-4 py-5 text-[color:var(--color-foreground)] sm:px-6 sm:py-8";

export const pageContainerClass =
  "mx-auto flex w-full max-w-7xl flex-col gap-6";

export const panelClass =
  "overflow-hidden rounded-[var(--radius-card)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-[var(--shadow-card)]";

export const panelSectionClass =
  "border-[color:var(--color-border)]";

export const buttonPrimaryClass =
  "inline-flex min-h-12 items-center justify-center rounded-[calc(var(--radius-control)-0.125rem)] border border-transparent bg-[color:var(--color-accent)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[color:var(--color-accent-hover)] disabled:cursor-not-allowed disabled:bg-stone-300";

export const buttonSecondaryClass =
  "inline-flex min-h-12 items-center justify-center rounded-[calc(var(--radius-control)-0.125rem)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-5 text-sm font-semibold text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)] disabled:cursor-not-allowed disabled:text-stone-400";

export const navButtonClass =
  "flex min-h-14 items-center justify-center px-4 text-center text-sm font-semibold tracking-[-0.02em] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)]";

export const inputClass =
  "w-full rounded-[var(--radius-control)] border border-[color:var(--color-border)] bg-white px-4 py-3.5 text-sm text-[color:var(--color-foreground)] outline-none transition-colors placeholder:text-[color:var(--color-muted-foreground)] focus:bg-[color:var(--color-surface)] sm:text-[15px]";

export const textareaClass = `${inputClass} min-h-72 leading-6`;

export const listCardClass =
  "rounded-[calc(var(--radius-card)-0.375rem)] border border-[color:var(--color-border)] bg-white px-4 py-3.5 transition-colors";

export const badgeClass =
  "shrink-0 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)] px-3 py-1 text-sm font-semibold text-[color:var(--color-foreground)]";
