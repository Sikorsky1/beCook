# Plan de consolidación · paso 34 · componentes, cabeceras y avisos

Fecha: 2026-10-15 · Rama de trabajo: `audit/p34-componentes` (desde `audit-opt` 59a3309), ola 8 en
paralelo con P35 (E2E) y P37 (operación). Sin migraciones, sin BD y sin dependencias.
Estado: **aplicado en la rama, pendiente de validación por el revisor delegado** (Sergio delegó la aprobación; el revisor
valida este plan junto con el código).

`AGENTS.md` exige plan aprobado en `design-plans/` antes de tocar `globals.css`, `src/components/ui/*`,
`src/components/shadcn/ui/*`, `src/components/layout/*` y `src/lib/ui.ts`. Este plan cubre esos
cambios y, para tener el paso en un solo sitio, también los de pantallas.

## Situación actual (medida en el CSS generado de 59a3309)

- `pageShellClass` lleva `pt-5 sm:pt-8` y `pl/pr` con `max(1rem, env(safe-area-inset-*))`. Semana,
  Perfil, Onboarding, Compra y Despensa le concatenan `px-3 pb-[…] pt-3|pt-4 sm:px-6 sm:pt-6`. En el
  CSS generado `.pt-5` va después de `.pt-3`/`.pt-4`, `.sm\:pt-8` después de `.sm\:pt-6` y
  `.pl-[max(1rem…)]` después de `.px-3`: **ganan siempre los de `pageShellClass`** (20 px arriba,
  16 px laterales). Los añadidos no hacen nada.
- Las cabeceras fijas usan `-mx-3 px-3` (`sm:-mx-6 sm:px-6`): con 16 px de margen real dejan 4 px sin
  cubrir a cada lado (el contenido asoma por los bordes al desplazarse).
- Toda la cabecera es `sticky`, también el `h1`, las pestañas Compra/Despensa y el selector de
  categorías. Alturas fijas calculadas por clases (1 rem = 16 px, `t-h1` 24 px × 1,15, píldora de
  progreso 34 px, pestañas 54 px, selector de despensa 3 filas de 56 px):

| Pantalla | Fijo a 320×568 | Fijo a 390×844 |
| --- | --- | --- |
| Semana | 193 px (34 %) | 193 px (23 %) |
| Compra con lista | 261 px (46 %; la línea de semana ocupa 2 líneas) | 243 px (29 %) |
| Despensa | 351 px (62 %) | 351 px (42 %) |
| Perfil | 73 px | 73 px |

- `text-[#8a4e2a]` en 7 sitios (Semana ×2, `StateMessage`, `SyncStatus`, `GenerationProgress`,
  `ProfileReadinessNotice`, Crear menú) y en `DayCard.tsx` (muerto). `#e8d5b5` (= `--border`),
  `#6b7f4a` (= `--success`) y `#55633a` (= `--success-hover`) repetidos a mano en `StateMessage`,
  `SyncStatus`, `ui/Button` y `ui/CategoryPill`.
- Avisos: el de una acción anterior sigue visible tras otra distinta («2 básicos añadidos a tu
  despensa» tras borrar; «Papel de cocina añadido» con el formulario cerrado) y una respuesta lenta
  puede pisar el aviso de una acción posterior.
- Raciones: `generateShoppingList` (`src/lib/data/shopping.ts` ~834) guarda la lista con `storeList`
  sin `servings` en `extras`; la línea «N raciones por comida» solo aparece al recargar (la lectura
  ~702 sí las pasa). Igual en los respaldos de `reconcileShoppingList` que crean lista nueva.
- Código muerto: `src/components/DayCard.tsx` (único consumidor de `buttonPrimaryClass`,
  `inputClass`… de `ui.ts`), `src/data/mockImportedWeek.ts`, `src/data/mockRecipes.ts`,
  `src/components/layout/SectionHeader.tsx`, `src/components/ui/CheckboxItem.tsx` y
  `src/components/shadcn/ui/{badge,card,checkbox}.tsx`. `@radix-ui/react-checkbox` queda en
  `package.json` (el lockfile es de P35; se anota como pendiente).

## Decisiones

1. **Cabecera compactable solo con CSS** (decisión 9 de la ola). `StickyPageHeader` deja de ser un
   bloque fijo y pinta tres piezas hermanas dentro de la columna de la página:
   - **Barra** (`sticky top-0`): eyebrow (título de la sección) a la izquierda y `action` a la
     derecha (progreso, o ‹ › en Semana). Alto fijo `h-14` (56 px) + `env(safe-area-inset-top)`.
   - **Bloque desplazable** (no fijo): `h1` y `children` (pestañas, línea de semana, selector de
     categorías). `-mt-4 sm:-mt-5` anula el `gap` de la columna para que el `h1` quede pegado a la
     barra en reposo.
   - **Hueco fijo opcional** `pinned` (`sticky top-[calc(3.5rem+env(safe-area-inset-top))]`), justo
     debajo de la barra: accesos a secciones en Compra, tira de días en Semana. `py-1.5` + control de
     44 px + borde = 57 px.
   Sin JS de scroll ni medidas en el render. Al estar en el mismo contenedor que el contenido, cada
   pieza se fija respecto a la columna completa (no a un envoltorio).
2. **Qué queda fijo en cada pantalla** (por clases; + `env(safe-area-inset-top)`, 0 en navegador):

| Pantalla | Barra | Hueco fijo | Fijo antes → después (320×568 · 390×844) |
| --- | --- | --- | --- |
| Semana | «Plan semanal» + ‹ › | Tira de días | 193 → **113 px** · 193 → **113 px** |
| Compra con lista | «Lista de la compra» + «x/y comprados» | «Secciones de la lista» | 261 → **113 px** · 243 → **113 px** |
| Compra sin lista | ídem | — | → **57 px** |
| Despensa | «Despensa» + «x/y en casa» | — | 351 → **57 px** · 351 → **57 px** |
| Perfil | «Perfil» | — | 73 → **57 px** |

   Objetivo ≤ 120 px a 320×568 cumplido. En Semana, ‹ › pasan de la fila del `h1` a la barra (siguen
   a mano al desplazarse); «Semana actual/Volver a hoy» y «Editar menú» se desplazan con el `h1`.
   En Despensa, el selector de categorías se desplaza (no es navegación dentro de la página) y la
   cabecera interna de la tarjeta de categoría deja de ser `sticky top-0` (no tenía efecto: está
   dentro de una tarjeta `overflow-hidden`; la lista ya tiene su propio desplazamiento interno).
3. **Desplazamiento a secciones y días**: `scroll-mt-64` (Compra: `ShoppingSection` y «Ya lo tienes
   habitualmente») y `scroll-mt-[172px]` (Semana) pasan a
   `scroll-mt-[calc(7.5rem+env(safe-area-inset-top))]` (120 px: 113 fijos + 7 de aire). Semana deja
   de medir la cabecera con `offsetHeight`/`getBoundingClientRect` y usa `scrollIntoView` con ese
   `scroll-margin` (suave salvo `prefers-reduced-motion`). Se retira `headerRef`.
4. **Márgenes**: en `src/lib/ui.ts`
   - `pageShellClass` igual que hoy (lo usan Onboarding, Crear menú y las de cuenta).
   - `pageShellStickyClass`: el mismo shell sin `pt` (la barra pone su propio `env(safe-area-inset-top)`),
     para las 4 pantallas con cabecera fija; así la barra está arriba del todo también en reposo.
   - `pageBleedClass`: sangrado a sangre con `-ml/-mr-[max(1rem,env(safe-area-inset-*))]` y el mismo
     `pl/pr` (1,5 rem desde `sm`), para la barra, el hueco fijo y la barra inferior «Guardar perfil».
   - Se quitan los `px-3 pb-[…] pt-* sm:px-6 sm:pt-*` concatenados (no tenían efecto) y los `-mx-3 px-3`.
   - Se borran las exportaciones sin consumidores (`pageContainerClass`, `pageHero*`,
     `pageActionsClass`, `section*`, `panel*`, `button*Class`, `navButtonClass`, `inputClass`,
     `textareaClass`, `listCardClass`, `badgeClass`, `statusPillClass`, `cardClass`,
     `emptyStateClass`).
   Estilos calculados antes/después: laterales 16 px (24 px desde `sm`) **sin cambios**; inferior sin
   cambios (`pb-[calc(7.5rem+…)]`, la barra inferior no cambia de altura); superior de las 4
   pantallas con cabecera 20 px → 0 (lo pone la barra: 22 px de aire sobre el eyebrow, centrado en
   56 px); Onboarding y Crear menú sin cambios (20/32 px).
5. **Token `--warning-foreground: #8a4e2a`** en `:root` y `--color-warning-foreground` en
   `@theme inline` (decisión 8). Contraste: 5,47:1 sobre `--warning-soft`, 6,14:1 sobre
   `--background`, 6,41:1 sobre `--surface`. Los 7 `text-[#8a4e2a]` pasan a
   `text-[color:var(--color-warning-foreground)]`. Además, sustitución por el token de **igual valor**:
   `border-[#e8d5b5]` → `border-[color:var(--color-border)]` (`StateMessage`, `SyncStatus`,
   `ui/Button` danger) y en `ui/CategoryPill` `#6b7f4a` → `--color-success`, `#55633a` →
   `--color-success-hover`. Quedan dos hex sin token (hover de `ui/Button` secondary `#e7efd9` y
   danger `#fbe4d5`) y `themeColor` de `layout.tsx` (metadato, igual a `--background`): en lista
   blanca del test; no se crean tokens para ellos (fuera de alcance).
6. **Avisos de acción** (`src/lib/actionNotices.ts`, lógica pura): un solo aviso a la vez por página.
   `begin(origen)` borra el aviso anterior al empezar la acción y devuelve `show(texto)`, que solo
   pinta si esa acción sigue siendo la última (una respuesta lenta no pisa una acción posterior);
   `close(origen)` borra el aviso de ese origen y descarta su respuesta en vuelo; `clear()` para
   acciones sin aviso propio. Compra: marcar, cantidad, quitar, «Añadir a despensa», «Se me acabó» y
   el formulario manual (origen `form`, su aviso sigue junto al formulario; «Cerrar» lo borra). El
   aviso del formulario pasa a ser estado de la página (`ManualItemForm` recibe `message` y
   `onClose`). Despensa: el aviso de básicos se borra al borrar, «Deshacer», «Tengo / Se acabó» o
   añadir un artículo. Ambas regiones `role="status"` siguen siendo persistentes.
7. **Botones y tipografía, solo duplicados exactos**: no hay ninguno. El botón subrayado de
   Despensa («Deshacer»: acento, `underline-offset-4`, radio de control) y el de Crear menú
   («Descartar propuesta»: gris, `underline-offset-2`, `rounded-full`, `disabled`) difieren en color y
   forma, y una variante `link` en `ui/Button` tendría que anular la base (borde, sombra,
   desplazamiento al pasar el ratón): **no se añade variante** (`ui/Button` solo cambia el hex).
   Los `text-xs` restantes (número de la tira de días, insignia «Hoy», insignia de estado de Perfil,
   meta de `CategoryPill`) son 12 px seminegrita sin mayúsculas ni color gris fijo: `t-micro`
   (mayúsculas, tracking) y `t-meta` (13 px, peso 500, gris) no equivalen; se dejan.
8. **Redirecciones** `/pantry`, `/shopping-list`, `/import` se mantienen (decisión 3); solo se quita
   `legacyHref` de `ShoppingTabs` (las rutas antiguas redirigen antes de pintar las pestañas).
9. **Raciones**: `generateShoppingList` pasa `servings` (del contexto de la semana en la cuenta) en
   los dos `storeList`; los respaldos de `reconcileShoppingList` que crean lista nueva, también.
10. **Código muerto**: se borran los 8 ficheros citados y las exportaciones muertas de `ui.ts`.

## Ficheros

- Compartidos de alto riesgo (este plan): `src/app/globals.css` (token), `src/lib/ui.ts`,
  `src/components/layout/StickyPageHeader.tsx`, `src/components/layout/ShoppingTabs.tsx`,
  `src/components/ui/StateMessage.tsx`, `src/components/ui/Button.tsx` (hex),
  `src/components/ui/CategoryPill.tsx` (hex → tokens de igual valor; **añadido** respecto al plan de
  la ola). Borrados: `src/components/ui/CheckboxItem.tsx`, `src/components/layout/SectionHeader.tsx`,
  `src/components/shadcn/ui/{badge,card,checkbox}.tsx`.
- Pantallas y features: `src/app/week/page.tsx`, `src/app/profile/page.tsx` (P37 solo añade una línea
  de enlace), `src/app/onboarding/page.tsx`, `src/components/pages/{ShoppingListPage,PantryPage,CreateMenuPage}.tsx`,
  `src/components/session/SyncStatus.tsx`, `src/components/features/{GenerationProgress,ProfileReadinessNotice}.tsx`;
  **añadidos** respecto al plan de la ola: `src/components/features/ShoppingSection.tsx` (`scroll-mt`)
  y `src/components/features/ManualItemForm.tsx` (aviso controlado por la página). `AuthPageShell`
  no necesita cambios (ya usa solo `pageShellClass`, sin cabecera fija ni hex).
- Lógica: `src/lib/actionNotices.ts` (nuevo), `src/lib/data/shopping.ts` (raciones).
- Borrados de datos simulados: `src/components/DayCard.tsx`, `src/data/mockImportedWeek.ts`,
  `src/data/mockRecipes.ts`.
- Tests: `tests/ui-consolidation.test.cjs` (nuevo), caso de raciones en `tests/shopping-manual.test.cjs`,
  `tests/a11y-semantics.test.cjs` (añade `StickyPageHeader` y `ShoppingTabs` a los mínimos de 12/44 px).
- No se tocan: `BottomNavigation`, `ProposalActionBar` (ni su posición), `package.json`/lockfile,
  `checks.yml`, `supabase/*`, `src/lib/openai/*`, `src/lib/server/ai-usage.ts`, `PROGRESS.md`.

## Nombres accesibles congelados (contrato con P35)

P35 los usa con `getByRole`/`getByLabel`. No cambian en este paso y `tests/ui-consolidation.test.cjs`
falla si desaparecen del código. Cambiarlos después exige avisar a E2E.

| Pantalla | Rol | Nombre |
| --- | --- | --- |
| Todas | `navigation` | «Navegación principal», con enlaces «Semana», «Compra», «Perfil» |
| Semana | `heading` (h1) | título de la semana completo (`formatIsoWeekTitle`, p. ej. «12–18 octubre»; `aria-label` del h1) o «Preparando calendario» |
| Semana | `button` | «Semana anterior», «Semana siguiente», «Volver a hoy» |
| Semana | `link` | «Editar menú»; semana vacía: «Crear menú», «Ya tengo un menú» |
| Semana | `button` | semana vacía: «Repetir la semana N» |
| Semana | `group` | «Ir a un día de la semana» (botones «Lunes 12», «…, hoy», «…, sin menú») |
| Crear menú | `heading` (h1) | «Prepara tu menú semanal» |
| Crear menú | `link` | «Volver a Semana» |
| Crear menú | `button` | «¿Ya tienes un menú? Pégalo», «Crear menú semanal», «Procesar menú», «Usar este menú» |
| Compra | `heading` (h1) | «Tu compra» |
| Compra/Despensa | `navigation` | «Secciones de compra», con enlaces «Lista de la compra», «Despensa» |
| Compra | `navigation` | «Secciones de la lista» (enlaces «Frutería: 1 de 4 comprados») |
| Compra | `checkbox` | «Nombre, cantidad» (p. ej. «Tomate, 4 ud») |
| Compra | `button` | «Añadir un artículo», «Añadir a la lista», «Cerrar», «Añadir a despensa: X», «Quitar X de la lista», «Se me acabó: X. Pasarlo a la lista», «Cambiar la cantidad de X (…)» |
| Compra | campos | «Artículo», «Cantidad», «Unidad», «Sección» |
| Despensa | `heading` (h1) | «Tu despensa» |
| Despensa | `group` | «Categorías de despensa» (botones «básicos: 3 de 5 disponibles»), «¿Tienes X en casa?» |
| Despensa | `button` | «Añadir básicos que sueles tener», «Borrar X», «Deshacer», «Añadir» |
| Perfil | `heading` (h1) | «Lo que necesita tu menú» |
| Perfil | `button` | «Guardar perfil» |
| Onboarding | `heading` (h1) | «Bienvenido a beCook», «Para quién cocinas y qué necesitas», «¿Qué tienes ya en casa?» |
| Cuenta | campos/botones | «Email», «Contraseña», «Entrar», «Crear cuenta» |

Avisos: el resultado de las acciones de Compra y Despensa y el estado de guardado (`SyncStatus`)
son regiones `role="status"`.

## Accesibilidad y diseño

- 44 px en todo control (la barra fija mide 56 px; ‹ › siguen en 44 px); nada por debajo de 12 px;
  campos a 16 px (sin cambios). Solo clases de Tailwind y tokens de `@theme`.
- La cabecera fija ocupa ≤ 113 px: el elemento enfocado queda visible al tabular salvo que caiga en
  esos 113 px (antes, hasta 351 px). Orden de lectura igual que antes (eyebrow, progreso, h1,
  pestañas, accesos).
- Avisos: un solo aviso por página, sin anuncios rancios; las regiones vivas no se desmontan.

## Pruebas

- `tests/ui-consolidation.test.cjs`: sin hex fuera de `globals.css` (salvo la lista blanca) y token
  definido; ficheros muertos borrados y exportaciones de `ui.ts` con consumidor; ningún `px-3`,
  `pt-*`, `pb-*` concatenado a un shell ni `-mx-3`; las 4 pantallas usan `StickyPageHeader` y el
  `h1` no está en una pieza fija; altura fija por clases ≤ 120 px y `scroll-mt` acorde; `ShoppingTabs`
  sin `legacyHref`; avisos (`actionNotices`: una acción nueva borra el anterior, una respuesta
  lenta no pisa, cerrar borra el suyo, y las páginas no usan `setActionMessage`/`setBasicsMessage`
  sueltos); nombres congelados presentes.
- `tests/shopping-manual.test.cjs`: generar la lista de una semana con 4 raciones devuelve
  `view.servings = 4` sin recargar (falla con el código anterior).
- Regresión: `a11y-semantics`, `navigation`, `shopping-manual`, `pantry-actions` siguen pasando.

## Riesgos

- Medio: cambia la cabecera de 4 pantallas. Mitigación: sin JS, mismos nombres accesibles, alturas
  calculadas; revisar en la Preview a 320 y 390 px y en iPhone físico (paso 36, `safe-area-inset-top`
  en modo standalone).
- `-mt-4 sm:-mt-5` del bloque desplazable depende del `gap-4 sm:gap-5` de la columna (igual en las 4
  pantallas); si una pantalla cambia su `gap`, revisar.
- La barra muestra solo el eyebrow al desplazarse: el `h1` sale de la vista (decisión de la ola).

## Medición tras aplicar (2026-10-15)

`next build` de 59a3309 y de esta rama en copias sin `.env*` (variables sintéticas, Supabase
inaccesible), servidas con `next start` en 127.0.0.1 y abiertas en el navegador integrado como
invitado (semana y lista de 18 artículos sembradas en `localStorage`). Alto de las piezas `sticky`
pegadas arriba tras desplazarse:

| Pantalla | 320×568 antes → después | 390×844 antes → después |
| --- | --- | --- |
| Semana con menú | 193 → **113** (56 + 57) | 193 → **113** |
| Compra con lista | 242,8 → **113** (56 + 57) | 242,8 → **113** |
| Despensa | 350,6 → **57** | 350,6 → **57** |
| Perfil | 72,6 → **57** | — |

Compra del invitado no tiene raciones, por eso su línea de semana ocupa una sola línea (242,8 px;
con raciones, a 320 px, 261 px calculados). Padding de `main`: antes 20/16/16 px, después 0/16/16
(la barra pone el aire superior). Al pulsar un acceso de Compra, la sección queda a 120 px del borde
(bajo los 113 fijos); en Semana, el día elegido también a 120 px. Sin desplazamiento horizontal a
320 ni a 390 px. Ajuste tras medir: el eyebrow de la barra pasa a `line-clamp-2` (a 320 px
«Lista de la compra» junto a «0/18 comprados» se recortaba con `truncate`).
