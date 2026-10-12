# Paso 34 · consolidación de componentes y cabeceras (P34, ola 8)

Rama `audit/p34-componentes` desde `audit-opt` (59a3309). Sin migraciones, sin BD, sin
dependencias y sin cambios en `package.json`/lockfile, `checks.yml`, `src/lib/openai/*` ni
`src/lib/server/ai-usage.ts`. Plan: `design-plans/2026-10-15-consolidacion-paso-34.md` (commit propio
antes del código; lo valida el revisor delegado junto con el código). Resumen para pasar a
`PROGRESS.md` al integrar la ola.

| Elemento | Detalle |
| --- | --- |
| Cabecera compactable (solo CSS) | `StickyPageHeader` pinta barra fija (56 px + área segura superior: eyebrow y progreso, o ‹ › en Semana), bloque desplazable (`h1`, pestañas, línea de semana, categorías) y hueco fijo opcional (57 px: accesos a secciones en Compra, tira de días en Semana). Semana, Perfil, Compra y Despensa la usan. Fijo medido a 320×568: Semana 193 → 113 px, Compra 243 → 113, Despensa 351 → 57, Perfil 73 → 57 (igual a 390×844). Sin JS de scroll |
| Desplazamiento | `scroll-mt` de Compra (`scroll-mt-64`) y Semana (`172px`) a `calc(7.5rem+env(safe-area-inset-top))`; Semana usa `scrollIntoView` (sin animación con `prefers-reduced-motion`) y deja de medir la cabecera (`headerRef`, `offsetHeight`) |
| Márgenes | `pageShellStickyClass` (shell sin `pt`) y `pageBleedClass` (sangrado con `max(1rem, env(safe-area-inset-*))`) en `ui.ts`. Fuera los `px-3 pb pt sm:px-6 sm:pt-*` concatenados (el CSS generado demostró que no tenían efecto) y los `-mx-3 px-3` que dejaban 4 px sin cubrir. Laterales e inferior sin cambios (16/24 px; barra inferior y `ProposalActionBar` intactas) |
| Token | `--warning-foreground: #8a4e2a` (5,47:1 sobre `--warning-soft`) y `--color-warning-foreground`; los 7 `text-[#8a4e2a]` lo usan. `#e8d5b5`, `#6b7f4a`, `#55633a` → tokens de igual valor (`StateMessage`, `SyncStatus`, `ui/Button`, `ui/CategoryPill`). Quedan en lista blanca: 2 hover de `ui/Button` sin token y `themeColor` |
| Avisos | `src/lib/actionNotices.ts`: un aviso por página; una acción nueva borra el anterior al empezar, una respuesta lenta no pisa una acción posterior, cerrar el formulario manual borra el suyo (y descarta su respuesta en vuelo). Compra (marcar, cantidad, quitar, «Añadir a despensa», «Se me acabó», formulario) y Despensa (básicos; borrar, «Deshacer», «Tengo / Se acabó» y añadir lo borran). `ManualItemForm` recibe `message` y `onClose` |
| Raciones | `generateShoppingList` y los respaldos de `reconcileShoppingList` que crean lista nueva pasan `servings` a `storeList`: «N raciones por comida» aparece sin recargar |
| Código muerto | Borrados `DayCard.tsx`, `mockImportedWeek.ts`, `mockRecipes.ts`, `layout/SectionHeader.tsx`, `ui/CheckboxItem.tsx`, `shadcn/ui/{badge,card,checkbox}.tsx` y 20 exportaciones sin uso de `ui.ts`. `ShoppingTabs` sin `legacyHref` (las redirecciones `/pantry`, `/shopping-list`, `/import` siguen) |
| Despensa | La cabecera de la tarjeta de categoría deja de ser `sticky top-0` (no tenía efecto dentro de una tarjeta `overflow-hidden`) |
| Nombres congelados | Tabla en el plan (contrato con P35); `tests/ui-consolidation.test.cjs` falla si desaparecen |
| Tests | 440 → **451**: `tests/ui-consolidation.test.cjs` (10; 8 fallan con el código anterior), caso de raciones en `tests/shopping-manual.test.cjs` (fallaba: `servings` null); `a11y-semantics` añade `StickyPageHeader` y `ShoppingTabs` a los mínimos de 12/44 px |
| Comprobaciones | lint sin avisos; typecheck OK; `npm test` 451/451 (con `GITLEAKS_BIN`); `next build` OK en copia sin `.env*` con variables sintéticas. Medición en navegador con `next start` de copias de antes y después (invitado, datos sembrados en `localStorage`) a 320×568 y 390×844 |

## Decisiones propias

1. Tres piezas hermanas en la columna (una pieza `sticky` solo se fija dentro de su padre); el hueco
   fijo usa `top` = alto de la barra (56 px fijos con `h-14`). El bloque desplazable anula el `gap`
   de la columna (`-mt-4 sm:-mt-5`).
2. En Semana, ‹ › pasan a la barra (quedan a mano al desplazarse); «Semana actual/Volver a hoy» y
   «Editar menú» se desplazan con el título. En Despensa no hay hueco fijo: el selector de
   categorías no es navegación dentro de la página.
3. Shell sin `pt` para las pantallas con cabecera: la barra queda arriba también en reposo.
4. No hay variante `link` en `ui/Button`: los dos botones subrayados (Despensa y Crear menú) no son
   duplicados exactos y la variante tendría que anular la base. Los `text-xs` restantes no
   equivalen a `t-micro`/`t-meta`; se dejan.
5. Accesos de Compra con `-m-1.5 p-1.5` dentro del contenedor desplazable para no recortar el anillo
   de foco de 6 px.
6. El eyebrow de la barra admite dos líneas (`line-clamp-2`) en vez de recortarse a 320 px.

## Pendiente

- Revisión del revisor delegado (plan + código) y validación visual en la Preview y en iPhone
  físico (`safe-area-inset-top` en modo standalone; paso 36).
- `@radix-ui/react-checkbox` sigue en `package.json` sin consumidores (el lockfile es de P35).
- Hover de `ui/Button` secondary/danger sin token (`#e7efd9`, `#fbe4d5`).
- Integración: P37 añade una línea en `src/app/profile/page.tsx` (la cabecera de esa página cambia
  aquí; conflicto, si lo hay, trivial). E2E (P35) debe usar los nombres congelados del plan; el `h1`
  ya no está fijo y la barra de Semana lleva ‹ ›.
