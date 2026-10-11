# Plan de accesibilidad · paso 33 · componentes compartidos de alto riesgo

Fecha: 2026-10-11 · Rama de trabajo: `audit/a11y` (desde `audit-opt` 02aa5b8)
Estado: **propuesta pendiente de aprobación de Sergio**. Nada de este documento está aplicado.

Las pantallas y componentes de feature del paso 33 ya están corregidos en la rama (ver
`docs/development/progress-a11y.md`). Este plan recoge lo que, según `AGENTS.md`, no se puede
tocar sin aprobación: `globals.css`, `src/components/ui/*`, `src/components/shadcn/ui/*`,
`src/components/layout/*`, `src/app/layout.tsx`, `src/lib/ui.ts` y `AuthPageShell.tsx`.

## Cómo se ha medido

- Contraste: fórmula WCAG 2.x de luminancia relativa (script local), sobre los valores hex de
  `:root` en `src/app/globals.css`. Umbrales: 4,5:1 texto normal; 3:1 texto grande
  (≥ 18,66 px en negrita) y elementos no textuales (bordes de foco, iconos).
- Tamaños: 1 rem = 16 px. Objetivo de lectura habitual ≥ 13 px (`t-meta`), campos de formulario
  16 px (por debajo, Safari iOS hace zoom al enfocar) y objetivos táctiles ≈ 44 px (`min-h-11`).

### Hallazgo transversal: el anillo de foco global

`globals.css:107-108` define `:focus-visible { outline: 3px solid var(--focus-ring) }` **fuera de
capa**. Las utilidades de Tailwind v4 viven en `@layer utilities`, y una regla sin capa gana a
cualquier regla en capa. Consecuencias:

1. Los `outline-none` de `TextInput`, `TextArea`, `shadcn/button` e `inputClass` **no ocultan** el
   foco (la regla global gana): el foco sí se ve, pero el `outline-none` es engañoso.
2. Ninguna utilidad `focus-visible:outline-*` puede cambiar el color del anillo en un elemento
   enfocado; solo funciona sobre otro elemento (por eso las pantallas usan
   `has-[:focus-visible]:outline-*` en la `label` de los chips con input `sr-only`).
3. El color `--focus-ring` = `color-mix(accent 48%, white)` ≈ `#f0baa1` da **1,72:1 sobre blanco**
   y **1,61:1 sobre `--background`**: no llega al 3:1 de un indicador de foco.

## Tokens nuevos propuestos (globals.css)

| Token | Valor | Uso | Contraste medido |
| --- | --- | --- | --- |
| `--accent-strong` | `#b8532a` | Fondo de CTA con texto blanco | blanco 4,87:1; sobre `--background` 4,56:1 |
| `--accent-strong-hover` | `#a24822` | Hover de esos CTA | blanco 6,02:1 |
| `--focus-ring` (cambio) | `var(--accent-hover)` (`#cc5f30`) | Anillo de foco | 3,91:1 sobre surface, 3,75:1 sobre background |

Más `--color-accent-strong` y `--color-accent-strong-hover` en `@theme inline`. Mantiene la
paleta (mismo tono naranja, más oscuro); `--accent` sigue para bordes, iconos y fondos suaves.

Referencia actual: blanco sobre `--accent` (`#e0703c`) = **3,20:1**; sobre `--accent-hover` =
4,00:1 (es lo que usan ya, de forma provisional, «Editar menú», la celda «hoy» de la tira, la
elaboración seleccionada en Crear menú y «Continuar» del aviso de onboarding).

## Cambios propuestos, uno por uno

### 1. `src/app/globals.css:39` · `--focus-ring`
- Problema: 1,72:1 sobre blanco (ver arriba).
- Cambio: `--focus-ring: var(--accent-hover);` (y `--ring` lo hereda en la línea 33).
- Consumidores: todo elemento enfocable de la app (regla global de la línea 107) y `ring-ring` de shadcn.
- Riesgo: bajo. Visualmente, anillo naranja más intenso. Comprobar que no tapa contenido en
  filas de compra (offset 3 px).

### 2. `src/app/globals.css:154` · `.t-micro` (11 px)
- Problema: 0,6875 rem = 11 px en mayúsculas para estado de artículo («Comprado»), «Resto de la
  semana», meta de despensa. Por debajo de 12 px.
- Cambio: `font-size: 0.75rem;` (12 px) y `letter-spacing: 0.12em`.
- Consumidores: `app/week/page.tsx` (h2 «Resto de la semana»), `ui/CheckboxItem.tsx:48`,
  `features/WeekDayCard.tsx`, `pages/PantryPage.tsx`.
- Riesgo: bajo; +1 px de alto en filas de compra (siguen siendo `min-h-16`). Coordinar con C2 por `WeekDayCard`.

### 3. `src/app/globals.css:147` · `.t-eyebrow` (0,72 rem ≈ 11,5 px)
- Cambio: `font-size: 0.75rem; letter-spacing: 0.16em;`.
- Consumidores: cabeceras de Semana, Perfil, Onboarding, Crear menú, Compra, Despensa,
  `layout/SectionHeader.tsx`, `layout/StickyPageHeader.tsx`.
- Riesgo: bajo; cabeceras sticky crecen < 1 px.

### 4. `src/app/globals.css:126-128` · `.ui-eyebrow` (0,7 rem = 11,2 px)
- Cambio: unificar con `.t-eyebrow` (`font-size: 0.75rem`) o eliminarla y migrar su único
  consumidor (`AuthPageShell.tsx:43`, que ya la sobreescribe con `text-[0.78rem]`) a `t-eyebrow`.
- Riesgo: muy bajo.

### 5. Token de acento para CTA con texto blanco
- Problema: blanco sobre `--accent` = 3,20:1 en todos los botones primarios (texto 14 px seminegrita, no cuenta como grande).
- Cambio: tokens `--accent-strong` / `--accent-strong-hover` (tabla anterior). Después, sustituir
  en las pantallas los `bg-[color:var(--color-accent-hover)]` provisionales por
  `bg-[color:var(--color-accent-strong)]` + `hover:bg-[color:var(--color-accent-strong-hover)]`
  (quitar `hover:brightness-95`): `app/week/page.tsx` («Editar menú», celda hoy),
  `pages/CreateMenuPage.tsx` (elaboración seleccionada), `session/OnboardingGate.tsx`.
- Riesgo: medio-bajo (cambio visible del naranja principal a uno más tostado). Validar en Preview.

### 6. `src/components/ui/Button.tsx:22` · variante `primary`
- Problema: `bg-accent text-white` 3,20:1.
- Cambio: `border-[color:var(--color-accent-strong)] bg-[color:var(--color-accent-strong)] text-white hover:border-[color:var(--color-accent-strong-hover)] hover:bg-[color:var(--color-accent-strong-hover)]` (sombra igual).
- Consumidores (16): login, signup, forgot/reset-password, auth/callback, profile, onboarding,
  ReplaceMenuDialog, GenerationProgress, WeekDayCard, ProposalActionBar, AiLoginNotice,
  ProposalDayCard, PantryPage, CreateMenuPage, SessionNotices.
- Riesgo: medio (el CTA más visible de la app). Validar contraste del estado `disabled:opacity-60`
  (exento por WCAG, pero que siga leyéndose).

### 7. `src/components/ui/Button.tsx:15` · tamaño `sm` (`min-h-10` = 40 px)
- Cambio: `sm: "min-h-11 px-4 text-sm"` (44 px). Si se quiere conservar un tamaño compacto, que
  sea solo de padding horizontal.
- Consumidores con `size="sm"`: ninguno tras esta rama (guardar sección y «Borrar datos
  corporales» de Perfil, «Reintentar» de Onboarding y de Crear menú, «Cancelar» de
  GenerationProgress y «Pedir idea a la IA» de ProposalDayCard se han pasado a `md`). El cambio evita que vuelva a aparecer un botón de 40 px.
- Riesgo: bajo.

### 8. `src/components/ui/IconButton.tsx:17` · `h-10 w-10`
- Cambio: `h-11 w-11`.
- Consumidores: `CreateMenuPage` («Limpiar texto», `absolute right-3 top-3`; el textarea tiene
  `pr-16` = 64 px, cabe) y `PantryPage` (borrar artículo, en fila).
- Riesgo: bajo; revisar alineación vertical en la fila de despensa a 320 px.

### 9. `src/components/ui/TextInput.tsx:10` y `TextArea.tsx:11`
- Problema TextInput: `text-sm` (14 px) en móvil → zoom de Safari iOS al enfocar (login,
  signup, reset, despensa, WeekDayCard). `outline-none` inefectivo (hallazgo transversal).
- Cambio TextInput: `text-base sm:text-[15px]` en lugar de `text-sm sm:text-[15px]`; quitar
  `outline-none` (el anillo global, ya con 3,9:1, pasa a ser el indicador) y dejar el borde de foco.
- Cambio TextArea: ya es `text-base`; quitar `outline-none` y `focus:border-transparent`
  (hoy el borde desaparece al enfocar y queda una sombra de 0,12 de opacidad).
  (`CreateMenuPage` le pasaba `text-sm` en «¿Qué te apetece…?», 14 px → zoom; ya se ha quitado en
  la pantalla en esta rama.)
- Riesgo: bajo-medio; los campos crecen 2 px de letra.

### 10. `src/components/ui/CategoryPill.tsx:25-47`
- Problemas: seleccionado `bg-accent text-white` 3,20:1; meta `text-[0.7rem]` (11,2 px) con
  `text-white/72` sobre acento = **2,36:1**.
- Cambio: seleccionado `bg-[color:var(--color-accent-strong)] border-[color:var(--color-accent-strong)]`;
  meta `text-xs` (12 px) y `text-white` (4,87:1 sobre accent-strong).
- Consumidores: `ShoppingListPage`, `PantryPage` (selector de categoría; ya en `role="group"`
  con `aria-pressed` y `aria-label` de progreso en esta rama).
- Riesgo: bajo.

### 11. `src/components/ui/StatusPill.tsx:15`
- Problema: `text-xs` (12 px) en móvil para el progreso «3/12 comprados».
- Cambio: `text-sm` en todos los tamaños (`px-3 py-1.5 text-sm sm:px-4 sm:py-2`).
- Consumidores: `ShoppingListPage`, `PantryPage`. Riesgo: bajo (a 320 px, comprobar que la
  cabecera no salta de línea; tiene `shrink-0`).

### 12. `src/components/shadcn/ui/button.tsx:8,24-31` y `badge.tsx:8`
- button: tamaños `default h-9`, `sm h-8`, `icon size-9`; `outline-none` (inefectivo). Su único
  consumidor es `ui/Button.tsx`, que sobreescribe tamaño con `min-h-*` vía `cn`/`tailwind-merge`,
  así que el `h-9` no limita (es `height` fija, pero `min-h-11` gana en altura efectiva).
  Cambio: dejar de pasar `size` por defecto (`size: null`) desde `ui/Button` o cambiar
  `default` a `h-auto`; quitar `outline-none`.
- badge: `text-xs`; **sin consumidores** en `src/`. Cambio: ninguno ahora; si se usa, `text-sm`.
- Riesgo: bajo (no hay `npx shadcn` implicado; es edición manual).

### 13. `src/components/layout/BottomNavigation.tsx:72` · etiquetas a `0.72rem` (11,5 px)
- Cambio: `text-xs` (12 px) mínimo, idealmente `text-[0.8125rem]` si el paso 32 reduce la
  navegación a 3 destinos (Semana, Compra, Perfil): con 3 columnas a 320 px cada celda tiene
  ≈ 96 px y caben 13 px sin cortar.
- Coordinación: **hacerlo en el mismo cambio que el paso 32** para no medir dos veces.
- Riesgo: medio (componente presente en todas las pantallas; `min-h-[4.25rem]` se mantiene).

### 14. `src/app/layout.tsx` · sin `viewport`, `viewport-fit` no es `cover`
- Problema: sin `viewport-fit=cover`, Safari iOS devuelve **0** en `env(safe-area-inset-*)`, así
  que todos los `pb-[calc(...+env(safe-area-inset-bottom))]` (pageShell, BottomNavigation,
  ProposalActionBar) no protegen nada en iPhone con barra de inicio en modo standalone/landscape.
- Cambio (API de Next 16, `node_modules/next/dist/docs`, objeto `viewport`):
  ```ts
  import type { Metadata, Viewport } from "next";
  export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: "#fff6ed",
  };
  ```
  Sin `maximumScale` ni `userScalable` (el zoom debe seguir permitido).
- Riesgo: medio. Con `cover`, el contenido llega a los bordes: revisar en iPhone físico que la
  navegación inferior y la cabecera sticky de Semana respetan las áreas seguras (paso 36).

### 15. `src/lib/ui.ts` · `buttonPrimaryClass` e `inputClass`
- Problemas: `buttonPrimaryClass` blanco sobre acento 3,20:1; `inputClass` `text-sm` (zoom iOS) y `outline-none`.
- Consumidores: **solo `src/components/DayCard.tsx`**, que no importa nadie (código muerto).
- Cambio recomendado: no tocar estilos; eliminar `DayCard.tsx` y, después, las constantes sin
  consumidores (`buttonPrimaryClass`, `inputClass`, `textareaClass`…) dentro del paso 34
  (consolidación), con build verde.
- Riesgo: muy bajo.

### 16. `src/components/session/AuthPageShell.tsx`
- `:100` `FieldLabel` a `text-[0.78rem]` (12,5 px) en todas las etiquetas de login/signup/reset/forgot.
  Cambio: `text-sm` (14 px), igual que el resto de etiquetas.
- `:43` eyebrow `ui-eyebrow text-[0.78rem]` → `t-eyebrow` (ver punto 4).
- `:64` aviso de modo invitado `text-xs` → `t-meta`.
- Consumidores: login, signup, forgot-password, reset-password, auth/callback.
- Riesgo: bajo.

## Pendientes de pantalla fuera de mi alcance (coordinar con C2)

- `src/app/week/page.tsx:519` insignia «Hoy» de la semana sin comidas: blanco sobre acento
  3,20:1 a 12 px. Está dentro de la zona de render de días que toca C2; se ha dejado. Cambio
  propuesto: `bg-[color:var(--color-accent-strong)]` (o `accent-hover` provisional).
- `src/components/features/WeekDayCard.tsx:247` (misma insignia «Hoy», 3,20:1) y `:302`
  (`t-meta text-xs`, 12 px). Fichero de C2.

## Orden sugerido de aplicación

1. Tokens + `--focus-ring` (puntos 1 y 5) — un commit, revisión visual en Preview.
2. `Button`, `CategoryPill`, `IconButton`, `StatusPill`, `TextInput`/`TextArea` (6-11).
3. Tipografía (2-4, 16) y `layout.tsx` (14) con prueba en iPhone físico.
4. `BottomNavigation` junto con el paso 32 (13); `ui.ts`/`DayCard` en el paso 34 (15).
