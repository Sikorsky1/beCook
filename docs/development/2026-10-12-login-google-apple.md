# Entrar con Google y con Apple en beCook

Preparado el 2026-10-12 a partir del código de `audit-opt` en `~/projects/becook`. Solo es el plan: todavía no se ha cambiado nada.

## La respuesta corta

Se puede hacer con lo que ya tienes (Supabase Auth en plan Free, Vercel, becook.xyz) sin cambiar la base de datos. Lo recomiendo en **dos fases**:

1. **Google primero, ya.** Es gratis, solo necesita una cuenta de Google Cloud y unos 30–45 minutos tuyos de configuración. Los agentes añaden los botones y lo prueban en preview antes de producción.
2. **Apple después, cuando tengas la cuenta de Apple Developer** (99 $/año). Es la misma cuenta que necesitas para la app de iOS, así que conviene hacerlo a la vez. Si la app de iOS ofrece Google, Apple te exigirá también «Iniciar sesión con Apple».

Los usuarios que ya tienen cuenta con email y contraseña **no pierden nada**: si entran con Google usando el mismo email, Supabase une las dos formas de entrar en la misma cuenta y conservan sus menús, compra y perfil. La excepción es Apple con «Ocultar mi email» (más abajo).

## Cómo funciona hoy (lo que he revisado)

- `src/lib/auth/account.ts`: alta e inicio de sesión con email y contraseña (`signUp`, `signInWithPassword`), mensajes de error en español por código.
- `src/app/login`, `src/app/signup`: los formularios. `src/app/auth/callback`: la página a la que vuelve el enlace del email de confirmación; espera a que haya sesión y te lleva a `next` o a `/onboarding`.
- `src/lib/supabase/client.ts`: el cliente de Supabase con la configuración por defecto (lee la sesión de la URL al volver).
- `OnboardingGate` en `/week` ya manda a una cuenta nueva al onboarding, venga de donde venga. Eso sirve tal cual para cuentas creadas con Google o Apple.
- No hay ningún trigger sobre `auth.users`: el perfil se crea en el onboarding. **No hace falta ninguna migración.**
- El borrado de cuenta (`/api/account/delete`) usa `auth.admin.deleteUser`, que también borra las identidades de Google y Apple.
- La política de privacidad solo está como borrador (`docs/legal/privacidad-BORRADOR.md`), no publicada en la web. Google la pide para mostrar «beCook» en su pantalla (ver paso G1).

## Cómo será para el usuario

En `/login` y `/signup`, encima del formulario:

```
[ G  Continuar con Google ]
[   Continuar con Apple ]
──────── o con tu email ────────
Email / Contraseña / …
```

1. Pulsa «Continuar con Google».
2. Va a la pantalla de Google, elige su cuenta y acepta.
3. Vuelve a `www.becook.xyz/auth/callback` con la sesión iniciada. Si la cuenta es nueva, va al onboarding; si ya existía, a la semana (o a la página de la que venía).
4. No hay email de confirmación ni contraseña: Google y Apple ya han verificado el email.

---

# Parte 1 · Lo que haces tú a mano

Hazlo **primero en becook-preview** y, cuando lo hayamos probado, repite los pasos de Supabase en **becook** (producción). En Google y Apple se configura una vez para los dos.

Datos que vas a necesitar:

| | Preview | Producción |
|---|---|---|
| Proyecto Supabase | becook-preview (`qdhpdhnpcsfhmygjofqb`) | becook (`wejvptpkxlllfpskyisu`) |
| URL de retorno («Callback URL») | `https://qdhpdhnpcsfhmygjofqb.supabase.co/auth/v1/callback` | `https://wejvptpkxlllfpskyisu.supabase.co/auth/v1/callback` |

Supabase te muestra esta Callback URL en la pantalla de cada proveedor (paso S2); cópiala de ahí por si acaso.

## Google (fase 1)

### G1 · Antes de empezar: política de privacidad publicada

Google pide una URL de política de privacidad y otra de página principal para la pantalla de consentimiento. Los agentes publican `https://www.becook.xyz/privacidad` y `/condiciones` a partir de los borradores (parte 2, paso A1). Puedes empezar G2–G5 sin ellas y añadirlas después en G3.

### G2 · Crear el proyecto en Google Cloud

1. Entra en **console.cloud.google.com** con la cuenta de Google con la que quieras gestionarlo (mejor una cuenta tuya de beCook que una personal, si la tienes).
2. Arriba, selector de proyecto → **Nuevo proyecto**.
   - Nombre: `beCook`
   - Organización: «Sin organización» (si no tienes Google Workspace).
3. **Crear** y selecciona el proyecto `beCook` arriba.

No hace falta activar facturación ni ninguna API.

### G3 · Pantalla de consentimiento (Google Auth Platform)

Menú ☰ → **APIs y servicios** → **Pantalla de consentimiento de OAuth** (en la consola nueva se llama **Google Auth Platform**). Pulsa **Comenzar** si es la primera vez.

1. **Información de la aplicación**
   - Nombre de la aplicación: `beCook`
   - Correo de asistencia al usuario: tu email.
2. **Público**: **Externo**.
3. **Información de contacto**: tu email.
4. Acepta la política y **Crear**.

Después, en el menú de la izquierda:

5. **Desarrollo de marca (Branding)**
   - Página principal de la aplicación: `https://www.becook.xyz`
   - Política de privacidad: `https://www.becook.xyz/privacidad`
   - Condiciones del servicio: `https://www.becook.xyz/condiciones`
   - **Dominios autorizados**: añade `becook.xyz` y `supabase.co`.
   - Logotipo: **déjalo vacío** de momento. Subir logo obliga a una verificación de marca que puede tardar días; se puede hacer luego (ver «Pantalla de Google» más abajo).
   - Guardar.
6. **Acceso a datos (Data access)** → **Añadir o quitar permisos** → marca solo `openid`, `.../auth/userinfo.email` y `.../auth/userinfo.profile`. Son permisos «no sensibles»: no requieren revisión de Google. Guardar.
7. **Público (Audience)** → Estado de publicación → **Publicar aplicación** → Confirmar. Así cualquier persona puede entrar (en «Prueba» solo entrarían los emails que añadas a mano, hasta 100).

### G4 · Crear el cliente OAuth

Menú izquierdo → **Clientes** (o **Credenciales** → **Crear credenciales** → **ID de cliente de OAuth**).

1. Tipo de aplicación: **Aplicación web**.
2. Nombre: `beCook web (Supabase)`.
3. **Orígenes de JavaScript autorizados**:
   - `https://www.becook.xyz`
   - `https://becook.xyz`
4. **URIs de redireccionamiento autorizados** (las dos):
   - `https://wejvptpkxlllfpskyisu.supabase.co/auth/v1/callback`
   - `https://qdhpdhnpcsfhmygjofqb.supabase.co/auth/v1/callback`
5. **Crear**. Aparece una ventana con el **ID de cliente** (acaba en `.apps.googleusercontent.com`) y el **Secreto de cliente** (empieza por `GOCSPX-`). Descarga el JSON o cópialos. **El secreto no lo pegues en el chat ni en el repo**; solo en Supabase.

Los cambios en Google pueden tardar unos minutos en aplicarse.

### G5 · Supabase: activar Google (primero preview)

En **supabase.com/dashboard** → proyecto **becook-preview**:

1. **Authentication** → **Sign In / Providers** (en algunas versiones, **Providers**) → **Google**.
2. **Enable Sign in with Google**: activado.
3. **Client IDs**: pega el ID de cliente de G4.
4. **Client Secret (for OAuth)**: pega el secreto de G4.
5. **Skip nonce checks**: desactivado. **Allow users without an email**: desactivado.
6. Comprueba que la **Callback URL (for OAuth)** que muestra es la misma que pusiste en G4.
7. **Save**.

### S1 · Supabase: URLs permitidas de vuelta (las dos bases de datos)

**Authentication** → **URL Configuration**. Esto ya debería estar del paso del email, pero compruébalo, porque si falta la URL, Google te devuelve a la página principal sin sesión:

- **becook (producción)**
  - Site URL: `https://www.becook.xyz`
  - Redirect URLs: `https://www.becook.xyz/**` y `https://becook.xyz/**`
- **becook-preview**
  - Redirect URLs: la URL de la Preview de `audit-opt` en Vercel con `/**` al final (p. ej. `https://be-cook-git-audit-opt-sikorsky1991.vercel.app/**`) y `http://localhost:3000/**`.

Si no estás seguro de qué hay, pásame una captura de esa pantalla y lo reviso.

### S2 · Supabase: producción

Cuando los agentes te digan que en preview funciona: repite **G5** en el proyecto **becook** con el mismo ID y secreto. Después se fusiona el PR (ver parte 2) y se activan los botones en producción.

### Pantalla de Google: «para continuar a …supabase.co»

Con este montaje, la pantalla de Google puede decir «Elige una cuenta para continuar a wejvptpkxlllfpskyisu.supabase.co» en lugar de «beCook» hasta que Google verifique la marca. Opciones, de menos a más:

1. **Verificación de marca (gratis)**: en Google Auth Platform → **Verification Center**, cuando la política de privacidad esté publicada y `becook.xyz` verificado en **Google Search Console** (un registro TXT en Namecheap). Tras aprobarla, Google muestra «beCook» y el logo. Recomendado en cuanto se publique la política.
2. **Dominio propio para Supabase** (`auth.becook.xyz`): es un complemento de pago que requiere el plan Pro (25 $/mes + el complemento). No lo recomiendo ahora.

## Apple (fase 2, cuando tengas Apple Developer)

Requiere estar dado de alta en el **Apple Developer Program** (developer.apple.com, 99 $/año), igual que para la app de iOS.

### A-1 · Identificador de la app (App ID)

developer.apple.com → **Account** → **Certificates, Identifiers & Profiles** → **Identifiers** → botón **+**.

1. Tipo: **App IDs** → Continue → **App** → Continue.
2. Description: `beCook`
3. Bundle ID: **Explicit**, `xyz.becook.app` (es el que usará luego la app de iOS; decídelo ahora porque no se puede cambiar).
4. En **Capabilities**, marca **Sign in with Apple** (deja «Enable as a primary App ID»).
5. Continue → **Register**.

### A-2 · Identificador de servicio para la web (Services ID)

**Identifiers** → **+** → **Services IDs** → Continue.

1. Description: `beCook web`
2. Identifier: `xyz.becook.web` (este será el «Client ID» de Apple en Supabase).
3. **Register**. Vuelve a abrirlo en la lista, marca **Sign in with Apple** → **Configure**:
   - Primary App ID: `xyz.becook.app`
   - **Domains and Subdomains**: `wejvptpkxlllfpskyisu.supabase.co` y `qdhpdhnpcsfhmygjofqb.supabase.co`
   - **Return URLs**: `https://wejvptpkxlllfpskyisu.supabase.co/auth/v1/callback` y `https://qdhpdhnpcsfhmygjofqb.supabase.co/auth/v1/callback`
   - Next → Done → Continue → **Save**.

### A-3 · Clave privada

**Keys** → **+**.

1. Key Name: `beCook Sign in with Apple`
2. Marca **Sign in with Apple** → **Configure** → Primary App ID `xyz.becook.app` → Save.
3. Continue → **Register** → **Download**. Es un fichero `AuthKey_XXXXXXXXXX.p8`. **Solo se puede descargar una vez**: guárdalo en el llavero o en tu gestor de contraseñas, nunca en el repo.
4. Apunta el **Key ID** (10 caracteres) y tu **Team ID** (arriba a la derecha en la web de Apple Developer, 10 caracteres).

### A-4 · Generar el «secreto» de Apple (caduca cada 6 meses)

Apple no da un secreto fijo: hay que firmar uno con la clave `.p8`, y **caduca como mucho a los 6 meses**. La documentación de Supabase («Login with Apple») tiene una herramienta para generarlo en el navegador con Team ID, Key ID, Services ID (`xyz.becook.web`) y el contenido del `.p8`. Si lo prefieres, los agentes te dejan un script en `scripts/` que lo genera en tu Mac sin que la clave salga de él.

Pon un **recordatorio en el calendario a los 5 meses** para generar otro y pegarlo en Supabase (preview y producción). Si caduca, nadie podrá entrar con Apple en la web hasta renovarlo.

### A-5 · Supabase: activar Apple (primero preview, luego producción)

**Authentication** → **Sign In / Providers** → **Apple**:

1. **Enable Sign in with Apple**: activado.
2. **Client IDs**: `xyz.becook.web` (cuando exista la app de iOS se añade también `xyz.becook.app`, separado por coma).
3. **Secret Key (for OAuth)**: el secreto de A-4.
4. **Save**.

### A-6 · Emails a usuarios que ocultan su email

Si alguien elige «Ocultar mi email», Apple le da una dirección del tipo `abc123@privaterelay.appleid.com`. Para que le lleguen los emails de beCook (cambiar contraseña, avisos), Apple tiene que conocer tu remitente:

**Certificates, Identifiers & Profiles** → **Services** → **Sign in with Apple for Email Communication** → **Configure** → **+**:

- Domain: `becook.xyz` (y `send.becook.xyz`, el subdominio que usa Resend para enviar).
- Email Address: `no-reply@becook.xyz`.

Apple comprueba el SPF del dominio (ya lo configuraste para Resend). Si sale en rojo, pásame una captura.

---

# Parte 2 · Lo que hacen los agentes en código

Una sola ola en `audit-opt`, sin migraciones. Los botones salen solo en los entornos donde el proveedor está activado, así se puede fusionar Google sin esperar a Apple.

**A1 · Páginas legales públicas.** `/privacidad` y `/condiciones` a partir de los borradores de `docs/legal/`, añadiendo que puedes entrar con Google o Apple y qué datos recibimos de ellos (email y nombre; nada más). Tú revisas el texto antes de producción.

**A2 · Función de entrada con proveedor.** En `src/lib/auth/account.ts`, `signInWithProvider(client, "google" | "apple", { redirectTo })` con `signInWithOAuth`, `redirectTo` = `authRedirectUrl(origin, "/auth/callback", next)`. Nuevos mensajes en español: proveedor desactivado, el usuario canceló («Has cancelado el inicio de sesión con Google»), error del proveedor, sin conexión. Pruebas unitarias en `tests/account-flows.test.cjs`.

**A3 · Botones.** Componente compartido `OAuthButtons` en `src/components/session/`, usado en `/login` y `/signup` encima del formulario, con el separador «o con tu email». Siguiendo las normas de marca de Google (logo «G» oficial, «Continuar con Google») y de Apple (botón negro o blanco con el logo de Apple, «Continuar con Apple», mismo tamaño que el de Google). Validado por un revisor como los demás componentes compartidos.

**A4 · Interruptor por entorno.** Variable `NEXT_PUBLIC_AUTH_PROVIDERS` en Vercel (`google` en Preview primero; `google` en Production tras S2; `google,apple` cuando esté Apple). Sin variable, no hay botones: la web queda como hoy.

**A5 · Vuelta (`/auth/callback`).** La misma página sirve para Google y Apple. Cambios: textos neutros («Entrando…» en vez de «Cuenta activada»), destino `next` o `/week` (la cuenta nueva la manda `OnboardingGate` al onboarding), y si vuelve con error (cancelado, cuenta duplicada) muestra el mensaje y un botón para volver a `/login`, sin el formulario de «Enviar otro enlace», que no aplica.

**A6 · Perfil → «Tus datos».** Mostrar con qué entras («Google», «Apple», «Email y contraseña», según `user.identities`). Para quien solo entra con Google o Apple, «Cambiar contraseña» pasa a «Crear una contraseña» (opcional, por si un día quiere entrar con email).

**A7 · Pruebas.** Unitarias (A2) y E2E: los botones se ven solo con la variable, al pulsarlos el navegador va a `…supabase.co/auth/v1/authorize?provider=google` con el `redirect_to` correcto (interceptado, sin ir a Google de verdad), y `/auth/callback` con error muestra el mensaje. El paso real por Google lo hacemos a mano en la Preview con tu cuenta.

**A8 · Comprobaciones en preview antes de producción** (las hago yo con cuentas de prueba y tú con tu Google):
- Cuenta nueva con Google → onboarding → semana.
- Cuenta existente de email + contraseña → «Continuar con Google» con el mismo email → entra en **la misma cuenta** con sus datos (se comprueba en `auth.identities` que el usuario tiene dos identidades y el mismo id).
- Cuenta de email **sin confirmar** + Google con ese email (ver más abajo).
- Cancelar en la pantalla de Google → mensaje en español en `/auth/callback`.
- Borrar cuenta desde «Tus datos» → desaparecen usuario e identidades.
- Datos guardados en el dispositivo sin sesión → se conservan al entrar con Google, igual que con email.

**A9 · Producción.** Igual que las olas: backup no hace falta (no hay migración), PR `audit-opt` → `main` con CI verde, tú haces S2 y cambias la variable en Vercel Production, y probamos en www.becook.xyz.

---

# Qué pasa con los usuarios que ya están registrados

| Caso | Qué pasa |
|---|---|
| Tiene cuenta con email y contraseña (confirmada) y entra con Google con el **mismo email** | Supabase une Google a su cuenta automáticamente (los dos emails están verificados). Mismo usuario, mismos datos. Puede seguir entrando también con su contraseña. |
| Igual, pero entra con **Apple compartiendo su email real** | Igual que Google: se une a su cuenta. |
| Entra con **Apple ocultando el email** (`…@privaterelay.appleid.com`) | Supabase no puede saber que es la misma persona: se crea **otra cuenta vacía**. Es el único caso de cuenta duplicada. Para evitarlo, el texto bajo el botón de Apple en `/login` dirá «¿Ya tienes cuenta con email? Entra con tu email». Más adelante se puede añadir «Conectar con Apple» en el Perfil (vinculación manual, que hay que activar en Supabase: Authentication → **Sign In / Providers** → **Allow manual linking**). |
| Se registró con email y **nunca confirmó** el enlace, y luego entra con Google con ese email | Supabase da prioridad a la identidad verificada (Google) para evitar que alguien se apropie de cuentas no confirmadas. Lo comprobamos en preview (A8) antes de producción para saber exactamente qué ve el usuario. |
| Entró con Google y luego intenta **registrarse con email y contraseña** con el mismo email | Ve el mensaje que ya existe («Ya hay una cuenta con ese email. Inicia sesión o recupera tu contraseña»). Si usa «He olvidado mi contraseña», puede crear una y entrar de las dos formas. |
| **Borra su cuenta** | Se borran la cuenta y sus identidades de Google/Apple, igual que hoy. |

No hay que tocar ni migrar ningún dato de los usuarios actuales.

---

# La app de iOS (cuando se haga con Capacitor)

- **Apple lo exige**: si la app ofrece Google, debe ofrecer otra opción equivalente que respete la privacidad (norma 4.8 de la App Store). En la práctica, «Iniciar sesión con Apple». Por eso Apple va en el mismo bloque que la app.
- **Google no deja iniciar sesión dentro de una vista web** (error `disallowed_useragent`). Como la app carga becook.xyz dentro de Capacitor, en la app los botones no pueden usar el mismo camino que la web. La web detecta que está dentro de la app y usa:
  - **Apple**: la hoja nativa de iOS (plugin de Sign in with Apple para Capacitor) y luego `supabase.auth.signInWithIdToken({ provider: "apple", token, nonce })`. Es lo que espera el revisor de Apple. En Supabase se añade `xyz.becook.app` a los Client IDs de Apple (A-5).
  - **Google**: el inicio de sesión nativo de Google para iOS (plugin de Capacitor) y `signInWithIdToken({ provider: "google", … })`. Requiere un segundo cliente OAuth en Google Cloud de tipo **iOS** con el Bundle ID `xyz.becook.app`, cuyo ID se añade (separado por coma) en Supabase → Google → Client IDs.
  - Alternativa más sencilla para Google: abrir el inicio de sesión en el navegador del sistema (`@capacitor/browser`) y volver a la app con un Universal Link (`https://www.becook.xyz/auth/callback`), que ya hay que montar para los emails (ola iOS-2).
- **Borrar cuenta con Apple**: Apple pide que, al borrar la cuenta de alguien que entró con Apple, se revoque también su acceso en Apple (llamada a `appleid.apple.com/auth/revoke`). Se añade a `/api/account/delete` en la ola iOS-3.
- Encaja en las olas de `guias/becook-ios-app-store.md`: los botones nativos en iOS-2, la revocación y la cuenta de prueba para Apple en iOS-3.

---

# Orden recomendado

1. **Agentes**: A1–A7 en `audit-opt` (con Google; Apple preparado pero oculto).
2. **Tú**: G2–G5 y S1 en preview (≈ 30–45 min).
3. **Juntos**: pruebas A8 en la Preview.
4. **Tú**: revisar textos legales; S2 en producción; variable en Vercel Production.
5. **Agentes**: PR a `main`, CI verde, fusión, prueba en www.becook.xyz.
6. **Tú, cuando quieras**: verificación de marca en Google (cambia «…supabase.co» por «beCook»).
7. **Con la cuenta de Apple Developer**: A-1 a A-6, activar Apple en preview → producción, y luego la app de iOS.

## Coste

- Google: 0 €.
- Apple: 99 $/año (el mismo pago que la app de iOS).
- Supabase: sigue en Free; Google y Apple están incluidos. Cada usuario que entra cuenta para el límite de 50 000 usuarios activos al mes del plan gratuito, igual que hoy.

## Cómo medir si mejora el registro

Antes de activar Google, apuntamos cuántas cuentas nuevas se crean por semana y cuántas se quedan sin confirmar el email. Después, una consulta sobre `auth.identities` cuenta las altas por proveedor (email, Google, Apple), y lo comparamos a las 2–4 semanas.
