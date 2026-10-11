# NAV · paso 32 — Navegación de 3 destinos y estados vacíos (ola 7)

Rama `audit/nav` desde `audit-opt` (c1b9c1a), en paralelo con C6 (paso 22) y D5 (pasos 30-31).
Sin migraciones ni cambios de BD. Resumen para integrar en `PROGRESS.md` al cerrar la ola.

| Elemento | Detalle |
|---|---|
| Plan | `design-plans/2026-10-12-navegacion-paso-32.md` (commit propio, antes del código). Pendiente de la validación del revisor delegado por Sergio |
| Barra inferior | `BottomNavigation`: Semana, Compra, Perfil; `grid-cols-3`, `max-w-[22.5rem]`, etiquetas 13 px (`text-[0.8125rem]`), misma altura (`min-h-[4.25rem]`), mismas áreas seguras y `pb`; `aria-label="Navegación principal"`, iconos `aria-hidden`. «Crear menú» sale de la barra y su ruta marca Semana |
| Lógica pura | `src/lib/navigation.ts` (solo añadidos): `appSections`, `activeSection(pathname)` (por segmento, sin barra final, mayúsculas ni escapes), `sectionAriaCurrent` (`"page"` en el destino, `"true"` en subrutas) y `createMenuImportHref(week)` |
| Rutas | `/import` → `/create-menu?mode=import` (conserva `week=YYYY-Www` válido; contrato con C6). Ninguna ruta desaparece: `/`, `/pantry`, `/shopping-list`, `/create-menu` siguen igual |
| Semana vacía | `src/app/week/page.tsx` (invitados incluidos): «Crear menú» (principal, `accent-strong`), «Repetir la semana N» si la anterior tiene algún plato, «Ya tengo un menú» (`/create-menu?mode=import&week=…`). Todo 44 px, texto ≥ 14 px; resultado en `role="status"` |
| Repetir semana | `src/lib/repeatWeek.ts`: copia platos y fichas (`lunchRecipe`/`dinnerRecipe`) con `applyMenuToWeek`/`saveWeek` sin modificarlos; `generationRequestId: null` (contexto del perfil actual, como un menú importado); `prepareShopping` no hace nada (la compra se prepara al abrir Compra); nunca reemplaza un menú existente (se avisa y se vuelve a leer); un reintento reutiliza la misma clave |
| Tests | `tests/navigation.test.cjs` (16): destinos, sección activa por ruta, `aria-current`, `createMenuImportHref`, redirección real de `/import`, redirecciones antiguas, marcado de la barra, `pb` de `pageShellClass`, semana vacía y repetir semana (cuenta, invitado, semana ocupada, cuenta inaccesible). Regresión del paso 33 (`tests/a11y-semantics.test.cjs`) sin cambios y en verde |
| Comprobaciones | lint y typecheck OK; `npm test` 383/383 (con `GITLEAKS_BIN`); build verde en copia sin `.env*` con variables sintéticas (`/import` pasa a dinámica por `searchParams`) |

## Decisiones
- La lógica de repetir va en un módulo nuevo (`src/lib/repeatWeek.ts`) para poder probarla sin DOM;
  el componente del estado vacío vive dentro de `week/page.tsx` para que siga cubierto por la regresión del paso 33.
- `/onboarding` no marca ninguna sección (como antes).
- Si la cuenta no confirma la copia (pendiente), la semana se vuelve a leer y el reintento lo
  ofrece el estado de guardado de la página (no se duplica).

## Pendientes
- C6: aceptar `?mode=import` en `CreateMenuPage` y añadir «Volver a Semana» (especificado en el plan).
- Validación del revisor del plan; prueba a 320/390 px en la Preview de `audit-opt` y VoiceOver en iPhone físico (paso 36).
- Integrar este resumen en `PROGRESS.md` al cerrar la ola 7.
