# BeCook UI — Conventions for the design agent

## Wrapping and setup

No provider or root wrapper required. Import any component directly from the bundle and render it. All components are self-contained.

```jsx
import { Button, Card, CategoryPill } from 'becook';

// Works without any wrapper
<Card style={{ padding: '1.25rem' }}>
  <CategoryPill label="Vegetariano" />
</Card>
```

## Styling idiom

**BeCook uses two layers:**

**1. Component self-styling** — all `BeCookUI.*` components carry their own styles. Pass props, not class overrides. Key props:

| Component | Variant/state prop | Values |
|---|---|---|
| Button | `variant` | `"primary"` (orange) · `"secondary"` (green) · `"soft"` (neutral) · `"danger"` |
| CategoryPill | `isSelected`, `isCompleted` | boolean; controls fill color |
| StateMessage | `variant` | `"loading"` · `"empty"` · `"error"` · `"success"` |
| CheckboxItem | `checked`, `strikeWhenChecked` | required: `checked`, `label`, `onChange` |

**2. Layout glue** — use Tailwind utility classes (available via `_ds_bundle.css`) or CSS custom properties for anything you build around the components.

**Design tokens** (always use these, never hardcode colors):

```css
/* Palette */
var(--color-accent)          /* #e0703c — primary orange */
var(--color-secondary)       /* #6b7f4a — olive green */
var(--color-background)      /* #fff6ed — warm cream page bg */
var(--color-surface)         /* #fffcf8 — card/panel bg */
var(--color-surface-muted)   /* #f6f0e6 — muted surface */
var(--color-border)          /* #e8d5b5 — default border */
var(--color-foreground)      /* #2e2a26 — body text */
var(--color-muted-foreground)/* #68665c — secondary text */
var(--color-accent-soft)     /* #fff0e3 — accent tint bg */
var(--color-success-soft)    /* #eef3e4 — success tint bg */
var(--color-danger-soft)     /* #fff0e3 — danger tint bg */

/* Radius */
var(--radius-card)    /* 1.5rem — Card, large containers */
var(--radius-control) /* 1rem   — Button, interactive controls */
var(--radius-input)   /* 0.875rem — TextInput, TextArea */
var(--radius-chip)    /* 999px  — CategoryPill, pills */
```

**Typography utility classes** (from the DS, not standard Tailwind):

```css
.ui-eyebrow  /* uppercase · tracking · 0.7rem · muted — section labels */
.ui-title    /* bold · tight tracking — hero titles */
.ui-copy     /* muted · line-height 1.7 — body copy */
```

## Where the truth lives

- Per-component API: `components/<group>/<Name>/<Name>.prompt.md`
- All tokens: `styles.css` → `_ds_bundle.css` (full `:root {}` block)
- Live components: `window.BeCookUI.*` in the rendered page

## Idiomatic build snippet

A typical BeCook screen: sticky header, scrollable list, bottom navigation slot.

```jsx
import { StickyPageHeader, SectionHeader, CheckboxItem, StateMessage } from 'becook';

function ShoppingScreen() {
  return (
    <div style={{ background: 'var(--color-background)', minHeight: '100vh', fontFamily: 'system-ui' }}>
      <StickyPageHeader
        title="Esta semana"
        heading="Lista de la compra"
        action={<Button variant="soft" style={{ fontSize: '0.75rem' }}>Compartir</Button>}
      />

      <div style={{ padding: '1rem 1rem 6rem' }}>
        <SectionHeader eyebrow="Pendiente" />
        <div style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
          <CheckboxItem checked={false} label="Tomates cherry 250g" onChange={() => {}} valueBadge="×2" />
          <CheckboxItem checked={false} label="Aceite de oliva virgen" onChange={() => {}} />
          <CheckboxItem checked={true} label="Limones" onChange={() => {}} strikeWhenChecked />
        </div>
      </div>
    </div>
  );
}
```

The grouped list pattern (border on the container, items inside without gaps) is BeCook's standard for shopping and menu lists.
