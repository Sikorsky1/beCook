# Paso 37 (E3) — Operación, privacidad y recuperación ante fallos 🟡 (2026-10-12, rama local)

Rama `audit/p37-operacion` desde `audit-opt` (59a3309), worktree `becook-p37-operacion`. Sin push ni
merge. Resumen para integrar en `PROGRESS.md` (este fichero no lo modifica). Plan: ola 8, sección P37.

## Qué se ha hecho

| Elemento | Detalle |
|---|---|
| Migración `20261015090000_ai_usage_keep_on_account_delete` | `ai_usage_events.user_id` admite NULL y su FK a `auth.users` pasa de `ON DELETE CASCADE` a `ON DELETE SET NULL` (mismo nombre; `NOT VALID` + `VALIDATE` en la misma transacción; `lock_timeout` 5 s). Sin cambios de filas, funciones, políticas ni permisos. Expectativas con `replaces` de la columna y la constraint |
| Alertas (`src/lib/server/ops-alert.ts`) | `sendOpsAlert(evento, campos)`: POST a `OPS_ALERT_WEBHOOK_URL` con 3 s de límite, nunca lanza, no hace nada sin la variable. Resend (`https://api.resend.com/emails` + `OPS_ALERT_WEBHOOK_TOKEN`, `OPS_ALERT_EMAIL_TO`, `OPS_ALERT_EMAIL_FROM`) o webhook JSON genérico (`text`/`content` para Slack o Discord). Lista blanca de campos (flujo, umbral, gasto, requestId, ruta sin consulta ni identificadores, método, tipo, digest, estado) más `VERCEL_ENV` y commit. Una alerta por evento y ruta (o flujo / umbral) por minuto e instancia |
| Eventos | `ai_budget_threshold` (50/80 %), `ai_budget_exhausted`, `ai_usage_finish_failed`, `ai_ledger_unavailable` (nuevo: ledger caído o sin configurar) en `ai-usage.ts`; `server_error` desde `src/instrumentation.ts` (`onRequestError` de Next 16: ruta, método, `routeType`, digest; nunca el mensaje ni cabeceras); `account_delete_failed` |
| Exportación `GET /api/account/export` | Sesión verificada con Auth. Todas las tablas del usuario con **su propio JWT** (RLS) y filtro explícito de propietario donde existe, paginadas de 1.000 en 1.000 (tope 50 páginas por tabla → 503). `recipe_versions` solo de sus recetas (sin catálogo). `ai_usage_events` con la clave de servicio, filtrado por el id verificado y **sin `ip_hash`**. Cuenta: id, email, alta, último acceso, confirmación. JSON `becook-datos-AAAA-MM-DD.json`, `attachment`, `no-store`. Todo o nada: si falla una tabla, 503 |
| Borrado `POST /api/account/delete` | Token → JSON y tamaño (1 KB) **antes** de Auth → sesión → `{confirmation: "ELIMINAR"}` exacto (si no, 400 `confirmation_required`) → `auth.admin.deleteUser(id)` con la clave de servicio. La BD borra en cascada todas las tablas; el ledger queda con `user_id NULL`. Fallo → 503 + alerta sin id, email ni mensaje del proveedor. Inmediato y definitivo (decisión 5) |
| Pantalla «Tus datos» (`/profile/data`) | Descargar (JSON) y eliminar con «ELIMINAR» escrito (botón desactivado hasta entonces). Controles de 44 px, campo de 16 px (`TextInput`), textos ≥ 12 px, región `role="status"` persistente y errores `role="alert"` con foco. Invitado: explicación + iniciar sesión. Tras borrar: `signOut({ localOnly: true })` (nuevo parámetro en `identity.ts`: sin llamada al servidor ni aviso de sesión caducada), se borran la caché `becook:u_<id>:*` y los borradores `becook*` de `sessionStorage` (los datos de invitado se conservan) y vuelta a `/week` con el aviso «Tu cuenta se ha eliminado.» (`AccountDeletedNotice`, una vez, montado en `SessionNotices`) |
| Perfil | Una línea: enlace «Tus datos: descargar o eliminar la cuenta» en la tarjeta Cuenta |
| Copias y simulacro | `scripts/ops/backup-production.sh` (copia saneada de `~/Backups/becook/backup-produccion.sh`: llavero o lectura sin eco, nunca impresa, errores de la CLI con la contraseña tapada, `env -i`, `umask 077`, fuera del repo, sin sobrescribir, `data.sql` con `--use-copy`, `counts.txt`, `SHA256SUMS`). `scripts/ops/count-dump-rows.cjs`. `scripts/ops/restore-drill.sh` (+ `.cjs`) |
| Uptime | `.github/workflows/uptime.yml` cada 4 h: `/login` 200 y `POST /api/generate-menu` sin sesión 401, sin secretos (activo cuando llegue a `main`). `checks.yml` sin tocar |
| Docs | `docs/operations/runbook.md` (interruptor de IA, Instant Rollback y re-promoción, corrección hacia delante, reversión de migraciones, restauración como último recurso, rotación de claves), `docs/operations/environment.md` (variables por entorno, sin valores), `docs/operations/incident-response.md` (señales, gravedad, contención, brecha RGPD en borrador) |
| Legal (borradores) | `docs/legal/privacidad-BORRADOR.md` y `docs/legal/condiciones-BORRADOR.md`, cabecera «Borrador, no publicar». Alergias/dietas y datos corporales como posibles datos de salud (art. 9), envío a OpenAI, encargados (Supabase eu-west-1, Vercel, OpenAI, Resend), plazos con copias de seguridad. Sin páginas públicas |

## Comprobaciones

| Comprobación | Resultado |
|---|---|
| `npm run lint` | Sin avisos |
| `npm run typecheck` | OK |
| `npm test` (con `GITLEAKS_BIN`) | **484/484** (440 + 44): `ops-alerts` 12, `ops-logging` 10, `account-data` 12, `ops-scripts` 5, `ai-routes` +5 (rutas de cuenta en la batería de guardas) |
| `next build` | OK en una copia sin `.env*` (variables sintéticas): 24 páginas; `/api/account/*` dinámicas, `/profile/data` estática |
| `npm run test:db` | **446/446** (432 + 14 de `scripts/account-data-db-tests.cjs`). Ver «Docker compartido» |
| Simulacro de restauración | `bash scripts/ops/restore-drill.sh --from-local` (datos sintéticos locales): 45 tablas comparadas, 19 con filas, **0 diferencias**; esquema restaurado 12 tablas, 36 políticas, 37 funciones, todas con RLS, **idéntico** al de origen; 0 filas de usuario sin su usuario de Auth; restauración en ~1 s. La BD local compartida no se tocó |

`scripts/account-data-db-tests.cjs` (14): usuario temporal con filas en las 11 tablas (por las RPC de
la app) y dos peticiones de IA (una abierta); exportación con todas sus tablas, el ledger sin
`ip_hash` y ningún id de B; 401 sin sesión y 400 con «eliminar»; con «ELIMINAR», 0 filas suyas (y
de `auth.identities`, `week_days`, listas y su ficha en uso), ledger 2/2 con `user_id NULL`; sesión y
contraseña antiguas ya no sirven; la petición abierta se cierra después del borrado; las filas sin
dueño cuentan para el presupuesto global y el límite por IP y para la cuota de nadie; `ai_begin_request`
sigue exigiendo usuario; FK `SET NULL` validada; B intacto.

## Decisiones

1. **Simulacro sin `db:reset`**: el plan proponía `db:reset` + carga + `db:reset` + `db:seed`. Como el
   Docker es compartido, el simulacro restaura en una base desechable (`becook_restore_drill`) del
   mismo contenedor verificado: plataforma (estructura de `auth`, `storage`, … copiada del stack
   local, como la tendría un proyecto nuevo) → `schema.sql` → `data.sql` con
   `session_replication_role = replica` → comparación → `DROP DATABASE`. Además prueba el
   `schema.sql` de la copia (no las migraciones) y compara esquema, RLS y propietarios.
2. **`--data-only` incluye `auth.users`**, identidades, sesiones, refresh tokens y el log de
   auditoría de Auth (la CLI solo excluye `auth.schema_migrations`): la copia es tan sensible como la BD
   y restaurarla devuelve las sesiones de ese momento.
3. `data.sql` pasa a hacerse con `--use-copy` para contar filas (`counts.txt`). Las copias antiguas
   (INSERT de varias filas) no se pueden contar: el simulacro con datos reales necesita una copia nueva.
4. Los datos se cargan en el simulacro como administrador de la plataforma: `postgres` no puede
   escribir en tablas internas vacías (`storage.buckets_vectors`). Para una restauración alojada el
   runbook indica excluirlas. El simulacro acepta solo la diferencia de paréntesis ya conocida en
   `weeks_iso_week_range_chk` (la misma que `verify-preview-metadata.cjs`).
5. Alertas también para `ai_ledger_unavailable` y `account_delete_failed` (no estaban en el plan;
   son las dos caídas que un usuario nota sin que nadie se entere).
6. Las alertas se esperan (máx. 3 s, solo cuando hay alerta y como mucho una por minuto) en vez de
   `after()`, que falla fuera del contexto de petición (tests y llamadas directas).
7. El borrado comprueba token, JSON y tamaño antes de Auth (mismo orden que las rutas de IA).
8. La exportación incluye los datos de la cuenta, no los del dispositivo de invitado.
9. Ledger y privacidad: tras borrar la cuenta las filas conservan `ip_hash` (HMAC). No se anonimiza en
   esta iteración; queda como decisión de retención en el borrador legal.
10. `scripts/ai-usage-db-tests.cjs` y `scripts/onboarding-db-tests.cjs` ya no asumen un ledger o un
    onboarding vacíos: con la migración, las cuentas que borra el e2e de P35 dejan filas sin dueño
    en el Docker compartido (esperado). Los escenarios SQL del ledger vacían la tabla dentro de su
    transacción revertida. `test-local-db.cjs` cuenta cada nombre de constraint una vez (la FK se
    recrea con el mismo nombre).
11. Ficheros `.cjs` de `scripts/ops/` con `eslint-disable` de `no-require-imports` en cabecera, para
    no tocar `eslint.config.mjs` (es de P35 en esta ola).

### Consentimiento explícito para alergias y dietas (decisión 10, solo documentado)

Propuesta, no implementada: en el onboarding y en Perfil, antes de guardar las secciones de
restricciones y alergias (y los datos corporales), una casilla separada y no premarcada («Acepto que
beCook use mis alergias, intolerancias y dietas para proponer menús y que se envíen a OpenAI para
ello»), con enlace a la política. Guardar `health_consent_at` y `health_consent_version` en
`profiles` (migración aditiva) y no enviar esas secciones a la IA sin consentimiento vigente
(`current_food_context()` devolvería restricciones vacías y el menú avisaría). Retirar = desmarcar →
se borran alergias/dietas guardadas o se dejan de usar (decidir). Requiere el texto legal definitivo.

## Migración en remoto (cuando Sergio lo autorice)

Orden: becook-preview → validar Preview → producción con OK explícito, **antes** del merge a `main`
(sin la migración, el código nuevo borra cuentas igual pero el ledger pierde sus filas y el
presupuesto global olvida ese gasto).

1. Verificar el ref contra `AGENTS.md` (preview `qdhpdhnpcsfhmygjofqb`; producción `wejvptpkxlllfpskyisu`).
2. Precondiciones (solo lectura):
   - `SELECT count(*), count(*) FILTER (WHERE user_id IS NULL) FROM public.ai_usage_events;` (anotar; la segunda = 0).
   - `SELECT confdeltype, convalidated FROM pg_constraint WHERE conname = 'ai_usage_events_user_id_fkey';` → `c`, `true`.
   - `SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_usage_events' AND column_name='user_id';` → `NO`.
3. Conector de Supabase, `apply_migration` con nombre `ai_usage_keep_on_account_delete`: el fichero
   quitando **solo** `BEGIN;` y `COMMIT;` (los dos `SET LOCAL` se mantienen). Es DDL sin `DELETE`: el
   conector no se queda esperando. Bloqueo: `ACCESS EXCLUSIVE` breve sobre `ai_usage_events` y
   `SHARE ROW EXCLUSIVE` sobre `auth.users` al crear la FK (altas y cambios de usuarios esperan
   milisegundos; `lock_timeout` 5 s aborta sin cambios si hay contención).
4. Verificar: `is_nullable` = `YES`; `confdeltype` = `n` y `convalidated` = `true`; los recuentos del
   paso 2 iguales; `SELECT has_table_privilege('authenticated','public.ai_usage_events','SELECT');` = `false`.
5. Registrar en `supabase/hosted/applied-preview.json` (producción: `applied-production.json`) con la
   versión del ledger, `source` y `sha256` = `8341307b089f11c833b6178060f2d7d2b19d53a9c3bc31e44d71fcd8eacc5d3b`.
6. Producción: avisar a Sergio; copia completa con `bash scripts/ops/backup-production.sh 2026-10-xx-ola8`
   y comprobarla (`shasum -a 256 -c SHA256SUMS`, `counts.txt`). La migración no modifica filas: la
   copia interna `backup_AAAAMMDD` no es necesaria; si se exige,
   `CREATE TABLE public.backup_AAAAMMDD_ai_usage_events AS TABLE public.ai_usage_events;` (y borrarla
   después; el event trigger le activa RLS).
7. Variables: ninguna nueva obligatoria (`SUPABASE_SERVICE_ROLE_KEY` ya está en Production y en
   Preview `audit-opt`). `OPS_ALERT_*` opcionales (abajo).
8. Reversión (solo si no hay filas sin dueño; si las hay, decidir antes qué hacer con ellas — borrarlas
   pierde gasto del mes y el `DELETE` lo ejecuta Sergio en el SQL Editor):
   ```sql
   SELECT count(*) FROM public.ai_usage_events WHERE user_id IS NULL;  -- debe ser 0
   ALTER TABLE public.ai_usage_events DROP CONSTRAINT ai_usage_events_user_id_fkey;
   ALTER TABLE public.ai_usage_events ADD CONSTRAINT ai_usage_events_user_id_fkey
     FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;
   ALTER TABLE public.ai_usage_events ALTER COLUMN user_id SET NOT NULL;
   ```
   Probada en local (ver «Docker compartido»).

## Acciones de Sergio fuera del código

1. **Canal de alertas**: en Resend, una API key solo de envío para `becook.xyz` (distinta de la del
   SMTP). En Vercel `be-cook`, entorno **Production**: `OPS_ALERT_WEBHOOK_URL=https://api.resend.com/emails`,
   `OPS_ALERT_WEBHOOK_TOKEN=<clave>` (sensible), `OPS_ALERT_EMAIL_TO=<tu email>`; opcional
   `OPS_ALERT_EMAIL_FROM`. Opcional en Preview `audit-opt` (con rama). Redesplegar. Prueba: en Preview,
   `AI_MONTHLY_BUDGET_USD=0` + redeploy + generar un menú → email `ai_budget_exhausted`; volver a dejarlo.
2. **Migración** en becook-preview y producción (procedimiento de arriba), con backup previo.
3. **DPA** de Supabase, Vercel, OpenAI y Resend (aceptar/firmar y guardar copia).
4. **Revisión legal** de `docs/legal/*-BORRADOR.md`: responsable y contacto, bases jurídicas,
   consentimiento art. 9 para alergias/dietas, transferencias a EE. UU., plazos de conservación del
   ledger y de las copias, edad mínima. Después, páginas públicas y enlaces (otra iteración).
5. **Simulacro de restauración con datos reales**: hacer una copia nueva con el script del repo
   (`--use-copy`) y `bash scripts/ops/restore-drill.sh ~/Backups/becook/<etiqueta>` en tu Mac; anotar
   tiempos. Las copias antiguas (INSERT) no se pueden contar. Sustituir el script de `~/Backups` por el del repo.
6. **Límites de gasto**: confirmar el límite de 30 $/mes en OpenAI (D3); revisar Spend Management de
   Vercel y el plan/cuotas de Supabase y Resend; decidir si `AI_MONTHLY_BUDGET_USD` sigue en 25.
7. **Uptime**: cuando `uptime.yml` llegue a `main`, comprobar que GitHub avisa por email de los
   workflows programados que fallan (Settings → Notifications → Actions).
8. Pendiente de D1: protección de contraseñas filtradas en Auth (preview y producción).

## Docker compartido e integración

- La migración se aplicó al Docker local compartido con `db:migrate` para `test:db`. Al terminar se
  **revirtió en local** con el SQL de reversión (y se borró su fila del ledger local y las 112 filas
  sin dueño que había dejado el e2e de P35 al borrar sus cuentas), para que los otros worktrees sigan viendo el esquema de
  `audit-opt`. Tras integrar P37: `npm run db:migrate` (o `db:reset` + `db:seed`) y `test:db`.
- `test:db` falló dos veces seguidas en «D5 manual: two devices adding the same item at once end
  with one row» mientras el e2e de P35 usaba el mismo Docker, y pasó en la tercera (446/446) y
  siempre al ejecutar la suite de D5 sola: carrera dependiente de la carga, no de P37. Vigilarlo en
  la integración.
- Un usuario temporal del e2e de P35 con onboarding hacía fallar «D2: fixture profile restored and
  test accounts removed»; la comprobación ahora mira solo las cuentas de esa suite.
- P35: añadir el recorrido de exportación y borrado al e2e tras integrar P37 (nombres accesibles:
  h1 «Tus datos», botón «Descargar mis datos», campo «Escribe ELIMINAR para confirmar», botón
  «Eliminar mi cuenta», aviso «Tu cuenta se ha eliminado.»). Si su limpieza borra usuarios con uso
  de IA, las filas del ledger quedan sin dueño: borrarlas por `request_id` o `ip_hash` si molestan.
- P34 toca `src/app/profile/page.tsx`: P37 solo añade una línea (`<Link href="/profile/data" …>`)
  al final de la tarjeta «Cuenta»; en conflicto, conservar esa línea.

## Commits

`f0a81c6` migración y robustez de db-tests · `f64aab8` alertas · `4461bc9` rutas de cuenta y
test:db · `2eb4001` pantalla «Tus datos» · `c6b4aa4` copias y simulacro · (este) docs, legal y uptime.
