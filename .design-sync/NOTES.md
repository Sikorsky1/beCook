# BeCook design-sync notes

## Setup facts

- BeCook is a Next.js app (no library dist/). The converter runs in synth-entry mode via `--entry ./ds-entry.ts`.
- Tailwind v4 + PostCSS: `globals.css` uses `@import "tailwindcss"` which the converter can't process directly. Run `node .design-sync/build-css.mjs` first to generate `ds-css/styles.css` (the actual compiled Tailwind CSS + tokens). This file is gitignored (generated).
- 11 components synced: 9 from `src/components/ui/`, 2 from `src/components/layout/`.

## Excluded components (and why)

- `BottomNavigation`, `ShoppingTabs`: use `next/link` and `usePathname()` — Next.js-specific, can't bundle outside Next.js runtime.
- `SelectedDayCard`, `ImportedDayPreview`, `DaySelector`, `DayCard`: coupled to `@/data/mockWeek` and app state.
- `pages/`: all page components use Supabase hooks and Next.js router.

## Build command (re-syncs)

```bash
node .design-sync/build-css.mjs   # regenerate Tailwind CSS
node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules ./node_modules --entry ./ds-entry.ts --out ./ds-bundle
node .ds-sync/package-validate.mjs ./ds-bundle
```

## Known render warns

- SectionHeader: floor card (no authored preview, typographic placeholder) — intentional, component needs `eyebrow` + optional `title`/`children`.

## Re-sync risks

- `ds-css/styles.css` is generated from `globals.css` via Tailwind. If colors or tokens change in `globals.css`, regenerate via `node .design-sync/build-css.mjs` before re-syncing.
- `ds-entry.ts` explicitly exports 11 components. Adding new UI components to `src/components/ui/` requires a manual edit to `ds-entry.ts` and a re-sync.
- `conventions.md` enumerates real prop names and CSS variables. If component APIs change (e.g., Button variant names), re-validate that header names still resolve in the bundle.
- Playwright lives in `.ds-sync/node_modules/` (gitignored). On a fresh clone, stage the scripts and install deps with: `mkdir -p .ds-sync && cp -r <skill-base-dir>/* .ds-sync/ && cd .ds-sync && npm i esbuild ts-morph @types/react playwright`. Then run `node .ds-sync/playwright-core/cli.js install chromium` (or use the Playwright CLI) to download Chromium (~94MB).
