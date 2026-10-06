# beCook: identidad, datos locales y sincronización (B1)

Pasos 06 y 07 del roadmap (H3, H7). Sin cambios de base de datos.

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
`{ v: 1, data, savedAt, remoteVersion, pending }`. `remoteVersion` es el
`updated_at` remoto sobre el que se basa la copia; `pending` indica un cambio
local no aceptado aún por el servidor (nunca en invitado).

El borrador de «Crear menú» sigue en `sessionStorage` sin ámbito, a propósito:
sirve para pasar de invitado a sesión iniciada.

## Fuente de verdad y conflictos

Invitado: solo datos locales, sin llamadas remotas ni textos de sincronización.

Usuario autenticado (`src/lib/data/sync.ts`, `src/lib/data/repositories.ts`):

1. Se muestra la caché del propio ámbito, si existe, y se revalida siempre contra
   Supabase filtrando por `user_id`.
2. Nada se declara vacío hasta que el remoto lo confirma. Si el remoto no responde,
   se mantiene la caché con el aviso «No se ha podido comprobar tu cuenta».
3. Al guardar: la copia local se marca `pending` y se compara la versión remota con
   `remoteVersion`.
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
7. Excepción explícita: al aplicar un menú, el usuario ya ha confirmado «reemplazar
   la semana», y ese guardado sobrescribe sin comprobar versión (`overwrite`).

La comparación usa siempre versiones del servidor (`updated_at`), nunca el reloj
del dispositivo. Versión por entidad: `profiles.updated_at`, `weeks.updated_at`
(el trigger la actualiza también al reemplazar los días) y, para la despensa, el
`updated_at` más reciente de sus artículos.

Compra: caché de la semana → lista remota de esa semana (si no es anterior al último
cambio de la semana) → solo entonces IA. La lista se guarda siempre ligada a la
semana explícita: desapareció el «última semana» por defecto. La actualización por
artículo y el resto de H7 son de B6.

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
