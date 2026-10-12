# beCook: variables de entorno por entorno

Inventario sin valores (paso 37). Los valores viven solo en Vercel, en el llavero de Sergio o los
genera el CLI local. Nunca en el repositorio, en el chat ni en los logs. Un cambio de variables en
Vercel solo se aplica al **redesplegar** ese entorno (push o Redeploy).

Entornos (ver `AGENTS.md`):

- **Local**: Docker `becook-iteration02`. `npm run dev` inyecta las variables del CLI local después
  de verificar el contenedor; `.env.local` apunta a producción y no debe usarse para desarrollar.
- **Preview `audit-opt`**: proyecto Vercel `be-cook`, variables con rama `audit-opt` → becook-preview
  (`qdhpdhnpcsfhmygjofqb`). Cualquier otra rama Preview usa las generales (producción): no desplegar
  ramas nuevas sin variables propias.
- **Producción**: becook.xyz, rama `main` → becook (`wejvptpkxlllfpskyisu`).
- **CI**: GitHub Actions con Docker local; no consume secretos de la aplicación.

## Aplicación (Next.js en Vercel)

| Variable | Local | Preview `audit-opt` | Producción | Sensible | Uso |
| --- | --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | CLI local | becook-preview | becook | No (pública) | Cliente y servidor. Se incrusta en el JS al construir |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | CLI local | becook-preview | becook | No (pública, sujeta a RLS) | Cliente; el servidor verifica sesiones con ella |
| `SUPABASE_SERVICE_ROLE_KEY` | CLI local | becook-preview (rama) | becook (solo Production) | **Sí, máxima** | Solo servidor: ledger de IA (`ai-usage.ts`), exportación del ledger y borrado de cuenta (`account.ts`) |
| `OPENAI_API_KEY` | vacía (sin gasto) | sí (rama) | sí | **Sí** | Rutas de IA |
| `AI_IP_HASH_SALT` | `local-dev-only-salt` | propio (rama) | propio (solo Production) | Sí | HMAC de la IP en `ai_usage_events.ip_hash` |
| `AI_MONTHLY_BUDGET_USD` | defecto 25 | opcional | opcional (defecto 25) | No | Corte global de gasto. **`0` = interruptor de IA** (todas las rutas de IA → 503) |
| `AI_QUOTA_MENU_DAILY`, `AI_QUOTA_MENU_MONTHLY`, `AI_QUOTA_IMPORT_DAILY`, `AI_QUOTA_SHOPPING_DAILY`, `AI_MAX_CONCURRENT`, `AI_IP_HOURLY` | defectos D3 | opcionales | opcionales | No | Cuotas (4/día y 20/mes de menús; 10/día de importar y compra; 1 concurrente; 30/h por IP) |
| `OPENAI_MODEL`, `OPENAI_FALLBACK_MODEL`, `MENU_OPENAI_MODEL`, `MENU_OPENAI_FALLBACK_MODEL`, `OPENAI_REASONING_EFFORT` | opcionales | opcionales | opcionales | No | Modelos (defectos en `src/lib/openai/config.ts`) |
| `OPENAI_BASE_URL` | solo e2e (simulador local) | **nunca** | **nunca** | — | Lo usa el e2e de P35. En Vercel el build falla si existe (`next.config.ts`) y las rutas de IA responden 503 con cualquier `VERCEL_ENV` |
| `OPS_ALERT_WEBHOOK_URL` | sin definir | opcional | **pendiente (Sergio)** | Media | Canal de alertas (P37). Sin ella no se envía nada. `https://api.resend.com/emails` → email con Resend; otra URL https → webhook JSON |
| `OPS_ALERT_WEBHOOK_TOKEN` | — | opcional | pendiente | **Sí** | Clave de API de Resend (o Bearer del webhook) |
| `OPS_ALERT_EMAIL_TO` | — | opcional | pendiente | Dato personal | Destinatario(s) de las alertas, separados por comas (solo con Resend) |
| `OPS_ALERT_EMAIL_FROM` | — | opcional | opcional | No | Remitente; defecto `beCook alertas <no-reply@becook.xyz>` (dominio verificado en Resend) |
| `VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA` | — | Vercel | Vercel | No | Los pone Vercel; se añaden a las alertas |
| `NODE_ENV` | Next | Next | Next | No | — |

Reglas:

- Secretos de Preview siempre **con rama** (`audit-opt`); nunca Preview sin rama.
- `SUPABASE_SERVICE_ROLE_KEY` y `AI_IP_HASH_SALT` de producción solo en el entorno Production.
- Antes de cambiar una variable sensible: anotar qué despliegue la usa y redesplegar después.
- Si falta `SUPABASE_SERVICE_ROLE_KEY` o `AI_IP_HASH_SALT`, la IA responde 503 (falla cerrada);
  exportar y borrar la cuenta también responden 503.

## Operación fuera de la aplicación

| Elemento | Dónde | Uso |
| --- | --- | --- |
| Contraseña de la BD de producción | Llavero de macOS, servicio `becook-prod-db`, cuenta `postgres.wejvptpkxlllfpskyisu` | `scripts/ops/backup-production.sh` |
| Copias de producción | `~/Backups/becook/<etiqueta>` (fuera del repo, 700/600) | Restauración y simulacros |
| Variables de GitHub (`SUPABASE_PROD_URL`, `SUPABASE_PROD_PUBLISHABLE_KEY`, `*_KEEPALIVE_EMAIL`) y secretos `*_KEEPALIVE_PASSWORD` | GitHub → Settings → Actions | `supabase-keepalive.yml` |
| `GITLEAKS_BIN` | Máquina del desarrollador | Hook de pre-commit |
| SMTP de Auth (Resend) | Supabase → Auth → SMTP, en becook-preview y becook | Emails de alta y recuperación (D1) |

`uptime.yml` no usa secretos: solo peticiones públicas a www.becook.xyz (becook.xyz redirige a www con 308).
