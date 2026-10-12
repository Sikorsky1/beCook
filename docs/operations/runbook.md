# beCook: runbook de operación

Procedimientos para volver a un estado sano (paso 37). Antes de tocar nada en producción, leer
`AGENTS.md` (entornos, backups, prohibiciones) y `docs/operations/incident-response.md`.

| Entorno | Proyecto | Ref / ID |
| --- | --- | --- |
| Producción | Vercel `be-cook` (equipo `sikorsky1991`), becook.xyz | `prj_PxytEQcv1kQ4Fq3WNKcPPsUOqG6J` |
| BD producción | Supabase becook (eu-west-1) | `wejvptpkxlllfpskyisu` |
| BD preproducción | Supabase becook-preview | `qdhpdhnpcsfhmygjofqb` |

Orden de preferencia ante un fallo: **1. interruptor de IA** (si el problema es coste o IA) →
**2. rollback de Vercel** (si lo rompió un despliegue) → **3. corrección hacia delante** →
**4. reversión de migración** → **5. restauración de copia** (último recurso, pierde datos).

## 1. Interruptor de IA

Corta todas las rutas de IA (menú, importar con IA, compra, «Otra idea», fichas) sin desplegar código:

1. Vercel → `be-cook` → Settings → Environment Variables → `AI_MONTHLY_BUDGET_USD` = `0` en
   **Production** (y en Preview `audit-opt` si aplica).
2. Redesplegar producción (Deployments → último de producción → Redeploy, sin caché si se duda).
3. Comprobar: con sesión, generar un menú → «La generación con IA no está disponible
   temporalmente». Sin sesión las rutas siguen dando 401. Lo demás de la app (semana, compra
   manual, despensa, importación local de tablas) sigue funcionando.
4. Las peticiones rechazadas quedan en `ai_usage_events` con `reject_reason = 'budget_exhausted'` y
   llega como mucho una alerta `ai_budget_exhausted` por minuto, flujo e instancia.

Para reactivar: devolver el valor (25 por D3, o borrar la variable) y redesplegar. Defensa adicional:
límite de gasto en la cuenta de OpenAI (30 $/mes, D3) — revisar que sigue configurado.

## 2. Rollback de un despliegue (Vercel Instant Rollback)

Cuando un despliegue de producción rompe algo y la base de datos no ha cambiado de forma incompatible:

1. Vercel → `be-cook` → Deployments → filtrar Production → el último despliegue sano (cada entrada
   de `PROGRESS.md` anota el anterior «para rollback») → menú `…` → **Instant Rollback**.
   CLI equivalente: `vercel rollback <url-o-id> --scope sikorsky1991`.
2. Comprobar en becook.xyz: `/login` 200, `/week` 200, `POST /api/generate-menu` sin sesión 401.
3. Tras un Instant Rollback, Vercel **deja de asignar automáticamente** los nuevos despliegues de
   `main` al dominio de producción hasta que se vuelva a promocionar uno. Cuando el arreglo esté en
   `main` y su despliegue sea READY: Deployments → ese despliegue → **Promote** (o
   `vercel promote <url-o-id> --scope sikorsky1991`). Comprobar otra vez las rutas del punto 2.
4. El rollback **no** revierte variables de entorno ni migraciones de Supabase. Si el despliegue
   anterior no es compatible con el esquema actual (p. ej. tras una migración destructiva), no
   sirve: ir a 3 o 4. Por eso en producción solo se aplican cambios aditivos antes del merge.
5. Si un despliegue se queda en QUEUED más de 10 min sin otro delante: cancelarlo y redesplegar el
   mismo commit (`AGENTS.md`).

## 3. Corrección hacia delante

Preferible a revertir esquema: rama desde `audit-opt`, arreglo con test, CI, Preview `audit-opt`,
merge a `main`. Las migraciones siguen el flujo de `AGENTS.md` (local → preview → producción con OK).

## 4. Reversión de una migración

- Cada iteración documenta su SQL de reversión en `PROGRESS.md` o en su `progress-*.md`
  (P37: `docs/development/progress-p37.md`). Una reversión es otra migración: requiere OK
  explícito de Sergio, backup previo y registro en `supabase/hosted/applied-*.json`.
- Nunca `supabase db push` ni reset remoto. Una migración inversa **no recupera filas borradas**.
- Los `DELETE` remotos se preparan como SQL y los ejecuta Sergio en el SQL Editor.
- Revertir primero el código que depende de la migración (rollback de Vercel) y después el esquema.

## 5. Restauración de una copia (último recurso)

Producción **no tiene backups automáticos**: las únicas copias son las que hace Sergio con
`bash scripts/ops/backup-production.sh <etiqueta>` antes de cada escritura (en
`~/Backups/becook/<etiqueta>`: `schema.sql`, `data.sql` con COPY, `roles.sql`, `counts.txt`,
`SHA256SUMS`). Restaurar pierde todo lo escrito después de la copia: decidirlo con Sergio.

`data.sql` incluye `auth.users`, identidades, sesiones y refresh tokens (la CLI solo excluye
`auth.schema_migrations`): restaurar devuelve también las sesiones de ese momento.

1. Comprobar la copia: `cd ~/Backups/becook/<etiqueta> && shasum -a 256 -c SHA256SUMS`.
2. Ensayo previo en local (recomendado, solo Sergio con datos reales):
   `bash scripts/ops/restore-drill.sh ~/Backups/becook/<etiqueta>`. Restaura en una base
   desechable del Docker local, compara filas, esquema, RLS y propietarios, y la borra.
3. **Nunca restaurar encima del proyecto de producción** (no hay reset remoto). Crear un proyecto
   Supabase nuevo en eu-west-1 y restaurar en él, según la guía oficial de Supabase
   («Backup and restore using the CLI»):

   ```sh
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file roles.sql --file schema.sql \
     --command 'SET session_replication_role = replica' \
     --file data.sql --dbname "<cadena de conexión del proyecto nuevo>"
   ```

   Si fallan tablas internas de la plataforma vacías (p. ej. `storage.*`, beCook no usa Storage),
   repetir el volcado de datos con `--exclude` de esas tablas o quitar sus bloques `COPY` vacíos.
4. Comparar `counts.txt` con `SELECT count(*)` por tabla en el proyecto nuevo.
5. Rehacer a mano lo que no está en las copias: configuración de Auth (Site URL, Redirect URLs,
   SMTP de Resend, plantillas en español, longitud mínima 8, confirmación de email), claves de API
   nuevas, cuotas de la Data API (`max_rows`), extensiones si las hubiera.
6. Vercel Production: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y
   `SUPABASE_SERVICE_ROLE_KEY` del proyecto nuevo → redesplegar. Actualizar `AGENTS.md`,
   `supabase-keepalive.yml` (variables de GitHub) y el llavero (`becook-prod-db`).
7. Validar: login de una cuenta de prueba, lectura de semana, IA con sesión, exportación.

Simulacro con datos sintéticos (sin producción): `bash scripts/ops/restore-drill.sh --from-local`.

## 6. Rotación de claves

Rotar ante cualquier sospecha de fuga (ver incident-response) y al menos al dar acceso a alguien nuevo.
Después de cada cambio en Vercel: **redesplegar** el entorno.

| Clave | Dónde se rota | Dónde se actualiza | Notas |
| --- | --- | --- | --- |
| Service role / secret key de Supabase | Supabase → Project Settings → API Keys (crear secret key nueva o rotar el JWT secret) | Vercel `SUPABASE_SERVICE_ROLE_KEY` (Production; Preview `audit-opt` con la de becook-preview) | Rotar el JWT secret invalida también la anon key y todas las sesiones: actualizar `NEXT_PUBLIC_SUPABASE_ANON_KEY` y las variables de GitHub del keepalive |
| `OPENAI_API_KEY` | platform.openai.com → API keys: crear nueva | Vercel (Production y Preview `audit-opt`) | Revocar la antigua después de redesplegar |
| `AI_IP_HASH_SALT` | Generar 32+ bytes aleatorios | Vercel (solo Production / rama) | Solo se pierde la continuidad del límite por IP durante 1 h |
| Clave de Resend | resend.com → API Keys | `OPS_ALERT_WEBHOOK_TOKEN` en Vercel y contraseña SMTP en Supabase Auth (ambos proyectos) | Usar claves distintas para SMTP y alertas, con permiso solo de envío |
| Contraseña de la BD | Supabase → Database → Reset password | Llavero `becook-prod-db` | La app no la usa; solo las copias |
| Contraseñas del keepalive | Supabase Auth (usuarios `keepalive-*`) | Secretos de GitHub | `docs/development/supabase-keepalive.md` |
| Tokens de Vercel / GitHub | Paneles respectivos | — | Códigos de recuperación regenerados (D1, 2026-10-05) |

## 7. Comprobaciones rápidas

- Producción viva: `uptime.yml` (cada 4 h; GitHub avisa por email si falla) o a mano:
  `/login` 200 y `POST /api/generate-menu` sin sesión 401.
- Gasto del mes (solo agregados): `SELECT round(sum(cost_usd), 2) FROM public.ai_usage_events
  WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'Europe/Madrid'
  AND status IN ('succeeded','failed');`
- Errores de servidor: Vercel → `be-cook` → Logs (filtrar 5xx) y alertas `server_error`.
