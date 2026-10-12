# beCook: respuesta a incidentes

Guía corta para un equipo de una persona (Sergio) con agentes. Los procedimientos técnicos están en
`docs/operations/runbook.md`; las variables, en `docs/operations/environment.md`.

## Señales

| Señal | Origen | Qué indica |
| --- | --- | --- |
| Alerta `server_error` | `src/instrumentation.ts` (onRequestError) | Error no controlado en una página, ruta o acción. Trae ruta sin consulta, método, tipo y digest |
| Alerta `ai_budget_threshold` | Ledger de IA | Gasto del mes cruza el 50 % o el 80 % de `AI_MONTHLY_BUDGET_USD` |
| Alerta `ai_budget_exhausted` | Ledger de IA | Presupuesto agotado: la IA responde 503 a todos |
| Alerta `ai_ledger_unavailable` | Ledger de IA | No se puede abrir el registro de uso (Supabase caído o sin clave): la IA responde 503 |
| Alerta `ai_usage_finish_failed` | Ledger de IA | No se pudo cerrar un registro (caduca a los 2 min; el gasto puede quedar sin anotar) |
| Alerta `account_delete_failed` | `/api/account/delete` | Un usuario pidió borrar su cuenta y falló: **atender en el día** |
| Fallo de `Uptime becook.xyz` | GitHub Actions (email de GitHub) | `/login` no da 200 o la ruta de IA no da 401 |
| Fallo de `Supabase keepalive` | GitHub Actions | Proyecto pausado o Auth/PostgREST caídos |
| Aviso de usuario | Email / beta | Cualquier cosa; pedir pasos, hora y dispositivo, nunca contraseñas |

Las alertas no llevan datos personales ni de comidas, y llegan como mucho una por minuto por ruta e
instancia. Solo existen si `OPS_ALERT_WEBHOOK_URL` está configurada en Vercel (pendiente de Sergio).

## Gravedad

| Nivel | Ejemplos | Respuesta |
| --- | --- | --- |
| **S1** | Posible acceso a datos de otro usuario (RLS), fuga de una clave de servicio, datos borrados | Inmediata. Contener primero, investigar después |
| **S2** | becook.xyz caída, login imposible, IA con gasto descontrolado, borrado de cuenta fallando | En horas |
| **S3** | Un flujo degradado (p. ej. la compra no se genera), errores aislados | Siguiente sesión de trabajo |

## Pasos comunes

1. **Anotar** hora (Europe/Madrid), señal y despliegue actual (Vercel → Deployments).
2. **Contener** según el caso (tabla siguiente). Preferir acciones reversibles.
3. **Diagnosticar** con agregados: logs de Vercel (eventos `ai_usage`, `menu_generation`,
   `account_export`, `account_delete`…, sin contenido), logs y advisors de Supabase, `requestId`
   (cabecera `X-Request-Id`) para cruzar una petición con `ai_usage_events.request_id`.
   En producción solo lectura de metadatos y agregados; nunca imprimir datos personales.
4. **Corregir** por el flujo normal (rama, test, Preview, merge) salvo urgencia S1.
5. **Cerrar** con una nota en `PROGRESS.md` (o el `progress-*.md` de la iteración): qué pasó,
   impacto, causa, arreglo y qué se cambia para que no se repita.

## Contención por caso

| Caso | Contención |
| --- | --- |
| Despliegue roto | Instant Rollback (runbook §2) |
| Gasto de IA anómalo | Interruptor `AI_MONTHLY_BUDGET_USD=0` + redeploy (runbook §1); revisar en `ai_usage_events` por `flow`, `ip_hash` y hora (agregados) |
| Clave filtrada (repo, chat, log) | Rotar al momento (runbook §6), redesplegar, revisar uso en el panel del proveedor; gitleaks en el historial |
| Sospecha de fallo de RLS | Reproducir **en local** con `test:db` y usuarios ficticios; si se confirma, desactivar la función afectada (rollback o interruptor) y preparar la migración correctora con OK de Sergio |
| Datos borrados o corruptos | Parar escrituras de ese flujo (rollback). Valorar restauración parcial desde la última copia (runbook §5) en un proyecto aparte y copiar solo lo necesario, con OK de Sergio |
| Supabase caído | Esperar estado de Supabase; la app guarda cambios como pendientes en el dispositivo y los reintenta |
| Borrado de cuenta fallido | Comprobar `SUPABASE_SERVICE_ROLE_KEY` en Vercel y el estado de Auth; si persiste, Sergio borra el usuario desde Supabase → Authentication (la BD hace la cascada) y avisa al usuario |

## Brecha de datos personales (BORRADOR, pendiente de revisión legal)

Si hay acceso no autorizado, pérdida o divulgación de datos personales:

- Documentar el incidente (qué datos, cuántas personas, desde cuándo, medidas tomadas).
- Si es probable un riesgo para las personas, notificar a la AEPD **en 72 horas** desde que se
  conoce (RGPD art. 33). Los datos de alergias y dietas pueden ser datos de salud (art. 9): el
  umbral de riesgo es más bajo.
- Si el riesgo es alto, informar también a las personas afectadas sin demora (art. 34).
- Avisar a los encargados implicados (Supabase, Vercel, OpenAI, Resend) si el origen está en ellos.

## Plantilla de cierre

```
Incidente AAAA-MM-DD — título
Gravedad: S1/S2/S3 · Detectado por: alerta/usuario/… · Duración: …
Impacto: qué dejó de funcionar y para cuántas personas (aproximado, sin datos personales)
Causa: …
Contención y arreglo: commits / despliegues / migraciones
Acciones: tests, alertas o documentación nuevos
```
