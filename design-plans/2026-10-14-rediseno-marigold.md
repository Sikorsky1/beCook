# Rediseño Marigold (rama `marigold`)

Petición de Sergio (2026-10-14): rediseñar por completo beCook con el sistema Marigold de
better-design (https://better-design.com/design-systems/marigold) y las herramientas del repo
github.com/marvkr/better-design, con ajustes de UX a criterio. Solo rama `marigold` y su Preview
(becook-preview). Nada a `main` ni a producción.

Este plan es el que exige AGENTS.md para tocar `globals.css`, `src/components/ui/*`,
`src/components/shadcn/ui/*` y la navegación/layouts. Nada se aplica sin el OK de Sergio.

## Fuente del sistema

- Tokens: `https://www.better-design.com/registry/marigold/globals.json` (registro shadcn público).
- Skill `better-design` (de `marvkr/better-design/skills/better-design`) copiada a
  `.claude/skills/better-design/`. Su MCP necesita API key de better-design.com; sin ella el
  rediseño se hace con el registro público y las guías locales (web-design-guidelines).
- No se ejecuta `npx shadcn add` ni `apply`: los valores se trasladan a mano a los tokens
  existentes para no reescribir `globals.css` entero ni romper los nombres que usan las pantallas.

## 1. Tokens (`src/app/globals.css`)

Se conservan los nombres actuales (`--background`, `--surface`, `--accent-strong`…) y cambian
sus valores, así todas las pantallas heredan el sistema sin tocar su lógica.

| Token | Hoy | Marigold |
| --- | --- | --- |
| Fondo | crema `#fff6ed` | blanco roto cálido `oklch(0.985 0.004 70)` |
| Tarjeta | `#fffcf8` | blanco puro |
| Texto secundario | `#68665c` | `oklch(0.52 0.013 60)` (Marigold 0.55, oscurecido para AA en superficies grises) |
| Borde | arena `#e8d5b5` | gris cálido `oklch(0.915 0.006 70)` |
| Naranja marca | `#e0703c` | `oklch(0.7 0.17 52)` |
| Fondo de CTA | `#b8532a` liso | degradado Marigold oscurecido `0.6→0.55` (texto blanco ≥ 4,6:1) |
| Éxito / comprado | oliva `#6b7f4a` | verde Marigold `oklch(0.6 0.14 152)` |
| Avisos | arena | oro Marigold `oklch(0.8 0.13 78)` |
| Error | marrón | rojo `oklch(0.52 0.19 27)` |
| Radios | 24 / 16 / 14 px | 16 / 12 / 10 px |
| Sombras | difusas grandes | filo 1 px + ambiente suave (`shadow-xs/raise/card/pop/primary`) |
| Tipografía | Geist | Inter (next/font), tracking −0,006em |
| Movimiento | 200 ms ease-out | 150/200/280 ms, curva Marigold |

Contraste: se mantiene AA (texto ≥ 4,5:1). El naranja vivo de Marigold con texto blanco da
2,8:1, por eso el CTA usa el degradado oscurecido y el naranja vivo queda para iconos y acentos.

Se registran en `@theme` las sombras como utilidades (`shadow-card`, `shadow-pop`…) y se
sustituyen las ~30 sombras `rgba(...)` sueltas de las pantallas por esas utilidades.

## 2. Componentes compartidos

- `Button`: primario con degradado + sombra `primary` y filo interior; secundario en gris cálido
  relleno; `soft` blanco con borde y `shadow-xs`; sin el salto `-translate-y` (Marigold no levanta,
  solo intensifica la sombra); radio 12 px.
- `Card`: blanco, borde 1 px, `shadow-card`, radio 16 px.
- `TextInput`/`TextArea`: blanco, `shadow-inset`, foco con borde naranja + halo 4 px; inválido
  en rojo (`aria-invalid`).
- `CategoryPill`, `StatusPill`, `StateMessage`, `IconButton`: mismos radios y sombras; seleccionado
  en naranja relleno, completado en verde suave.
- `BottomNavigation`: barra blanca flotante `shadow-pop`; activo con píldora naranja suave e
  icono naranja; etiquetas siempre visibles.
- `StickyPageHeader`: barra translúcida blanca, título de sección en texto normal (no versalitas
  espaciadas), acciones a la derecha.
- `ShoppingTabs`: control segmentado gris con pestaña activa blanca elevada (patrón Marigold).

## 3. Pantallas

Semana, Crear menú, Compra (lista y despensa), Perfil, Onboarding, Login/Registro/Recuperar,
Importar, Sobre y legales: solo clases Tailwind, sin cambiar lógica ni textos salvo los ajustes
de UX de abajo.

## 4. Ajustes de UX propuestos (a criterio)

1. Semana vacía: tarjeta con icono, una línea de explicación y CTA principal «Crear menú»
   destacado; «Ya tengo un menú» como secundario.
2. Tira de días: el día actual con punto naranja y el seleccionado relleno, para distinguirlos.
3. Navegación inferior: activo más evidente (color + fondo) para orientarse con un vistazo.
4. Lista de la compra: artículos comprados en verde y atenuados, contador de progreso visible.
5. Formularios: errores en el propio campo (borde rojo) además del mensaje.

## 5. Verificación

`npm run lint`, `typecheck`, `test`, `build`; repaso visual en 375 px y escritorio con la BD
local; despliegue Preview de `marigold` contra becook-preview y comprobación de que el bundle
apunta a `qdhpdhnpcsfhmygjofqb`.
