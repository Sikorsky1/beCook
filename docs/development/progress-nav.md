# NAV · paso 32 — Navegación de 3 destinos y estados vacíos (ola 7)

Rama `audit/nav` desde `audit-opt` (c1b9c1a), en paralelo con C6 (paso 22) y D5 (pasos 30-31).
Sin migraciones ni cambios de BD. Resumen para integrar en `PROGRESS.md` al cerrar la ola.

| Elemento | Detalle |
|---|---|
| Plan | `design-plans/2026-10-12-navegacion-paso-32.md` (commit propio, antes del código). **Aprobado por el revisor delegado y aplicado** con sus 5 cambios (foco del aviso, textos de invitado, NAV a `main` solo con C6, «Copiando…» sin atenuar, reintento en pendiente) |
| Barra inferior | `BottomNavigation`: Semana, Compra, Perfil; `grid-cols-3`, `max-w-[22.5rem]`, etiquetas 13 px (`text-[0.8125rem]`), misma altura (`min-h-[4.25rem]`), mismas áreas seguras y `pb`; `aria-label="Navegación principal"`, iconos `aria-hidden`. «Crear menú» sale de la barra y su ruta marca Semana |
| Lógica pura | `src/lib/navigation.ts` (solo añadidos): `appSections`, `activeSection(pathname)` (por segmento, sin barra final, mayúsculas ni escapes), `sectionAriaCurrent` (`"page"` en el destino, `"true"` en subrutas) y `createMenuImportHref(week)` |
| Rutas | `/import` → `/create-menu?mode=import` (conserva `week=YYYY-Www` bien formado o el antiguo `?isoYear=&isoWeek=`; contrato con C6; **NAV solo llega a `main` junto con C6**). Ninguna ruta desaparece: `/`, `/pantry`, `/shopping-list`, `/create-menu` siguen igual |
| Semana vacía | `src/app/week/page.tsx` (invitados incluidos): «Crear menú» (principal, `accent-strong`), «Repetir la semana N» si la anterior tiene algún plato, «Ya tengo un menú» (`/create-menu?mode=import&week=…`). Textos propios para invitados (sin perfil ni Compra: «Para la lista de la compra, inicia sesión»). Todo 44 px, texto ≥ 14 px; «Copiando…» con `aria-busy`/`aria-disabled`, sin atenuar; el aviso del resultado recibe el foco (`tabIndex={-1}`, no es región viva, para no solaparse con `SyncStatus`). El estado vacío y la lectura de la semana anterior solo siguen a una lectura completada de la semana seleccionada |
| Repetir semana | `src/lib/repeatWeek.ts`: copia platos y fichas (`lunchRecipe`/`dinnerRecipe`) con `applyMenuToWeek`/`saveWeek` sin modificarlos; `generationRequestId: null` (contexto del perfil actual, como un menú importado); `prepareShopping` no hace nada (la compra se prepara al abrir Compra); nunca reemplaza un menú existente, tampoco si llega entre la lectura y la escritura (se avisa y se vuelve a leer). En pendiente la semana se relee y el reintento es el de `SyncStatus` (clave nueva; no duplica por la versión esperada); solo si no se envió nada «Repetir» reutiliza la clave |
| Tests | `tests/navigation.test.cjs` (19): destinos, sección activa por ruta, `aria-current`, `createMenuImportHref`, redirección real de `/import`, redirecciones antiguas, marcado de la barra, `pb` de `pageShellClass`, semana vacía (textos de invitado, foco, lectura de la semana seleccionada) y repetir semana (cuenta, invitado, semana ocupada, carrera lectura→escritura con conflicto, pendiente, duplicado confirmado, cuenta inaccesible). Regresión del paso 33 (`tests/a11y-semantics.test.cjs`) sin cambios y en verde |
| Comprobaciones | lint y typecheck OK; `npm test` 386/386 (con `GITLEAKS_BIN`); build verde en copia sin `.env*` con variables sintéticas (`/import` pasa a dinámica por `searchParams`) |

## Decisiones
- La lógica de repetir va en un módulo nuevo (`src/lib/repeatWeek.ts`) para poder probarla sin DOM;
  el componente del estado vacío vive dentro de `week/page.tsx` para que siga cubierto por la regresión del paso 33.
- `/onboarding` no marca ninguna sección (como antes).
- Si la cuenta no confirma la copia (pendiente), la semana se vuelve a leer y el reintento lo
  ofrece el estado de guardado de la página (no se duplica).
- Durante «Copiando…» el botón no se deshabilita (conserva el foco); la segunda pulsación se ignora con un ref.

## Pendientes
- NAV no debe llegar a `main` sin C6.
- Paso 34: el color fijo `text-[#8a4e2a]` de los avisos de Semana (y `SyncStatus`) debe pasar a token.
- C6: aceptar `?mode=import` en `CreateMenuPage` y añadir «Volver a Semana» (especificado en el plan).
- Prueba a 320/390 px en la Preview de `audit-opt` y VoiceOver en iPhone físico (paso 36).
- Integrar este resumen en `PROGRESS.md` al cerrar la ola 7.
