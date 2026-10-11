# Paso 33 · Legibilidad, interacción táctil y accesibilidad (rama `audit/a11y`)

Fecha: 2026-10-11 · Base: `audit-opt` 02aa5b8 · Sin push ni merge.
Plan de componentes compartidos: `design-plans/2026-10-11-accesibilidad-paso-33.md`,
**aprobado por Sergio y aplicado el 2026-10-11** con los ajustes del revisor (ver segunda ola).

## Qué se ha hecho (solo pantallas y componentes de feature)

Criterios: lectura habitual ≥ 13–14 px, campos de formulario 16 px, objetivos táctiles de 44 px
(`min-h-11`), foco visible, nombres accesibles con contexto, avisos con `role`/`aria-live`
correctos y semántica real de grupos y pestañas. Solo clases de Tailwind y tokens existentes.

| Fichero | Cambios |
| --- | --- |
| `app/week/page.tsx` (solo cabecera y tira) | «Semana actual» y «Volver a hoy» a 14 px (flecha `aria-hidden`); «Editar menú» y la celda de hoy sobre `accent-hover` (blanco 4,0:1, antes 3,2:1); tira de días 14/12 px sin `opacity-75` (antes 13,1/9,9 px, ≈2,4:1); `gap-1` en móvil (celdas de 37 → 39 px a 320 px, 44 px de alto). |
| `features/ProposalDayCard.tsx` | «Hoy» 12 px con texto `foreground` (antes acento sobre acento suave, 2,87:1); «Comida/Cena» 12 px; alerta a 14 px; «Otra idea» 14 px y 44 px; «Cancelar» con 44 px y `aria-label` contextual; «Mantener este plato» 44 px; «Pedir idea a la IA» tamaño `md`; «Volver al plato anterior» con área táctil ampliada sin mover el texto. |
| `features/ProposalActionBar.tsx` | Región viva persistente (`role="status"`, `aria-atomic`) para que el mensaje se anuncie al aparecer; mensaje a 14 px. |
| `session/SyncStatus.tsx` | Estado a 14 px, iconos 16 px, «Reintentar» 44 px, detalle a `t-meta` (13 px). |
| `pages/CreateMenuPage.tsx` | Pestañas reales: `role="tab"` + `aria-selected` + `aria-controls`, paneles `role="tabpanel"` con `aria-labelledby`, tabindex itinerante y ←/→/Inicio/Fin (`src/lib/rovingTabs.ts`). Chips de tipo de menú 44 px/14 px con foco visible en la `label` (`has-[:focus-visible]:outline-*`). Elaboración 44 px, 13 px en móvil (cabe «Equilibrado» a 320 px) y seleccionada sobre `accent-hover`. «Descartar propuesta» 44 px/14 px. Campo «¿Qué te apetece…?» vuelve a 16 px. «Reintentar» tamaño `md`. |
| `pages/ShoppingListPage.tsx`, `pages/PantryPage.tsx` | Selector de categorías: `role="group"` (eran `tablist` con `aria-pressed`) y `aria-label` con progreso («Frutas: 2 de 5 comprados»). «En despensa» a 14 px en verde (5,75:1). |
| `features/ProfileFields.tsx` | Campos a 16 px (sin zoom en iOS), sin `outline-none`; chips 44 px/14 px y foco visible en la `label`; contadores a `t-meta`; placeholders a tamaño del campo. |
| `app/profile/page.tsx` | Insignias 12 px y «Sin guardar» con texto `foreground` (2,87:1 → 12,8:1); avisos y errores 14 px; botones −/+ 44 px con valor anunciado como «3 días»; «Mostrar datos corporales» 44 px; unidades 14 px; enlace de cuenta 14 px; botones `sm` → `md`. |
| `app/onboarding/page.tsx` | Error 14 px; chips de despensa exprés 44 px/14 px; aviso de conflicto de despensa en `danger` (antes acento, ≈3,2:1); «Reintentar» `md`. |
| `session/OnboardingGate.tsx` | «Continuar» 44 px, sobre `accent-hover` y con nombre «Continuar la configuración de beCook». |
| `features/GenerationProgress.tsx` | «Cancelar» tamaño `md` (44 px). |
| `app/login`, `signup`, `reset-password` | Enlace «¿La has olvidado?» a 14 px con área táctil de 44 px; pistas de contraseña a `t-meta`. |

Hallazgo transversal (detalle en el plan): la regla global `:focus-visible` está fuera de capa y
gana a las utilidades de Tailwind, por lo que los `outline-none` no ocultan el foco; el problema
real es su color (1,72:1). Los chips con input `sr-only` sí tenían el foco invisible y se han corregido.

## Segunda ola: plan aprobado aplicado

- Tokens: `--accent-strong` #b8532a (blanco 4,87:1) y `--accent-strong-hover` #a24822 (6,02:1);
  `--focus-ring` = `--accent-hover` (3,9:1); `--ring` de shadcn fijo en el tono pálido.
  `.t-micro` y `.t-eyebrow` a 12 px; `.ui-eyebrow` eliminada.
- Compartidos: `Button` primario sobre `accent-strong`, `sm` a 44 px, `h-auto whitespace-normal
  text-center`; `IconButton` 44 px; `TextInput` `text-base`; `TextArea` `md:text-base` y borde de
  foco; sin `outline-none` en ui/shadcn; `CategoryPill` seleccionado en `accent-strong` con meta
  12 px blanca; `StatusPill` 14 px; `BottomNavigation` etiquetas 12 px; `AuthPageShell` etiquetas
  14 px, `t-eyebrow` y `t-meta`.
- `layout.tsx` con `viewport` (`viewportFit: "cover"`, `themeColor`, sin bloquear zoom) y áreas
  seguras laterales en `pageShellClass`, `BottomNavigation` y `ProposalActionBar` (commit aparte).
- Pantallas: `accent-hover` provisional → `accent-strong`; CTA de onboarding sin cuenta / sin menú
  también. «Pedir idea a la IA» ya no desborda a 320 px (`whitespace-normal px-3 leading-tight`).
  En Crear menú, `aria-controls` solo en la pestaña activa (el panel inactivo no se renderiza).
- Test: `a11y-semantics.test.cjs` añade una prueba de regresión del plan (9 en total).

## Comprobaciones

- `npm run lint`, `npm run typecheck`: sin errores.
- `npm test`: 288/288 (incluye `tests/a11y-semantics.test.cjs`, 9 pruebas nuevas). Las 5 pruebas
  de `secrets.test.cjs` necesitan Gitleaks: en este worktree se ejecutan con
  `GITLEAKS_BIN=/Users/sergio/projects/becook/.tools/gitleaks` (el binario verificado del clon
  principal); sin él fallan por entorno, no por código.
- `npm run build`: verde, 22 rutas. Ejecutado con variables sintéticas
  (`NEXT_PUBLIC_SUPABASE_URL=https://build.example.invalid`, claves vacías) para no usar el
  `.env.local` de producción. Verificado en el CSS generado que existen
  `has-[:focus-visible]:outline-3/-solid/-offset-2/-[color:var(--color-accent)]` y `hover:brightness-95`.
- Layout razonado a 320 y 390 px: tira de días 7 × 39 px (320) / 7 × 47 px (390); elaboración
  3 × 72 px de contenido a 320 px con 13 px; chips con `flex-wrap`; botones −/+ de 44 px caben
  junto a la etiqueta (la fila hace `flex-wrap`).

## Pendiente

- Insignia «Hoy» de `week/page.tsx:519`, CTA «Crear menú» de semana vacía (`week/page.tsx:561`) e
  insignia «Hoy» de `WeekDayCard.tsx:247`: blanco sobre `--accent` (3,2:1), zona de C2. Cambio:
  `bg-[color:var(--color-accent-strong)]`.
- `src/components/DayCard.tsx` sin consumidores (con `buttonPrimaryClass`/`inputClass`): retirar en el paso 34.
- `px-3` de las pantallas no gana a `pageShellClass` (16 px reales): unificar en el paso 34.
- `BottomNavigation` a 3 destinos y quizá 13 px: paso 32.
- Recorrido manual a 320/390 px, teclado, VoiceOver y Safari en iPhone físico (áreas seguras con `viewport-fit=cover`).
