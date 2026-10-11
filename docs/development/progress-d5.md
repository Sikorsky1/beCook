# Iteración D5 — Compra completa y despensa con acciones claras (pasos 30 y 31)

Rama local `audit/d5-compra` desde `audit-opt` (c1b9c1a), ola 7, en paralelo con C6 y NAV. Única
iteración de la ola con migración. Sin push ni merge. Este resumen sustituye a la entrada de
`PROGRESS.md` hasta la integración.

| Elemento | Detalle |
|---|---|
| Defectos reproducidos | Antes de tocar código, `tests/shopping-manual.test.cjs` y `tests/pantry-actions.test.cjs` (23 pruebas) fallaban todas: **no existían artículos manuales** ni edición de cantidad; **reconciliar borraba un manual** (`diffShoppingList` devolvía `remove` para filas `manual|…`, compradas o no); **la despensa no tenía «Tengo / Se acabó»** (casilla con otro significado que en Compra), ni básicos en bloque, ni deshacer; **`fromCards` contaba cualquier origen ≠ `ai_title`** como ficha (`data/shopping.ts:183`). En la base local, con el trigger desactivado en una transacción revertida, `shopping_items_discard_unbought` (la ruta del cliente desplegado) borraba la fila manual (1 descartada, 0 quedan); con el trigger, 0 descartadas, 1 queda |
| Migración `20261014090000_shopping_manual_items` | ✅ local (`db:migrate` incremental sobre los fixtures). `BEGIN`/`COMMIT`, `lock_timeout` 5 s, `statement_timeout` 120 s. Aditiva: función + trigger `shopping_items_guard_manual` (BEFORE UPDATE OR DELETE) y función `edit_shopping_items` (INVOKER, solo `authenticated`). Sin columnas nuevas, sin redefinir funciones, no modifica filas. Expectativas en `supabase/expectations/20261014090000_shopping_manual_items.json` |
| Convención | Manual: `item_key 'manual|<nombre normalizado>'`, `origins [{kind:"manual", quantity}]`. Ajuste en fila de platos: orígenes de platos + `{kind:"user_adjust", quantity}` |
| `edit_shopping_items` | `add` (id del cliente; reenvío → `duplicate`; clave activa → `existing`; carrera → `existing` por el índice único), `set_quantity` (cualquier fila activa; manual cambia cantidad/unidad; platos conservan unidad), `remove` (solo manuales; `not_manual`). ≤ 50 por tipo, validados con `shopping_item_valid`. Semana `FOR SHARE`; lista no vigente → `stale`. No cambia firma, base ni `reconciled_at`. Único DELETE, con el permiso local `becook.shopping_edit` |
| Trigger | Fuera de `edit_shopping_items`, DELETE de un manual → se ignora; UPDATE → se ignora salvo que solo cambie el marcado (`checked`, `checked_quantity`, `needs_review`, `updated_at`). Cascadas (lista, semana, cuenta) → se borra (`pg_trigger_depth() > 1`) |
| Cliente (datos) | `addManualShoppingItem`, `setShoppingItemQuantity`, `removeManualShoppingItem`, `readShoppingView` en `src/lib/data/shopping.ts`. Cola `pendingEdits` en la copia del dispositivo, en la misma cola que los marcados y enviada antes que ellos; tokens por edición; la última cantidad gana; `add` nunca se descarta. `diffShoppingList` excluye manuales; `discardedAdjustments` avisa de ajustes descartados. `parseShoppingOrigins` acepta `manual`/`user_adjust`. `fromCards` solo cuenta fichas. Despensa: `addPantryItems`, `markPantryItemUsedUp`, `ensurePantryItemInStock`, `createDeferredDeletes`; catálogo de básicos en `pantryStorage.ts` |
| Compra (`ShoppingListPage`) | Lista continua por secciones (`ShoppingSection`) con accesos rápidos en la cabecera (`nav` «Secciones de la lista», `scroll-mt-64`), progreso global (sin contar lo de casa ni lo que ya no hace falta), semana y raciones, «Ya lo tienes habitualmente» plegado (`<details>`) con «Se me acabó», «Añadir a despensa» en lo comprado, formulario de manual (`ManualItemForm`) y edición de cantidad (`QuantityEditor`). Casillas con `aria-label` propio («Tomate, 4 ud») y descripción: ya no salen como «on». 44 px, campos a 16 px, CTA en `accent-strong` con blanco, avisos en regiones `role="status"`/`aria-live` persistentes |
| Despensa (`PantryPage`) | «Tengo / Se acabó» (`PantryStockToggle`, `role="group"`, `aria-pressed`), básicos en bloque (`PantryBasicsPicker`, una sola `add_pantry_items`), borrar con «Deshacer» ~6 s (región `role="status"`; salir o cambiar de identidad confirma) |
| Compatibilidad con el cliente desplegado (f810818) | Lee los manuales como normales (su lector descarta el origen), puede marcarlos; su reconciliación pide quitarlos y el trigger los deja (comprados y no comprados). Límites: en el respaldo de lista nueva los manuales se quedan en la lista anterior; sobrescribe una cantidad ajustada de una fila de platos al reconciliarla. Copias congeladas en `tests/fixtures/legacy-shopping-{client,reconcile,list}-f810818.ts` |
| Revisión (apta con cambios) | H1: lotes de ediciones cortados antes de repetir un id o una clave de add/remove (add, remove y add del mismo artículo → tres llamadas; antes, 22023 y cola bloqueada); un rechazo 22023/42501 descarta el lote, vuelve a la lista de la cuenta y avisa (`discarded` / `discardedLocalChanges`); el fake valida como el RPC. H2: un manual nunca va a «Ya lo tienes habitualmente». H3: la marca de un artículo con el alta pendiente queda pendiente (sin llamar al servidor ni descartarse, también al cargar) hasta que llega el alta. H4: borrados aplazados confirmados también en `pagehide`. UI: mensajes por estado en cantidad y quitar (y la sección visible, «Otros» para congelados); básicos con conflicto no se anuncian como añadidos; foco devuelto tras Quitar, guardar/cancelar cantidad, «Añadir a despensa», «Se me acabó», borrar/deshacer en Despensa y cerrar el formulario o el selector de básicos; «Añadir a despensa: X»; `aria-invalid`/`aria-describedby` en Cantidad. Tests +7 |
| Tests | `npm test` **397/397** (367 → 390 → 397 tras la revisión): `tests/shopping-manual.test.cjs` (22 = 16 + 6 de la revisión: orígenes, diff con manuales y ajustes, alta con id y reenvío, sin conexión, respuesta perdida, marcado tras alta sin conexión, cambio de platos con manuales, base sin trigger, quitar solo manuales, cantidades con `user_adjust`, `fromCards`, sin lista, invitado y marcado de Compra), `tests/pantry-actions.test.cjs` (8 = 7 + 1), bloque de Compra/Despensa de `tests/a11y-semantics.test.cjs` (líneas 57-68). `test:db` **432/432** (421 → 432): `scripts/shopping-manual-db-tests.cjs` (11: alta/reenvío/existente, cantidades, guarda, cascadas, permisos y validación, dos dispositivos, reconciliación del cliente nuevo ×2, despliegue con f810818 ×2 y límite conocido) |
| Comprobaciones | Tras la revisión: `npm run lint` sin avisos; `npm run typecheck` OK; `npm test` 397/397 (con `GITLEAKS_BIN`); `next build` OK en una copia sin `.env*` (variables sintéticas, 23 páginas); `db:migrate` + `test:db` 432/432. Sin `db:reset` (no imprescindible). **Sin recorrido en navegador** (no se arranca `npm run dev` en esta ola) |
| Decisiones | 1) Clave manual por nombre (no por unidad ni sección): «Leche» una vez por lista. 2) El manual es siempre línea propia aunque coincida con un ingrediente de los platos. 3) En filas de platos solo se edita la cantidad (la unidad fija la clave). 4) Líneas con varias filas (listas antiguas) y «al gusto» no son editables. 5) Ediciones con resultado por operación (`missing` no invalida el lote); la lista no vigente sí (`stale`). 6) Sin `needs_review` al ajustar. 7) «Se me acabó» y «Añadir a despensa» casan por nombre como la clasificación (sin plurales); la sección de despensa sale de la tienda. 8) Progreso: solo pendiente + comprado («Revisar» cuenta como pendiente). 9) Pastilla de Despensa «x/y en casa» |
| Pendiente | Recorrido en navegador (320/390 px, VoiceOver); migración en remoto (abajo); en la integración con NAV, revisar que el `scroll-mt-64` siga cubriendo la cabecera; cabecera compactable de Compra (paso 34, decisión 6); en el respaldo de lista nueva el cliente nuevo tampoco copia los manuales a la lista nueva (igual que el desplegado) |
| Base local compartida | La migración está aplicada en el Docker `becook-iteration02`, que comparten las tres ramas: un `test:db` lanzado desde C6 o NAV sin el fichero de expectativas de D5 fallará en «schema metadata: functions/triggers» hasta integrar D5 |

## Aplicación remota (cuando Sergio lo autorice)

Orden: becook-preview → validar Preview → producción con OK explícito, **antes** del merge a `main`
(sin la migración el código nuevo guarda las ediciones como pendientes en el dispositivo y no hay
protección del servidor frente al cliente desplegado).

1. Verificar el ref contra la tabla de `AGENTS.md` (preview `qdhpdhnpcsfhmygjofqb`; producción
   `wejvptpkxlllfpskyisu`).
2. Precondición (solo lectura): `SELECT count(*) FROM public.shopping_items WHERE item_key LIKE 'manual|%';`
   debe ser 0. Recuentos previos: `SELECT count(*) FROM public.shopping_lists;`,
   `SELECT count(*), count(*) FILTER (WHERE checked) FROM public.shopping_items;`.
3. Aplicar con el conector de Supabase (`apply_migration`, nombre `shopping_manual_items`) el
   contenido de `supabase/migrations/20261014090000_shopping_manual_items.sql` quitando **solo**
   `BEGIN;` y `COMMIT;` (el conector abre su propia transacción). Las dos líneas `SET LOCAL`
   (`lock_timeout` 5 s y `statement_timeout` 120 s) **se mantienen**: valen dentro de la
   transacción del conector. (El comentario de cabecera de la migración dice «without BEGIN/COMMIT
   and SET LOCAL»; manda este procedimiento.) Una parte; si se prefiere en dos, en este orden y con
   los `SET LOCAL` al principio de cada una:
   a) `shopping_items_guard_manual` (función, REVOKE y trigger); b) `edit_shopping_items` y sus
   REVOKE/GRANT. `edit_shopping_items` contiene un `DELETE` en su cuerpo (como C4); no es un borrado
   de datos al aplicarla. Si el conector se quedara esperando confirmación, pegar ese SQL en el SQL
   Editor y registrar la versión a mano en el ledger, como en B7.
4. Verificar: `SELECT proname FROM pg_proc WHERE proname IN ('shopping_items_guard_manual','edit_shopping_items');`
   (2), `SELECT tgname FROM pg_trigger WHERE tgname='shopping_items_guard_manual';` (1),
   `SELECT grantee FROM information_schema.routine_privileges WHERE routine_name='edit_shopping_items';`
   (`authenticated`, `postgres`), recuentos del paso 2 iguales.
5. Registrar en `supabase/hosted/applied-preview.json` (y en producción en
   `supabase/hosted/applied-production.json`) con la versión que devuelva el ledger.
6. Producción: avisar a Sergio, backup completo (esquema, datos y roles) fuera del repositorio y
   comprobar que existe. La migración no modifica filas; aun así, copia interna
   `backup_AAAAMMDD` de `shopping_items` si se exige para cada escritura.
7. Reversión (sin datos que recuperar): `DROP FUNCTION public.edit_shopping_items(integer, integer, uuid, jsonb);`
   `DROP TRIGGER shopping_items_guard_manual ON public.shopping_items;`
   `DROP FUNCTION public.shopping_items_guard_manual();` — con el código nuevo desplegado, las
   ediciones quedarían pendientes en los dispositivos.
