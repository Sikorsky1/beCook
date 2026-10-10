# beCook: identidad, datos locales y sincronización (B1, B4, B5, B6, B7)

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
