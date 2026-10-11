# Plan de navegación · paso 32 · navegación de 3 destinos y estados vacíos

Fecha: 2026-10-12 · Rama de trabajo: `audit/nav` (desde `audit-opt` c1b9c1a), ola 7 en paralelo con
C6 (paso 22, propietario de Crear menú) y D5 (pasos 30-31, propietario de Compra y Despensa).
Estado: **propuesto para validación del revisor** (Sergio delegó la aprobación en un revisor;
decisiones 7 y 9 del plan de la ola 7).

`AGENTS.md` exige plan aprobado en `design-plans/` antes de tocar `src/components/layout/*`. Este
plan cubre `BottomNavigation.tsx`; el resto del paso (estado vacío de Semana, `navigation.ts`,
`/import`) no es componente compartido de alto riesgo, pero se describe aquí para tener el paso
completo en un solo sitio.

## Situación actual

- `BottomNavigation` (montado en `src/app/layout.tsx`): `grid-cols-4`, `max-w-[25rem]`, 4 destinos
  (Semana, Crear menú —activo también en `/import`—, Compra —`/shopping*`, `/shopping-list`,
  `/pantry`—, Perfil —`/profile` y pantallas de cuenta—), etiquetas `text-xs` (12 px, paso 33),
  celdas `min-h-[4.25rem]`, áreas seguras laterales e inferior, `aria-current="page"` en cualquier
  ruta activa (exacta o subruta). La lógica de estado activo vive dentro del componente.
- `/import` redirige a `/create-menu` (pierde la intención de importar); `/pantry` y
  `/shopping-list` redirigen a `/shopping/pantry` y `/shopping/list`.
- Semana vacía (`src/app/week/page.tsx`): «No hay menú para esta semana» y un único enlace «Crear menú».

## Decisiones

1. **3 destinos: Semana, Compra, Perfil.** «Crear menú» sale de la barra: es una acción sobre una
   semana, no un destino (decisión 9). Su ruta `/create-menu` se queda y marca **Semana** como activa.
   Se llega desde Semana («Editar menú» en la cabecera, «Crear menú» en la semana vacía, aviso de
   contexto alimentario) y desde onboarding.
2. **Ninguna ruta desaparece.** `/create-menu`, `/import`, `/pantry`, `/shopping-list`, `/` siguen
   respondiendo. No se retiran redirecciones (paso 34).
3. **`/import` → `/create-menu?mode=import`** (conserva `week=YYYY-Www` si viene y es válido).
   `?mode=import` es el contrato con C6: Crear menú abre la importación cuando lo recibe.
4. **Lógica pura en `src/lib/navigation.ts`** (solo añadidos): `appSections`, `activeSection(pathname)`,
   `sectionAriaCurrent(section, pathname)` y `createMenuImportHref(week)`. El componente solo pinta.

## `BottomNavigation.tsx`: cambios uno por uno

| Elemento | Antes | Después |
| --- | --- | --- |
| Rejilla | `grid-cols-4`, `max-w-[25rem]` | `grid-cols-3`, `max-w-[22.5rem]` |
| Etiquetas | `text-xs` (12 px) | `text-[0.8125rem]` (13 px; punto 13 del plan del paso 33) |
| Altura de celda | `min-h-[4.25rem]` | **sin cambios** (68 px ≥ 44 px) |
| Contenedor `nav` | `pb-[calc(0.85rem+env(safe-area-inset-bottom))]`, `pl/pr` con `max(1rem,env(safe-area-inset-*))` | **sin cambios** (la altura total de la barra no cambia; `pageShellClass` mantiene su `pb`) |
| Nombre accesible | `aria-label="Navegación principal"` | sin cambios |
| Iconos | `aria-hidden="true"` | sin cambios; se retira `ChefHat` |
| Estado activo | dentro del componente | `activeSection(pathname)` de `navigation.ts` |
| `aria-current` | `"page"` en toda la sección | `"page"` en la ruta exacta del destino; `"true"` en sus subrutas |
| Colores | activo `surface-muted` + texto `foreground`; inactivo `muted-foreground` | sin cambios (tokens existentes) |

Medidas: a 320 px de ancho, con 16 px de margen lateral por lado, la píldora mide 288 px; con
`p-1.5` y `gap-1` cada celda queda en ≈ 89 px, sobrada para «Semana» a 13 px seminegrita (≈ 52 px).
A 390 px la píldora llega a su máximo de 360 px (≈ 113 px por celda). Las etiquetas no se cortan.

### Estado activo (por ruta)

| Sección | `href` | Rutas que la marcan |
| --- | --- | --- |
| Semana | `/week` | `/`, `/week*`, `/create-menu*`, `/import*` |
| Compra | `/shopping/list` | `/shopping*` (`/shopping/list`, `/shopping/pantry`), `/shopping-list`, `/pantry` |
| Perfil | `/profile` | `/profile*` y pantallas de cuenta (`isAuthPath`: login, signup, forgot/reset-password, auth) |

Coincidencia por segmento (`/week` marca `/week/x` pero no `/weekly`), ignorando la barra final,
mayúsculas y escapes. Rutas sin sección (p. ej. `/onboarding`): ningún destino activo, como hoy.
`aria-current="page"` solo cuando la ruta es exactamente el `href` del destino (p. ej. `/week`);
en las subrutas (`/create-menu`, `/shopping/pantry`, `/login`) `aria-current="true"`, para que el
lector anuncie «actual» sin afirmar que el enlace lleva a la página en la que se está.

## Crear menú contextual (especificación para C6)

C6 es propietario de `CreateMenuPage`; NAV no la toca. Contrato:

- `?mode=import` abre la importación («¿Ya tienes un menú? Pégalo») en lugar de generar.
  `?week=YYYY-Www` sigue fijando la semana. Sin `mode`, se genera (acción principal).
- Enlace «Volver a Semana» a `/week?week=…` de la semana objetivo (la barra ya marca Semana).
- La barra inferior no cambia de altura: `ProposalActionBar` sigue por encima.

## Semana vacía (`src/app/week/page.tsx`)

Se muestra cuando la semana ya se ha leído y no tiene menú (invitado incluido). Contenido:

1. Título «No hay menú para esta semana».
2. **«Crear menú»** — acción principal, enlace a `/create-menu?week=…`, `bg-[color:var(--color-accent-strong)]`
   con texto blanco (4,87:1), hover `accent-strong-hover`, `min-h-11`.
3. **«Repetir la semana N»** — solo si la semana anterior tiene al menos un plato planificado. Botón
   secundario (borde, fondo `surface`), `min-h-11`. Debajo, texto `t-meta`/`text-sm`:
   «Copia los platos y sus fichas del D–D mes. Se guarda con tu perfil actual (raciones y
   restricciones de hoy). La lista de la compra se prepara cuando abras Compra.»
   - Usa `applyMenuToWeek` y `saveWeek` **sin modificarlos** (`applyWeek.ts` solo se importa):
     copia título y ficha (`lunchRecipe`/`dinnerRecipe`) de cada día; `generationRequestId: null`,
     de modo que el contexto alimentario se congela con el perfil actual, como un menú importado;
     `prepareShopping` no hace nada (la compra se prepara al abrir Compra).
   - Si al guardar la semana ya tiene menú (otro dispositivo), no se reemplaza: se avisa y se
     vuelve a leer la semana. Si la cuenta no confirma, se avisa con el mensaje de `applyWeek`
     y «Reintentar» reutiliza la misma clave (sin duplicar).
   - Mientras guarda: botón deshabilitado con «Copiando…»; resultado en una región `role="status"`.
4. **«Ya tengo un menú»** — enlace secundario a `/create-menu?mode=import&week=…`, `min-h-11`.

Textos sin jerga; nada por debajo de 12 px; objetivos táctiles de 44 px; foco con el anillo global.

## Accesibilidad

- `nav` con `aria-label="Navegación principal"`; enlaces reales (`Link`), iconos `aria-hidden`.
- `aria-current` como se describe arriba. Contraste de colores sin cambios.
- Semana vacía: botones y enlaces con texto propio; el resultado de «Repetir» se anuncia con
  `role="status"`; el botón en curso tiene `aria-busy` y texto visible.

## Pruebas

- `tests/navigation.test.cjs`: sección activa por ruta (incluidas `/`, `/create-menu`, `/import`,
  `/pantry`, `/shopping-list`, cuenta, barra final, rutas sin sección), `aria-current`
  (`page`/`true`/ninguno), `createMenuImportHref` y redirección de `/import`, que la barra tenga 3
  destinos, 13 px y la misma altura, y el estado vacío de Semana (enlaces, 44 px, copia de platos y
  fichas sin preparar la compra).
- Regresión del paso 33: `tests/a11y-semantics.test.cjs` sigue pasando sin cambios.

## Riesgos

- Medio: componente presente en todas las pantallas. Mitigación: misma altura y áreas seguras;
  revisar a 320 y 390 px en la Preview de `audit-opt`, y VoiceOver en iPhone físico (paso 36).
- «Crear menú» deja de estar a un toque desde cualquier pantalla; se compensa con las entradas de
  Semana. Validar con usuarios.
