// Page shells and the full-bleed band. Side paddings keep the safe areas (viewport-fit=cover).
const pageShellBaseClass =
  "min-h-screen bg-[color:var(--color-background)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(7.5rem+env(safe-area-inset-bottom))] text-[color:var(--color-foreground)] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] sm:pb-[calc(7.75rem+env(safe-area-inset-bottom))]";

// Screens without a fixed header (onboarding, Crear menú, account screens).
export const pageShellClass = `${pageShellBaseClass} pt-5 sm:pt-8`;

// Step 34: screens with StickyPageHeader. No top padding: the header bar adds the top safe area
// itself, so it is at the top of the screen also before scrolling.
export const pageShellStickyClass = pageShellBaseClass;

// Step 34: a band that reaches the edges of the shell (header bar, pinned row, bottom save bar),
// cancelling the shell's side padding and putting it back inside.
export const pageBleedClass =
  "-ml-[max(1rem,env(safe-area-inset-left))] -mr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:-ml-[max(1.5rem,env(safe-area-inset-left))] sm:-mr-[max(1.5rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))]";

// Step 34: the column of the screens with StickyPageHeader. Its gap (gap-4 sm:gap-5) is what the
// header's scrolling block cancels with -mt-4 sm:-mt-5: change both together.
export const pageStickyColumnClass = "mx-auto flex w-full max-w-3xl flex-col gap-4 sm:gap-5";

export const pageContentClass =
  "mx-auto flex w-full max-w-6xl flex-col gap-10 sm:gap-12";
