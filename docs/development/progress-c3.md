# C3 — Restricciones contra ingredientes estructurados (paso 18)

Rama local `audit/c3-restricciones` (desde `audit-opt` 6121e34). Sin migraciones ni cambios de BD.
Plan: `plan-ola6.md`, sección C3. Resumen para pasar a `PROGRESS.md` al integrar.

| Tema | Resultado |
| --- | --- |
| Defecto reproducido | El filtro anterior (expresiones regulares sobre el título en `validation.ts`) dejaba pasar «Espaguetis carbonara» y «Fabada asturiana» con «sin cerdo», ignoraba «otras alergias» al generar el menú (p. ej. «Pollo al sésamo» con «sésamo»), daba falsos positivos con «nuez moscada», «leche de coco» y «mantequilla de cacahuete», y no podía ver los ingredientes de una ficha («Pasta a la genovesa» con piñones). Tres tests de `tests/restriction-check.test.cjs` fallaban con el código anterior |
| Léxico | `src/lib/recipes/food-lexicon.ts`: grupos en español con plurales, variantes, frases, excepciones y negaciones «sin …» (ver `data-sync.md`, «Restricciones contra ingredientes (C3)»). `normalizeFood` vive aquí y `validation.ts` lo reexporta |
| Comprobación | `src/lib/recipes/restriction-check.ts`: `checkDish({title, card}, perfil)` → `conflict / possible_conflict / unverifiable / none_detected`, base `reviewed_card / inferred_card / title_only`, hallazgos por ingrediente, etiqueta UE-14 o título, y texto no interpretable. `blocksAutomaticProposal`, `mentionsDislikedFood` |
| Generación e ideas | `visibleFoodConflict` y `checkReplacement` delegan en el léxico. Bloqueo automático: conflicto seguro de dieta o alergia, o posible de alergia. «Otras alergias» → `restriction_conflict` (antes `disliked_food` en ideas y nada al generar). `catalogAlternative` acepta una búsqueda de fichas revisadas (`ReviewedCardLookup`); una estimada no decide |
| Ficha de plato | `DishCard`: sección «Compatibilidad con tu perfil» con base visible, una línea por restricción, notas de texto no interpretable y «No garantiza ausencia de alérgenos ni trazas». Nunca «apto». `dishCardFlow.ts`: `dishCardRestrictions` (cuenta: `status.current` de C1; invitado: perfil local; sin leer o malformado → «No hemos podido leer tus restricciones») y `dishCompatibilityView`. `week/page.tsx` solo pasa las restricciones. Solo clases Tailwind con tokens existentes (`danger-soft`, `warning-soft`), nada por debajo de `t-meta` |
| Tests | 313 → **334** (16 nuevos en `restriction-check`, 1 en `dish-substitution`, 4 en `recipe-cards`, casos añadidos en `menu-generation`). `food-context.test.cjs`: «Hummus con crudités» cambiado por otro plato, porque con «sésamo» en otras alergias ahora se bloquea (es la corrección) |
| Comprobaciones | lint, typecheck, test 334/334 (con `GITLEAKS_BIN`), build en una copia sin `.env*` con variables sintéticas |

## Decisiones

1. Cacahuete bajo «frutos secos»: posible (aviso), no conflicto seguro; en propuestas automáticas sí bloquea, porque un posible de alergia bloquea.
2. Propuestas automáticas: bloquea también un posible de alergia (harina sin calificar, «tostada», alioli, salsa de soja…), coherente con el prompt («recetas naturalmente compatibles»). Los posibles de dieta (p. ej. albóndigas con «sin cerdo») solo avisan.
3. «pasta» o «espaguetis» sin más: gluten, no huevo (la pasta seca española suele ser de sémola); «pasta al huevo» huevo seguro y «pasta fresca» huevo posible.
4. Texto libre con un nombre de grupo dentro de la frase («pescado azul», «proteína de leche») se lee como el grupo entero: conservador para alergias; para «no me gusta» puede quitar alguna idea de más.
5. Ingrediente opcional: como mucho posible conflicto.
6. Con sesión, si el contexto de la cuenta no se ha podido leer, la ficha no usa el perfil del dispositivo en su lugar: dice que no ha podido leer las restricciones.
7. Texto no interpretable no bloquea la generación (no se puede comprobar), pero la ficha nunca dice «sin conflictos» mientras exista.

## Pendiente

- Conectar `ReviewedCardLookup` cuando el catálogo tenga fichas revisadas (hoy ninguna; leer fichas por lotes es de `repositories.ts` / `supabase/recipes.ts`, de C4). Tampoco en `/api/substitute-dish`.
- Aviso al escribir un plato a mano en el editor (`WeekDayCard`, fuera de la zona de C3): hoy se ve al abrir la ficha.
- Prueba manual en navegador (sin `npm run dev` en esta sesión: `.env.local` apunta a producción) y revisión de textos por Sergio.
- Integración con C4: ambos añaden una sección a `docs/development/data-sync.md` antes de «Datos anteriores a B1»; conflicto trivial.
