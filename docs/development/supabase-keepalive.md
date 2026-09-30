# Supabase keepalive

`.github/workflows/supabase-keepalive.yml` genera actividad ligera a las **06:17,
14:17 y 22:17 UTC**. GitHub puede retrasar u omitir ejecuciones programadas; el
objetivo es actividad periódica, no una garantía de que Supabase nunca pause un
proyecto. El schedule se activa cuando el archivo llega a la rama por defecto.

| Job | Proyecto | Usuario Auth exclusivo |
| --- | --- | --- |
| `keepalive-production` | `wejvptpkxlllfpskyisu` | `keepalive-production@example.invalid` |
| `keepalive-preview` | `qdhpdhnpcsfhmygjofqb` | `keepalive-preview@example.invalid` |

Cada job independiente inicia sesión con email/contraseña y hace exactamente un
`GET /rest/v1/weeks?select=id&limit=1`, con `apikey` pública y JWT del usuario.
Exige HTTP 200, JSON válido y `[]`: estos usuarios no tienen datos de aplicación.
No hay reintentos automáticos ni redirecciones. Se comprueban dos veces el destino
y los claims de identidad/rol de la respuesta Auth; PostgREST verifica el JWT.

La única operación sobre negocio es SELECT. No se crean perfiles, semanas,
despensas, listas ni tablas auxiliares; no hay migraciones, RPC ni cambios de
timestamps. Auth sí registra usuarios, sesiones y actividad de autenticación.
Los usuarios tienen el rol `authenticated`, sujeto a las políticas RLS existentes;
no son roles SQL de solo lectura ni reciben privilegios adicionales. El workflow
solo implementa lectura, aunque las políticas existentes permitan otras acciones
sobre datos propios. No utiliza service role ni secret keys administrativas.

## Configuración

En GitHub → **Settings → Secrets and variables → Actions → Variables**, crear
estas Repository Variables:

| Nombre | Valor |
| --- | --- |
| `SUPABASE_PROD_URL` | `https://wejvptpkxlllfpskyisu.supabase.co` |
| `SUPABASE_PROD_PUBLISHABLE_KEY` | Publishable key de producción (`sb_publishable_…`) |
| `SUPABASE_PROD_KEEPALIVE_EMAIL` | `keepalive-production@example.invalid` |
| `SUPABASE_PREVIEW_URL` | `https://qdhpdhnpcsfhmygjofqb.supabase.co` |
| `SUPABASE_PREVIEW_PUBLISHABLE_KEY` | Publishable key de preview (`sb_publishable_…`) |
| `SUPABASE_PREVIEW_KEEPALIVE_EMAIL` | `keepalive-preview@example.invalid` |

En **Secrets → New repository secret**, configurar únicamente las contraseñas:

- `SUPABASE_PROD_KEEPALIVE_PASSWORD`
- `SUPABASE_PREVIEW_KEEPALIVE_PASSWORD`

Usar contraseñas aleatorias distintas de al menos 32 caracteres, generadas con un
gestor de contraseñas o CSPRNG. No introducirlas como argumentos de terminal,
commits, documentación, logs ni mensajes. No configurar claves administrativas
en GitHub para este mecanismo.

Alta manual si no se dispone de acceso administrativo seguro:

1. Abrir Supabase Dashboard y comprobar el Project ID, primero preview y después
   producción. En **Authentication → Users → Add user → Create new user**, usar
   el email técnico de la tabla y una contraseña distinta para cada proyecto.
2. Activar **Auto Confirm User**: los emails sintéticos no reciben correo. Usar
   creación directa, no invitación ni el formulario de registro de beCook.
3. No crear datos de aplicación. Antes del alta, revisar que no existan triggers
   personalizados de Auth que creen datos de negocio ni Auth Hooks con escrituras.
4. Copiar la **publishable key** de **Project Settings → API Keys** a la Variable
   del proyecto correspondiente. No copiar una `service_role` ni `sb_secret_…`.
5. Guardar la contraseña directamente en el Secret correspondiente de GitHub.

## Ejecutar y revisar

Después del merge: **Actions → Supabase keepalive → Run workflow → Branch: main**.
Elegir `preview`, comprobar éxito, repetir con `production`; `both` ejecuta los dos
jobs independientes. El schedule siempre ejecuta ambos.

```sh
gh workflow run supabase-keepalive.yml --ref main -f target=preview
gh run list --workflow supabase-keepalive.yml --limit 10
gh run view RUN_ID --log
gh workflow run supabase-keepalive.yml --ref main -f target=production
```

Un job correcto muestra `Auth: HTTP 200`, `SELECT weeks: HTTP 200` y `Keepalive OK`.
No se muestran filas, cabeceras, JWT, refresh token ni contraseña. Los errores
solo muestran un código HTTP o un mensaje genérico. No activar trazas que vuelquen
respuestas o credenciales. Revisar los dos jobs: el fallo de uno no impide el otro.

GitHub exige que un workflow exista en la rama por defecto para usar
`workflow_dispatch`. Para validar su primera publicación antes de la PR, se puede
autorizar un trigger `push` temporal limitado a la rama aislada, ejecutando primero
preview y después producción. Retirarlo antes de abrir la PR. El archivo final
solo debe contener `schedule` y `workflow_dispatch`.

## Rotar y desactivar

Para rotar: desactivar temporalmente el workflow en **Actions → Supabase keepalive
→ ⋯ → Disable workflow**. Generar dos contraseñas nuevas distintas, de al menos
32 caracteres. Actualizarlas mediante la API administrativa de Auth
(`auth.admin.updateUserById`), fuera del workflow. Si se usa exclusivamente el
Dashboard y se ha verificado que las cuentas técnicas siguen sin datos, se pueden
eliminar y recrear con el mismo correo y **Auto Confirm User**. Cambiarán sus UUID,
pero el workflow inicia sesión por correo. No usar recuperación por correo con
`example.invalid`, ni editar `auth.users` directamente mediante SQL.

En GitHub → **Settings → Secrets and variables → Actions → Secrets**, editar con
el lápiz cada `SUPABASE_*_KEEPALIVE_PASSWORD` y pulsar **Update secret**. Revocar las
sesiones anteriores si se conservaron las cuentas y volver a habilitar el workflow.
Probar primero preview y después producción.
Los access tokens ya emitidos pueden seguir válidos hasta su expiración.
Si se rota una publishable key, actualizar la Variable del mismo proyecto.

Para detener el keepalive basta con **Disable workflow**, o con eliminar este
workflow mediante PR. No requiere cambiar Vercel ni las variables de la aplicación.
Para una retirada definitiva, revocar sesiones y retirar las identidades técnicas
y sus secrets una vez desactivado, respetando la expiración de access tokens.

## Alcance de publicación

El cambio parte exclusivamente de `origin/main`, sin merge, rebase ni cherry-pick
de `audit-opt`. El workflow no descarga el repositorio, ejecuta CI, invoca OpenAI
ni despliega Vercel. La integración Git de Vercel puede desplegar al publicar una
rama o mergear; no se modifica código funcional ni configuración de Vercel.

Como única excepción de seguridad autorizada, se retira del árbol versionado
`vercel/recovery-codes.txt`, preexistente en `main` y bloqueado por el detector.
Esto no elimina versiones anteriores del historial ni revoca los códigos.

Validación inicial del 30-09-2026, con trigger temporal `push` autorizado:

- [Preview, intento 2](https://github.com/Sikorsky1/beCook/actions/runs/36758703544/attempts/2):
  login HTTP 200 y SELECT HTTP 200, resultado `[]`.
- [Producción](https://github.com/Sikorsky1/beCook/actions/runs/36761162575):
  ejecutada después de Preview, login HTTP 200 y SELECT HTTP 200, resultado `[]`.
- Las siete tablas de negocio de cada proyecto conservaron sus recuentos y huellas
  de contenido antes y después del alta y de los pings. Ninguna escritura de negocio.
- RLS activo y SELECT de `weeks` limitado por `auth.uid() = user_id`; rol
  `authenticated` sin bypass RLS ni superusuario. Usuarios técnicos sin datos.
- Gitleaks 8.30.1 sin hallazgos en el índice final y en los logs; actionlint 1.7.12
  sin errores. Trece comprobaciones locales del script pasaron sin red.

El script y las variables de ambos jobs son los validados. En la versión final
solo se retiran el trigger temporal y sus condiciones; no se modifica el ping.
Los intentos iniciales fallaron por contraseña corta antes de enviar peticiones;
se recrearon las cuentas y actualizaron los Secrets antes de las pruebas correctas.

Después de confirmar el merge, incorporar únicamente el commit final del
keepalive a `audit-opt` mediante cherry-pick suele ser la opción de menor alcance
(revisar primero su diff y si alguno de sus cambios ya existe). No hacer merge ni
rebase automático de todo `main`; conservar el historial del roadmap.

Referencias: [ejecución manual en GitHub](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow),
[API keys de Supabase](https://supabase.com/docs/guides/getting-started/api-keys).
