# Iteración B6 — Compra ligada a su semana y firma estable 🟡 (2026-10-09, rama `audit/b6-compra`, sin aplicar en remoto)

Pasos 12 y 14 del roadmap (H7; §5, §9, §13). Para copiar en `PROGRESS.md` al integrar.

| Elemento | Detalle |
|---|---|
| Defectos reproducidos | Script contra Supabase local con el cliente anterior (6164872): **dos marcados → 3 listas y 9 artículos** (una lista completa por clic); **volver a aplicar los mismos platos** (`apply_week` sube `updated_at`) → la lista remota se da por caducada → nueva llamada a la IA y marcados perdidos; un dispositivo **con caché no ve los 2 marcados** hechos en otro (la caché se leía antes que la cuenta). Además, por lectura de código: marcar antes de resolver `remoteWeekId` no guardaba nada, y salir de Compra abortaba la generación y la relanzaba al volver (la doble compra en 1 min observada en A4) |
| Migración `20261009090000_shopping_list_per_week` | ✅ local. Aditiva: `shopping_lists.week_signature` (NULL en las listas existentes, CHECK 1–8000), índice `(week_id, created_at DESC, id DESC)`, `save_shopping_list` y `set_shopping_items_checked` `SECURITY INVOKER`, solo `authenticated`. **No modifica filas existentes**: las listas antiguas quedan como historial. Expectativas en `supabase/expectations/` (sin `replaces`; `supersedes` documenta la ruta de cliente sustituida) |
| Lista vigente | La más reciente de su semana; la lista se busca por la semana del usuario (`auth.uid`, año, semana), nunca por «la última creada». Cambiar de platos crea una lista nueva y conserva la anterior |
| Firma de compra (paso 14) | `getShoppingSignature`: semana ISO + platos por posición (normalizados: mayúsculas, espacios; un día libre entero = sin día) + raciones + restricciones + origen de ingredientes (`shoppingListContext`: 2 personas, sin restricciones, `dish-titles-v1`, preparado para C1/C2). Sin fechas ni `weeks.version` (sube en cualquier escritura, también al aplicar el mismo menú); la versión es solo guarda de concurrencia al guardar. Listas sin firma: regla anterior (generada después del último cambio). Cachés de B3 y anteriores aceptadas y reescritas |
| Cliente (`src/lib/data/shopping.ts`) | Lectura: lista de la cuenta → copia del dispositivo solo si la cuenta no responde (aviso) → sin copia, error con «Reintentar» y **sin generar**. IA solo si la cuenta confirma que no hay lista para ese contenido. Marcar = `set_shopping_items_checked` del artículo (fijar valor, en cola por semana, el último gana); lista sustituida → `stale`, no escribe y se relee. Sin conexión: marcados `pending` reenviados al cargar; lista generada sin guardar se guarda después **sin IA**. Una generación por contenido, no se cancela al salir de la página. «Usar este menú» usa `ensureShoppingList` (mismo menú → misma lista y marcados) |
| Eliminado | `saveShoppingListToSupabase` (INSERT de lista completa), `syncShoppingListToSupabase`, `generateAndCacheShoppingListForWeek`, `getRemoteWeekId`, `loadRemoteShoppingList` y el script desactivado `scripts/test-save-shopping-list.ts` (usaba la ruta borrada y «la última semana») |
| Despliegue | Compatible: con la migración aplicada, el cliente de `main` (5a573ff, copia congelada en `tests/fixtures/legacy-shopping-client-5a573ff.ts`) sigue guardando y leyendo listas, y el cliente nuevo reutiliza su lista más reciente sin IA y la marca en su sitio (escenario 8 de `test:db`). Orden: migración → código |
| Política | `docs/development/data-sync.md`, sección «Lista de la compra (B6)» |
| Tests | `tests/shopping-week.test.cjs` (17): firma, generación única y reutilización, marcado por artículo, segundo dispositivo y caché antigua, mismo menú otra vez, cambio de plato con historial, semana pasada, lista sustituida (`stale`), marcado sin conexión, lista generada sin conexión, cuenta inalcanzable sin copia, dos llamadas simultáneas → 1 IA, dos dispositivos → 1 lista, semana cambiada al generar, listas sin firma, invitado, marcados rápidos en orden. `tests/calendar.test.cjs` adaptado a la firma nueva. `test:db` +12 (`scripts/shopping-db-tests.cjs`): 5 recorridos, concurrencia (3 rondas), versión/validación, permisos (otro usuario, anon, artículos de dos listas) y 2 de despliegue |
| Comprobaciones | lint, typecheck, test 152/152, build, test:db 350/350 (también tras `db:reset` + `db:seed`). `npm run dev` en :3000: `/shopping/list`, `/week`, `/create-menu`, `/login` 200; `POST /api/generate-shopping-list` sin sesión 401. **Sin prueba manual en navegador** (extensión de Chrome no disponible en esta sesión): pendiente |
| Observaciones | Editar un plato sigue regenerando la lista entera (los marcados de la anterior quedan en el historial); el delta por ingrediente es C4 (paso 20). La pantalla sigue leyendo la semana seleccionada del dispositivo, no `?week=`. Estados de guardado completos y reintento visible por entidad: B5 |
| Pendiente | Prueba manual en navegador (Sergio); aplicar la migración en becook-preview y registrarla en `supabase/hosted/applied-preview.json`; validar la Preview; producción con OK explícito y backup previo. Antes de producción, solo recuentos: listas por semana y listas con `week_signature` NULL (todas lo serán) |

## Migraciones por entorno (fila nueva)
| Migración | Local | becook-preview | becook (producción) |
|---|---|---|---|
| shopping_list_per_week | ✅ | ⏳ | ⏳ |

## Pasos del roadmap (filas)
| Paso | Iter. | Estado | Nota |
|---|---|---|---|
| 12 Compra ligada a su semana | B6 | 🟡 | Rama `audit/b6-compra`: lista vigente por semana, lectura remota primero, marcado por artículo; migración solo local |
| 14 Firma de compra estable | B6 | 🟡 | Firma canónica sin fechas ni versión; mismo menú → misma lista |
