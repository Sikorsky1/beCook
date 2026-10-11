# Plan de navegación · paso 32 · navegación de 3 destinos y estados vacíos

Fecha: 2026-10-12 · Rama de trabajo: `audit/nav` (desde `audit-opt` c1b9c1a), ola 7 en paralelo con
C6 (paso 22, propietario de Crear menú) y D5 (pasos 30-31, propietario de Compra y Despensa).
Estado: **aprobado por el revisor delegado y aplicado (2026-10-12)**, con los cambios del revisor
que se recogen en «Revisión y aplicación» al final (Sergio delegó la aprobación en un revisor;
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
3. **`/import` → `/create-menu?mode=import`** (conserva `week=YYYY-Www` si viene y está bien formado,
   o el antiguo `?isoYear=&isoWeek=`). `?mode=import` es el contrato con C6: Crear menú abre la
   importación cuando lo recibe. **NAV solo llega a `main` junto con C6**: sin C6, «Ya tengo un
   menú» y `/import` abrirían Crear menú en modo generar.
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
   secundario (borde, fondo `surface`), `min-h-11`. Debajo, texto `text-sm` (enlazado con
   `aria-describedby`):
   - Con cuenta: «Copia los platos y sus fichas de esa semana (D–D mes). Se guarda con tu perfil
     actual (raciones y restricciones de hoy). La lista de la compra se prepara cuando abras Compra.»
   - Invitado: «Copia los platos y sus fichas de esa semana (D–D mes). Se copia en este
     dispositivo. Para la lista de la compra, inicia sesión.»
   - Usa `applyMenuToWeek` y `saveWeek` **sin modificarlos** (`applyWeek.ts` solo se importa):
     copia título y ficha (`lunchRecipe`/`dinnerRecipe`) de cada día; `generationRequestId: null`,
     de modo que el contexto alimentario se congela con el perfil actual, como un menú importado;
     `prepareShopping` no hace nada (la compra se prepara al abrir Compra).
   - Si al guardar la semana ya tiene menú (otro dispositivo, también si llega entre la lectura y
     la escritura), no se reemplaza: se avisa y se vuelve a leer la semana.
   - Si la cuenta no confirma (pendiente), la copia queda en este dispositivo, la semana se vuelve
     a leer y la muestra pendiente; el reintento es el «Reintentar» del estado de guardado
     (`SyncStatus`), que reenvía con la escritura habitual (clave nueva) y no duplica porque se
     comprueba contra la versión esperada. Solo si no se ha enviado nada (cuenta inaccesible al
     leer) «Repetir» de nuevo reutiliza la misma clave.
   - Mientras guarda: «Copiando…» con `aria-busy` y `aria-disabled`, sin `disabled` ni atenuado
     (conserva el foco; una segunda pulsación se ignora).
   - Resultado: aviso encima de la semana que recibe el foco (`tabIndex={-1}`), sin `role="status"`,
     para no anunciarse a la vez que `SyncStatus`.
   - El estado vacío y la lectura de la semana anterior solo siguen a una lectura completada de la
     semana seleccionada (misma identidad y semana); mientras tanto se muestra «Cargando esta semana...».
4. **«Ya tengo un menú»** — enlace secundario a `/create-menu?mode=import&week=…`, `min-h-11`.

Textos sin jerga; nada por debajo de 12 px; objetivos táctiles de 44 px; foco con el anillo global.

## Accesibilidad

- `nav` con `aria-label="Navegación principal"`; enlaces reales (`Link`), iconos `aria-hidden`.
- `aria-current` como se describe arriba. Contraste de colores sin cambios.
- Semana vacía: botones y enlaces con texto propio; el resultado de «Repetir» recibe el foco (no es
  región viva); el botón en curso tiene `aria-busy`, `aria-disabled` y texto visible.

## Pruebas

- `tests/navigation.test.cjs`: sección activa por ruta (incluidas `/`, `/create-menu`, `/import`,
  `/pantry`, `/shopping-list`, cuenta, barra final, rutas sin sección), `aria-current`
  (`page`/`true`/ninguno), `createMenuImportHref` y redirección de `/import`, que la barra tenga 3
  destinos, 13 px y la misma altura, y el estado vacío de Semana (enlaces, 44 px, textos de
  invitado, foco, copia de platos y fichas sin preparar la compra, carrera lectura→escritura con
  conflicto, pendiente y duplicado confirmado).
- Regresión del paso 33: `tests/a11y-semantics.test.cjs` sigue pasando sin cambios.

## Riesgos

- Medio: componente presente en todas las pantallas. Mitigación: misma altura y áreas seguras;
  revisar a 320 y 390 px en la Preview de `audit-opt`, y VoiceOver en iPhone físico (paso 36).
- «Crear menú» deja de estar a un toque desde cualquier pantalla; se compensa con las entradas de
  Semana. Validar con usuarios.

## Revisión y aplicación (2026-10-12)

Aprobado por el revisor delegado con estos cambios, ya incorporados arriba y aplicados en `audit/nav`:

1. Foco tras «Repetir»: el aviso recibe el foco (`tabIndex={-1}`) y no es región viva, para no
   anunciarse a la vez que `SyncStatus`.
2. Textos de invitado: no se le dice que se guarda con el perfil actual ni que la compra se prepara
   al abrir Compra («Se copia en este dispositivo. Para la lista de la compra, inicia sesión»).
3. NAV solo llega a `main` junto con C6 (`?mode=import`).
4. «Copiando…» sin `disabled:opacity-60`: `aria-busy`, `aria-disabled` y texto, sin atenuar.
5. Corregida la descripción del reintento en pendiente (lo hace `SyncStatus` con clave nueva; no
   duplica por la versión esperada).

Además: la lectura de la semana anterior exige que la semana cargada sea la seleccionada (evita una
lectura sobrante al cambiar de semana), y `/import` entiende también `?isoYear=&isoWeek=`.

Para el paso 34: los avisos de Semana usan el color fijo `text-[#8a4e2a]` sobre `--warning-soft`
(también `weekNotice` y `SyncStatus`); convertirlo en token al consolidar.
