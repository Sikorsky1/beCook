# beCook: identidad, datos locales y sincronización (B1, B4, B5, B6, B7, D2, C1, C2)

Pasos 06 y 07 del roadmap (H3, H7), sin cambios de base de datos, y paso 10 (B4, H8):
escrituras de semana transaccionales con versión e idempotencia.

## Identidad antes que datos

- `src/lib/session/identity.ts` resuelve la sesión con `getSession()` y escucha
  `onAuthStateChange`. Estado: `status` (`resolving` | `ready`), `scope`, `userId`,
  `email`, `sessionExpired` y `epoch`.
- `IdentityProvider` (en `src/app/layout.tsx`) lo expone con `useIdentity()`.
  Ninguna pantalla lee datos hasta `status === "ready"`.
- Cada cambio de usuario (login, logout, A → B, caducidad) incrementa `epoch`: las
  pantallas descartan su estado en memoria y las cargas en curso, y recargan.
- Logout explícito (`signOut` del store): se borra la caché del usuario en el
  dispositivo. Si hay cambios pendientes, el Perfil pide confirmación antes.
- Sesión caducada (`SIGNED_OUT` sin logout explícito): el ámbito pasa a invitado,
  se muestra «Tu sesión ha caducado» y la caché del usuario, incluidos los cambios
  pendientes, se conserva hasta que vuelva a entrar.

## Claves locales

`becook:<scope>:<entidad>[:<semana>]`, con `scope` = `guest` o `u_<userId>`.
Entidades: `profile`, `pantry`, `week:YYYY-Www`, `selected-week`,
`shopping:YYYY-Www`, `legacy-origin` (solo invitado).

Valor con versión de formato:
`{ v: 1, data, savedAt, remoteVersion, pending }`. `remoteVersion` es la versión
remota sobre la que se basa la copia (semana: `weeks.version`; perfil y despensa:
`updated_at`; despensa desde B7: ver «Despensa (B7)»); `pending` indica un cambio
local no aceptado aún por el servidor (nunca en invitado).

El borrador de «Crear menú» sigue en `sessionStorage` sin ámbito, a propósito:
sirve para pasar de invitado a sesión iniciada.

## Fuente de verdad y conflictos

Invitado: solo datos locales, sin llamadas remotas; desde B5 ve «Solo en este dispositivo» y
ningún otro estado de sincronización.

Usuario autenticado (`src/lib/data/sync.ts`, `src/lib/data/repositories.ts`):

1. Se muestra la caché del propio ámbito, si existe, y se revalida siempre contra
   Supabase filtrando por `user_id`.
2. Nada se declara vacío hasta que el remoto lo confirma. Si el remoto no responde,
   se mantiene la caché con el aviso «No se ha podido comprobar tu cuenta».
3. Al guardar: la copia local se marca `pending` y se compara la versión remota con
   `remoteVersion`. En la semana la comparación la hace la base de datos dentro de la
   misma transacción que la escritura (`apply_week` / `update_week_slot` con
   `p_expected_version`); en perfil y despensa, una lectura previa.
   - Igual (o sin datos remotos): se escribe y se actualiza la versión.
   - Distinta: **gana el remoto**. No se escribe, se muestra la versión de la cuenta
     y el aviso «Tu cuenta tenía cambios más recientes…».
   - Error de red: el cambio queda `pending`.
4. Al recargar con algo `pending`:
   - Si el remoto sigue en `remoteVersion`, se reenvía lo pendiente.
   - Si cambió (otro dispositivo), **gana el remoto** y lo pendiente se descarta con
     el aviso «Había cambios en este dispositivo que no se guardaron…».
5. Remoto vacío y nada pendiente: se borra la caché (se eliminó en otra parte).
6. Los guardados de una misma entidad se encadenan: un dispositivo nunca entra en
   conflicto consigo mismo y un guardado superado por otro posterior no se envía.
7. Excepción explícita: al aplicar un menú, si la semana ya existía y el usuario ha
   confirmado «Ya hay menú para esta semana. ¿Quieres reemplazarlo?», ese guardado
   sobrescribe sin comprobar versión (`overwrite`). Sin esa confirmación nunca hay
   `overwrite`: si la semana no existía al leerla y otro dispositivo la crea antes de
   guardar, el resultado es conflicto y gana el remoto.

La comparación usa siempre versiones del servidor, nunca el reloj del dispositivo.
Versión por entidad: `weeks.version` (entero; el trigger `set_weeks_version` lo
incrementa en cada INSERT/UPDATE de la semana, sea cual sea el cliente que escribe),
`profiles.updated_at` y, para la despensa, `pantry_items.version` **por artículo** (B7;
antes, el `updated_at` más reciente de todos sus artículos). `weeks.updated_at` sigue existiendo y sirve para saber si una lista de la
compra es anterior al último cambio de la semana.

Copias de semana guardadas antes de B4 tienen un `updated_at` como `remoteVersion`:
nunca coinciden con `weeks.version`, así que se tratan como versión desconocida
(se envía `-1`): si había un cambio pendiente, gana el remoto; si no, la siguiente
carga reescribe la caché con la versión nueva.

## Escrituras de semana (B4)

Migración `20261008090000_week_transactional_writes` (aditiva):
`weeks.version`, `weeks.request_keys` (últimas 20 claves aplicadas),
`UNIQUE (week_id, position)` en `week_days`, trigger `set_weeks_version` y dos
funciones `SECURITY INVOKER` (RLS y propietario se aplican como a cualquier escritura
del cliente), solo para `authenticated`. Resultado de ambas:
`{status: applied | duplicate | conflict, week_id, version, updated_at}`.

- `apply_week(año, semana, días, clave, versión esperada, overwrite, petición de
  generación)`: crea o reemplaza la semana completa en una transacción (los días no
  enviados se eliminan; los parciales conservan solo sus días). Un error a mitad,
  incluida una petición de generación de otro usuario, deshace todo: ya no existe el
  reintento que guardaba la semana sin el vínculo ni el `delete → insert` en
  peticiones separadas. Marca la petición de generación como `applied` en la misma
  transacción. Dos creaciones simultáneas de la misma semana: una gana y la otra
  recibe conflicto.
- `update_week_slot(año, semana, posición, comida, estado, plato, versión, clave)`:
  editar un plato solo cambia esa comida de ese día (las demás filas no se tocan).
  Si la semana o el día ya no existen, o la versión cambió: conflicto.
- Clave de petición (`p_request_key`): una por intento. «Usar este menú» usa la misma
  clave mientras sea el mismo menú y la misma semana (doble clic, reintento tras un
  fallo de red): la segunda llegada responde `duplicate` y no cambia nada. Cada
  guardado normal genera la suya.
- El botón «Usar este menú» queda deshabilitado mientras guarda. Mensajes:
  aplicado «Tu semana se ha actualizado correctamente.», duplicado «Este menú ya
  estaba aplicado a tu semana.», conflicto «Otro dispositivo acaba de guardar un menú
  para esta semana…», sin conexión «No hemos podido guardar el menú en tu cuenta…»
  (se reintenta con la misma clave). La lista de la compra solo se genera después de
  un guardado correcto.

Despliegue: la migración va antes que el código. El cliente anterior (`main`,
`delete → insert` directo sobre `week_days`) sigue funcionando con la migración
aplicada: sus escrituras incrementan `weeks.version`, de modo que una pestaña con el
cliente nuevo y una versión anterior recibe conflicto (test de `test:db`, escenario 7,
con una copia congelada del cliente de 806738e en `tests/fixtures/`).

## Lista de la compra (B6)

Pasos 12 y 14 del roadmap (H7). Código en `src/lib/data/shopping.ts`; migración
`20261009090000_shopping_list_per_week` (aditiva: `shopping_lists.week_signature`,
su CHECK de longitud, índice `(week_id, created_at DESC, id DESC)` y dos funciones
`SECURITY INVOKER` solo para `authenticated`). Las listas existentes no se tocan.

- **Lista vigente**: la más reciente de su semana (`created_at`, luego `id`). Las
  anteriores se conservan como historial hasta decidir una limpieza.
- **Firma** (`getShoppingSignature`): semana ISO, platos por posición del día
  (sin mayúsculas ni espacios sobrantes; un día con las dos comidas libres equivale a
  no tenerlo), raciones, restricciones y origen de ingredientes
  (`shoppingListContext`: hoy 2 personas, sin restricciones, `dish-titles-v1`).
  Nunca fechas presentadas ni `weeks.version`: la versión sube con cualquier
  escritura, también al aplicar otra vez el mismo menú; se usa solo como guarda de
  concurrencia al guardar. Listas sin firma (anteriores a B6): valen si se generaron
  después del último cambio de la semana (regla anterior). Cachés del dispositivo
  con la firma de B3 o anterior se aceptan y se reescriben.
- **Orden de lectura** (con sesión): lista de la cuenta para esa semana → si la cuenta
  no responde, copia del dispositivo (aviso) → si no hay copia, error con «Reintentar»
  y **no se genera** (podría duplicar una lista existente). Se genera con IA solo si
  la cuenta confirma que no hay lista para ese contenido.
- `save_shopping_list(año, semana, firma, artículos, versión esperada)`: bloquea la
  semana (`FOR UPDATE`, igual que `apply_week`). `existing` si la lista vigente ya
  tiene esa firma (dos dispositivos o pestañas generando a la vez acaban con una
  lista); `week_changed` si la semana cambió mientras se generaba (si los platos son
  los mismos, el cliente reintenta con la versión nueva; si no, la lista se descarta);
  `no_week`; `created`. Valida 1–300 artículos y categorías.
- `set_shopping_items_checked(ids, valor)`: fija (no alterna) el valor de las filas de
  un artículo visible, solo si su lista sigue vigente; si no, `stale` y no escribe
  nada (la pantalla relee la lista de la cuenta). Los marcados de una semana salen en
  cola y en orden: el último gana.
- **Sin conexión**: un marcado queda en `pendingChecks` y se reenvía en la siguiente
  carga si la lista sigue siendo la misma; una lista generada sin poder guardarse se
  guarda en la siguiente carga **sin volver a llamar a la IA**.
- **Una generación por contenido**: la petición a la IA no se cancela al salir de
  Compra; volver a la página, o abrir Compra justo después de «Usar este menú», espera
  la misma petición (el doble cobro observado en A4).
- «Usar este menú» llama a `ensureShoppingList`: si los platos no cambiaron, se
  mantiene la lista con sus marcados.

Despliegue: migración antes que el código. El cliente de `main` (un INSERT de lista
completa por clic) sigue funcionando y el cliente nuevo reutiliza su lista más
reciente (escenario 8 de `scripts/shopping-db-tests.cjs`, con una copia congelada
del cliente de 5a573ff en `tests/fixtures/`).

## Compra desde las fichas y cambios de plato sin perder lo comprado (C4)

Pasos 19 y 20 del roadmap. Código en `src/lib/shopping/{units,build,reconcile}.ts` (puros) y
`src/lib/data/shopping.ts`; migración `20261013090000_shopping_item_origins` (aditiva salvo
`save_shopping_list`, redefinida con la misma firma).

- **Origen de cada artículo.** `shopping_items.item_key` («categoría|nombre normalizado|dimensión»;
  nombre sin mayúsculas, acentos ni plurales simples) y `origins` (`[{day, meal, dish, kind,
  versionId?, quantity}]`, `kind` = `card_reviewed` | `card_inferred` | `ai_title`). Un artículo
  activo por clave y lista (índice único parcial). `shopping_lists.ingredient_basis` = `mixed-v1`
  cuando los artículos tienen clave y orígenes; NULL en listas anteriores a C4 o del cliente previo.
- **Unidades** (`units.ts`, misma tabla que `shopping_quantity_base`): masa en g (kg ×1000),
  volumen en ml (cl ×10, l ×1000), unidades en «ud» (ud, uds, unidad(es) o sin unidad); cucharada,
  cucharadita, diente y pizca se agrupan por nombre sin convertir; nunca volumen ↔ masa. kg y l solo
  al mostrar (desde 1000). Cantidad NULL = «al gusto» (fila propia; la base solo la acepta con esa
  unidad). Redondeo de compra: g/ml/ud enteros hacia arriba, cucharadas y pizcas de media en media.
- **Compra mixta.** Plato con ficha (C2): ingredientes de la ficha × raciones de la semana (C1,
  `foodContext.servings`, 2 si no hay) / raciones de la ficha, leídas en una sola consulta
  (`getRecipeCardsFromSupabase`, `.in`). Los opcionales no entran (aviso fijo en Compra). Plato sin
  ficha: los ingredientes `ai_title` que la lista ya tiene para ese plato (misma comida o el mismo
  plato movido de día), si la lista se hizo para las mismas raciones y restricciones; si no, una
  llamada a `/api/generate-shopping-list` con `breakdown: true` y solo esos platos (el resto
  «LIBRE»), que responde `dishes: [{day, meal, items}]` además de `items` (cliente anterior intacto).
  Una llamada, una unidad de cuota. Con todos los platos con ficha no hay IA. Las fichas no se
  generan al preparar la compra.
- **Despensa** (B7, sin cantidades): no se descuenta nada; al pintar, `classifyShoppingLine`
  distingue «Te falta comprar», «Ya lo tienes habitualmente» (nombre normalizado y plural simple),
  «Comprado», «Comprado, ya no hace falta» y «Revisar».
- **Firma.** Sin ningún plato con ficha, exactamente la de B6/C1 (las listas existentes no cambian).
  Con alguno, añade `cards: [[pos, lunchV, dinnerV]]` e `ingredientSource: "mixed-v1"`.
- **Cambio de platos** (`loadShoppingList` → `outdated` en lugar de `missing`): conjunto deseado →
  diff por `item_key` en el cliente (`diffShoppingList`; a las filas sin clave se les calcula con
  las mismas reglas) → `reconcile_shopping_list(año, semana, lista, firma origen, firma destino,
  ops, versión)`: `FOR UPDATE` de la semana; `no_week` | `week_changed` | `stale` (otra lista
  vigente, otra firma o un artículo que no es de esa lista) | `existing` (otro dispositivo ya la
  dejó en la firma destino) | `applied` con resumen `{added, removed, keptBought, changed, review}`.
  La lista conserva id y `created_at`. Quitar: no marcado → se borra
  (`shopping_items_discard_unbought`); marcado → `removed_at` («Comprado, ya no hace falta»).
  Actualizar un marcado: sigue marcado; si ahora hace falta más que lo comprado (`checked_quantity`,
  en unidades base; en filas marcadas antes de C4 se fija con la cantidad que tenían) →
  `needs_review` hasta volver a marcarlo. Una clave ya ocupada (dos dispositivos añadiendo a la vez)
  → `stale` sin escribir nada. El resumen compara cantidades en unidades base (1 kg → 1000 g no es
  un cambio). «Usar este menú»
  (`ensureShoppingList`) también reconcilia.
- **Marcado** (`set_shopping_items_checked` sin cambios): el trigger `shopping_items_check_state`
  guarda `checked_quantity` al marcar, lo quita al desmarcar y resuelve `needs_review`, también
  para el cliente desplegado. Un marcado sobre un artículo que ya no está → `stale` y se relee.
- **Si la IA falla o no hay cuota.** Lista con orígenes válidos (mismas raciones y restricciones):
  se aplica lo sabido, sin quitar filas que un plato pendiente pueda necesitar, y el plato queda
  pendiente («Faltan ingredientes de «X»», botón «Calcular (IA)» = reconciliación con la misma firma
  solo para esos platos). Lista sin orígenes (anterior a C4) u orígenes de otras raciones o
  restricciones: no se toca y se muestra tal cual con «Esta lista es de tu menú anterior» y el botón
  «Actualizar lista (IA)»; nunca un error en lugar de la lista. Un fallo no se vuelve a pagar al
  reabrir Compra en la misma sesión (solo con el botón). Las respuestas de la IA se recuerdan entre
  los reintentos de una misma actualización (lista o semana que cambian a la vez); si tras tres
  intentos sigue cambiando, se muestra la lista como está. Sin la RPC en la base (solo PGRST202 o
  un 42883 que la nombre) o servidor sin desglose: lista nueva, como en B6.
- **Despliegue.** Migración antes que código. El cliente de `main` (copia congelada
  `tests/fixtures/legacy-shopping-client-6121e34.ts`) sigue guardando, marcando y leyendo; el
  cliente nuevo reconcilia sus listas en el sitio conservando marcados. Límite conocido: una pestaña
  con el cliente anterior no puede leer una lista con filas «al gusto» del cliente nuevo.
- **Pruebas.** `tests/shopping-recipes.test.cjs` (unidades, construcción, diff, firma, capa de
  datos con cuenta en memoria de `tests/helpers/fake-shopping.cjs`, ruta con desglose) y
  `scripts/shopping-reconcile-db-tests.cjs` en `test:db` (fichas, cambio de plato en el sitio,
  trigger con el cliente anterior, contrato de la RPC, permisos, concurrencia, despliegue).
  `tests/shopping-week.test.cjs` y `scripts/shopping-db-tests.cjs` cubren además el respaldo a B6.

## Despensa (B7)

Paso 13 del roadmap (H8 §8). Código en `src/lib/data/pantry.ts`; migración
`20261009180000_pantry_item_writes` (aditiva: `pantry_items.version`, trigger
`set_pantry_items_version` y tres funciones `SECURITY INVOKER` solo para `authenticated`). Las
filas existentes no se tocan (empiezan en versión 1).

- **Nunca se reemplaza la despensa entera.** Antes, cada cambio era DELETE de todas las filas
  del usuario + INSERT de la lista: un fallo entre ambos dejaba la cuenta vacía y dos
  dispositivos a la vez duplicaban filas o perdían un cambio.
- **Lectura**: despensa de la cuenta → si no responde, copia del dispositivo (aviso). Nada se
  declara vacío sin confirmarlo la cuenta. Las filas se agrupan por categoría y nombre
  normalizado (mayúsculas, acentos, espacios): las filas duplicadas por el cliente anterior se
  ven como un artículo y cada cambio se aplica a todas ellas.
- **Escrituras por artículo**, cada una con la versión de sus filas:
  - `add_pantry_items(items)`: id elegido por el cliente → reenviar no crea nada
    (`duplicate`). Si ya existe un artículo con esa categoría y nombre → `existing`, no se
    duplica (dos dispositivos añadiendo lo mismo acaban con una fila). Enlaza el perfil propio
    del usuario (el más reciente), nunca uno enviado por el cliente.
  - `set_pantry_items_active(filas, valor)`: fija el valor (no alterna). Si ya lo tenía →
    `applied` sin escribir (reenvío inofensivo). Versión distinta → `conflict`. Fila
    inexistente → `missing`.
  - `delete_pantry_items(filas)`: filas ya borradas → `applied`. Versión distinta → `conflict`.
  - Todas toman un bloqueo de transacción por usuario: las escrituras de despensa de un
    usuario van de una en una.
- **Conflictos**: cambios en artículos distintos nunca chocan. Un cambio sobre un artículo que
  otro dispositivo modificó o borró desde que se leyó se rechaza: **gana la cuenta**, se relee
  y se muestra el aviso «Había cambios en este dispositivo que no se guardaron…».
- **Sin conexión**: cada cambio queda pendiente en su artículo (`pending`: `add` con su id,
  `active` o `delete`, con las versiones en que se basó) y se envía en la siguiente carga. Un
  cambio cuya respuesta se perdió se reenvía sin efecto. Añadido y borrado sin conexión → no
  llega nada a la cuenta.
- **Despensa vacía**: si la cuenta confirma que no hay artículos, se muestran los de base y el
  primer cambio los añade todos (una petición). Sin esa confirmación (sin copia y sin
  conexión) solo se envía el artículo cambiado: nunca se siembran artículos en una cuenta que
  ya tiene despensa.
- **Copias anteriores a B7** con un cambio pendiente: si la cuenta sigue en la versión en que
  se basaron (`updated_at` más reciente), el cambio se convierte en escrituras por artículo; si
  no, gana la cuenta.
- Invitado: solo local, como antes.

Despliegue: migración antes que el código. El cliente de `main` (DELETE + INSERT) sigue
funcionando; sus filas nuevas tienen versión 1 e ids nuevos, y el cliente nuevo, al no
encontrar las filas que tenía, relee la cuenta en lugar de recrearlas (escenario 8 de
`scripts/pantry-db-tests.cjs`, con una copia congelada del cliente de ab2433b en
`tests/fixtures/`).

## Aplicar un menú y estados de guardado (B5)

Pasos 11 y 15 del roadmap (H9). Sin cambios de base de datos.

- **«Usar este menú»** (`src/lib/applyWeek.ts`, `applyMenuToWeek`): resultado del menú separado
  del de la compra. Menú: `account` (la cuenta lo confirmó: «Menú guardado en tu cuenta.»),
  `device` (invitado: «Menú guardado solo en este dispositivo…»), `pending` (la cuenta no
  respondió: «Solo en este dispositivo…», el botón pasa a **«Reintentar guardado»**), `conflict`,
  `unchecked` (no se pudo leer la semana; no se guarda nada) y `cancelled` (no reemplazar). La
  semana se abre en cuanto el menú está guardado; la lista de la compra se prepara **aparte**
  (`ensureShoppingList`, solo si el menú está en la cuenta) y su fallo nunca convierte el guardado
  en error: Compra muestra su propio estado y «Reintentar».
- **Propuesta recuperable** (`src/lib/menuProposal.ts`, entidad `menu-proposal:YYYY-Www` con
  ámbito): el menú propuesto o importado se guarda en el dispositivo hasta que se aplica, con su
  intento (clave de petición y respuesta a «reemplazar»). Recargar Crear menú o salir de la página
  no lo pierde («Propuesta sin aplicar, recuperada de este dispositivo» y «Descartar propuesta»);
  reintentar es la misma escritura (`duplicate` si ya había llegado) y nunca llama a la IA. No
  cuenta como pendiente y se borra con el resto del ámbito al cerrar sesión.
- **Estados visibles** (`src/lib/syncStatus.ts`, componente `SyncStatus`) en Semana, Compra,
  Despensa y Perfil: «Solo en este dispositivo» (invitado), «Guardando…», «Comprobando tu
  cuenta…», «Guardado en tu cuenta» (solo tras respuesta de la cuenta), «Pendiente de
  sincronizar» y «Error: reintentar» (la cuenta no responde y se muestra la copia del
  dispositivo). Los dos últimos llevan **«Reintentar»**, que vuelve a leer la entidad (y con ello
  reenvía lo pendiente, sin IA); también se reintenta solo con el evento `online`. Al releer la
  misma entidad se mantiene el último estado conocido hasta que responde la cuenta. `SyncNotice`
  queda para conflictos y cambios descartados.
- **Recuperación de pendientes** (`src/lib/data/sync.ts`): una lectura con una copia `pending` se
  encola con los guardados de esa entidad (dos lecturas a la vez, o un guardado en curso, no la
  envían dos veces). Si la cuenta ya tiene exactamente ese cambio (`sameData`; en la semana,
  `sameWeekDays`: mismos platos por día, sin fechas), se da por guardado y no aparece «Había
  cambios… que no se guardaron» (respuesta perdida).
- **Compra pendiente**: una lista generada sin guardar en la cuenta o marcados no aceptados marcan
  la caché `shopping` como `pending`, así que el aviso de cierre de sesión los tiene en cuenta.

## Perfil y onboarding (D2)

- **Datos corporales opcionales.** `sex`, `birth_date`, `height_cm` y `weight_kg` admiten NULL desde
  `20261010090000_profile_optional_body_onboarding`; el formulario nunca los rellena y el generador no los usa.
- **Secciones confirmadas.** `profiles.confirmed_sections` guarda lo que el usuario ha respondido o confirmado
  (`household`, `goals`, `restrictions`, `allergies`, `training`, `body`). Guardar una sección la confirma.
  Un perfil del formulario anterior empieza sin ninguna: sus valores se muestran como «Asumido» hasta pulsar
  Confirmar, y Crear menú avisa de ello. Alergias `[]` con `allergies` confirmada es «Ninguna» explícita.
- **Copias sin confirmaciones.** Una copia del dispositivo anterior a D2 no lleva `confirmedSections`; al
  guardarla no se envía la columna y la cuenta conserva las suyas.
- **Onboarding.** `public.onboarding_progress` (una fila por cuenta que lo empezó) y `advance_onboarding(step)`,
  que solo avanza (`about` → `profile` → `pantry` → `done`). Un dispositivo atrasado no deshace lo guardado en
  otro. Cuenta sin fila pero con perfil o semanas = cuenta anterior: no se le muestra. Sin fila ni datos = alta
  nueva. El paso 2 solo avanza si el perfil quedó guardado en la cuenta (`synced`); la despensa exprés usa las
  escrituras por artículo de B7. Al terminar se va a Crear menú (`?from=onboarding`); el menú se genera y se
  confirma allí, con «Usar este menú».

## Contexto alimentario de cada semana (C1)

- **Perfil en servidor.** `/api/generate-menu` y `/api/substitute-dish` leen el perfil guardado con
  la sesión del usuario (`current_food_context()`, RLS) e ignoran `profile` del cuerpo. Sin perfil
  guardado → 409 `profile_required` (antes se generaba sin alergias); perfil ilegible → 503. Las
  dos respuestas añaden `foodContext` (restricciones usadas y versión; en el menú también `servings`).
- **Congelado.** Tras cada escritura de semana completa (`apply_week` aplicado o duplicado), el
  cliente llama a `freeze_week_food_context` con la misma clave. La base lee el perfil guardado
  (nunca datos del navegador) y guarda en `week_food_contexts`: raciones (de la petición de
  generación aplicada a esa semana; si no, el hogar del perfil; si no, 2), hogar, restricciones
  canónicas y su versión `fc1:<md5>`. No toca `weeks.version`. Repetido → `duplicate`; un reintento
  de una aplicación más antigua → `superseded`. Editar un plato no cambia el contexto. Si el
  congelado falla, el menú sigue guardado y la semana se comporta como anterior a C1.
- **Semanas anteriores a C1** (sin contexto): la compra sigue con 2 raciones y la firma de B6, así
  que sus listas no se regeneran; las listas nuevas de esas semanas respetan las restricciones del
  perfil actual.
- **Compra.** La firma incluye las raciones y la versión de restricciones congeladas; la ruta de
  compra recibe `isoWeek` y lee ese contexto en servidor (`week_food_context_status`). Volver a
  aplicar el mismo menú con un contexto distinto crea una lista nueva (la anterior queda en el
  historial).
- **Aviso en Semana.** `week_food_context_status` compara en la base el contexto congelado con el
  perfil actual (restricciones por versión, hogar por número). Si cambió, Semana lo dice y ofrece
  «Crear un menú nuevo para esta semana». Nunca afirma que los platos sean o no compatibles.

## Fichas de plato (C2)

- **Modelo.** `recipes` (identidad: catálogo global con `owner_user_id` NULL y `catalog_key`, o
  receta propia de un usuario; título y `title_key` = minúsculas y espacios normalizados) y
  `recipe_versions` (versión inmutable: raciones base 1–12, minutos, ingredientes
  `{name, quantity|null, unit|null, category, optional}`, ≤ 20 pasos, posibles alérgenos UE-14,
  `review_status` `reviewed` | `inferred`, `content_hash`). Las versiones no se modifican ni se
  borran directamente; solo se van con su receta o su cuenta. Solo el catálogo tiene versiones
  revisadas; un usuario solo tiene estimadas.
- **Vínculo por comida.** `week_days.lunch_recipe_version_id` / `dinner_recipe_version_id`
  (FK `ON DELETE RESTRICT`). NULL = solo título (menús anteriores a C2) o comida libre. En el
  cliente, `WeekDay.lunchRecipe` / `dinnerRecipe` = `{versionId}`; ausente = sin ficha.
- **Escrituras.** Sin permisos directos sobre las tablas de recetas. `apply_week` (misma firma)
  acepta las claves opcionales de vínculo por día: ausentes → conserva el vínculo; `null` → lo
  quita. El cliente envía el vínculo solo si el día lo trae, `null` solo para comidas libres y
  nada para una comida planificada sin vínculo (nunca borra una ficha de la cuenta por una copia
  antigua). `update_week_slot_recipe` enlaza una sola comida con la versión de semana esperada
  (`applied | duplicate | conflict`, como `update_week_slot`, que no cambia).
  `save_inferred_recipe` guarda una ficha estimada como receta propia (siempre `inferred`,
  dueño `auth.uid()`), reutiliza la receta del mismo título y crea versión nueva solo si cambia el
  contenido (máx. 300 recetas por usuario y 5 versiones por receta; el modelo lo fija la ruta y
  nunca se muestra).
- **Integridad en cualquier camino de escritura** (trigger `week_days_recipe_links`, también para el
  cliente anterior): comida libre → sin ficha; cambia el título (otra `title_key`) sin cambiar el
  vínculo → se quita; el vínculo debe ser del catálogo o del dueño de la semana (23503); un vínculo
  cuyo título no es el del plato se descarta. Así una copia antigua del dispositivo nunca deja una
  ficha pegada a otro plato.
- **Edición de un plato** (`saveWeekSlot`): la ficha se conserva si el título es el mismo (mayúsculas
  y espacios aparte); si el título nuevo es exactamente una receta del catálogo con versión
  revisada, se enlaza (p. ej. «Otra idea»). **Aplicar un menú** (`applyMenuToWeek`) enlaza igual por
  título exacto. Hoy el catálogo no tiene versiones revisadas: no se enlaza nada.
- **Ficha estimada por IA** (`POST /api/dish-card`, un plato, solo con sesión): guard de A3;
  comprueba antes de gastar que la comida sigue siendo ese plato en la versión que conoce el
  cliente (409 si no); si el usuario ya tiene ficha de ese título, la reutiliza sin IA; si no, un
  intento (`beginAiUsage` con el flujo `shopping`, sin reintento), validación del esquema (422 sin
  reparar), `save_inferred_recipe` y `update_week_slot_recipe` con el JWT del usuario. El cliente
  vuelve a leer la semana para tener el vínculo y la versión nueva. Sin generación por lotes.
- **Menús históricos.** La ficha dice «Solo tenemos el título». Si el título coincide con el
  catálogo y hay versión revisada → «Usar receta del catálogo» (sin IA); si es del catálogo sin
  versión revisada → «Ficha pendiente de revisión»; en cualquier caso, con sesión, «Crear ficha
  estimada (IA)». Nada se crea ni se enlaza automáticamente. Invitados: solo catálogo, sin IA.
- **Borrador del catálogo.** `src/data/recipe-cards/catalog-v1.json` (estado `draft_unreviewed`)
  no se carga en la base ni en la app; publicar fichas revisadas requiere una migración nueva.
- **Fuera de alcance** (C3/C4): validar restricciones contra ingredientes, compra desde las fichas,
  escalado de cantidades y firma de compra (sigue basada en títulos).

## Datos anteriores a B1 (sin ámbito)

Al arrancar, las claves `becook-profile`, `becook-pantry-base` y
`becook-week:YYYY-Www` se mueven al ámbito invitado con la marca `legacy-origin`.
`becook-selected-iso-week` pasa a preferencia del invitado. `becook-week` (sin
semana ISO) y `becook-shopping-list-cache` se descartan: no se pueden atribuir a
una semana y la lista se regenera.

Nunca se asignan a una cuenta automáticamente. Con sesión iniciada aparece
«Tienes datos guardados en este dispositivo. ¿Quieres añadirlos a tu cuenta?»:

- Añadir: se sube cada entidad solo si la cuenta no la tiene; nunca se sobrescribe.
  Lo importado sale del ámbito invitado; lo que ya existía se conserva como invitado.
  Lo que falla (sin conexión) se vuelve a ofrecer.
- No: los datos siguen como invitado y no se vuelve a preguntar.

## Pruebas

- `tests/session-isolation.test.cjs`: A → logout → B, cambio A → B, invitado,
  dos dispositivos, conflictos, pendientes, remoto caído, caducidad y migración.
- `scripts/session-db-tests.cjs` (en `test:db`): A → logout → B contra Supabase
  local real (Auth + RLS), solo lectura.
- `tests/week-writes.test.cjs`: mapeo de resultados, versión enviada, clave por
  intento, conflicto, duplicado, edición por comida y pendientes.
- `scripts/week-write-db-tests.cjs` (en `test:db`): fallo a mitad, dos dispositivos en
  paralelo, doble clic, creación simultánea, edición de un plato, petición de
  generación ajena y compatibilidad con el cliente anterior.
- `tests/shopping-week.test.cjs`: firma, lectura remota primero, marcado por artículo,
  segundo dispositivo, mismo menú otra vez, cambio de plato, semana pasada, lista
  sustituida, sin conexión, generación única, semana cambiada al generar, listas y
  cachés antiguas, invitado y orden de marcados.
- `scripts/shopping-db-tests.cjs` (en `test:db`): los mismos recorridos contra Supabase
  local, concurrencia, permisos (otro usuario, anon), validación y despliegue.
- `tests/pantry-items.test.cjs`: despensa vacía y artículos de base, escritura por artículo,
  dos dispositivos, conflicto, borrado en otro dispositivo, sin conexión, respuesta perdida,
  añadir lo que ya existe, filas duplicadas, cambios rápidos, copias anteriores a B7, invitado
  e importación.
- `scripts/pantry-db-tests.cjs` (en `test:db`): el defecto reproducido (fallo de red a mitad),
  dos dispositivos en paralelo (3 rondas), conflicto, respuesta perdida, despensa vacía,
  permisos (otro usuario, anon), validación y despliegue con el cliente anterior.
- `tests/sync-recovery.test.cjs` (B5): menú sin esperar a la compra, compra fallida, cuenta sin
  respuesta y «Reintentar guardado» con la misma clave, invitado, semana no comprobada y «no
  reemplazar», propuesta por identidad y semana, respuesta perdida, pendiente superado en otro
  dispositivo, dos lecturas a la vez, reintento sin conexión, compra pendiente al cerrar sesión y
  estados visibles.
- `tests/recipe-cards.test.cjs`: esquema de fichas, título exacto del catálogo, identidades de la
  migración, borrador del catálogo, vínculos en el modelo de semana, edición y enlace por
  repositorio, vista de la ficha y `/api/dish-card` (409 antes de gastar, reutilización sin IA,
  un intento con cuota `shopping`, 422/502/429).
- `scripts/recipe-cards-db-tests.cjs` (en `test:db`): catálogo para invitados, guardado de fichas
  estimadas, RLS y permisos, inmutabilidad, enlace y edición por la app, comprobaciones de
  propiedad y título, catálogo revisado, despliegue con el cliente anterior y borrado de cuenta.
