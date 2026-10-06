# beCook — Progreso del roadmap

Actualizado: 2026-10-06 · Rama: `audit-opt` · Plan: `docs/development/2026-10-05-plan-implementacion-roadmap.md`
Roadmap: `docs/audit-2026-09-15/beCook_roadmap_unificado.md`

Leyenda: ✅ cerrado · 🟡 en curso · ⏳ pendiente · ⛔ bloqueado (ver nota)

## Iteración 0 — Gobernanza ✅ (2026-10-06)
| Tarea | Estado | Nota |
|---|---|---|
| Reglas de entornos y migraciones en `AGENTS.md` | ✅ | Aprobado y añadido 2026-10-06 |
| `PROGRESS.md` | ✅ | Este fichero |
| Diagnóstico de datos incompatibles en producción | ✅ | Ver `supabase/hosted/production/2026-10-05-reconcile-ownership.sql` |
| Propuesta de cuotas de IA | ✅ | Aprobada (D3); se implementa en A4 |

## Iteración A2 — Dependencias ✅ (2026-10-06)
| Tarea | Estado | Nota |
|---|---|---|
| Reauditoría `npm audit` | ✅ | Antes: 17 (1 crítico Next, 11 altos, 2 moderados, 3 bajos) |
| Next + eslint-config-next 16.3.8 (fijadas exactas) | ✅ | Guía 16.3 revisada: sin cambios de código (no usa `revalidateTag`, `next/image`, `next/og`, proxy) |
| @supabase/supabase-js ^2.117.2 (auth-js 2.117.2) | ✅ | Requiere Node ≥ 22 (`.nvmrc` = 24) |
| Transitivas dentro de rango (`npm update`) | ✅ | postcss, nanoid, @babel/core, browserslist, brace-expansion, js-yaml, @humanfs/node, baseline-browser-mapping; sharp 0.35.5 vía Next |
| Comprobaciones | ✅ | lint, typecheck, test (22/22), build, db:start + test:db (282/282); login y rutas principales en `npm run dev` |
| Riesgo residual aceptado | ⚠️ | 5 avisos altos: `braces` 3.0.3 sin parche ← micromatch ← fast-glob 3.3.1 (fijado por @next/eslint-plugin-next) ← eslint-config-next. Solo lint/dev, no runtime. Revisar en próximas versiones de Next |

## Iteración A3 — Rutas de IA protegidas ✅ (2026-10-06)
| Tarea | Estado | Nota |
|---|---|---|
| Defecto reproducido antes del cambio | ✅ | Las 3 rutas llamaban a OpenAI sin `Authorization` (menú 200, importar 200, compra 1 llamada) |
| Guard de servidor `src/lib/server/ai-request.ts` | ✅ | Orden: Bearer ausente 401 → Content-Type 415 → Content-Length 413 → `auth.getUser(token)` 401 (Auth caído 503) → cuerpo por stream 413 → JSON/objeto 400. OpenAI solo tras validar |
| Límites (`src/lib/server/ai-limits.ts`) | ✅ | Menú 64 KB · importar 32 KB y texto ≤ 8.000 · compra 16 KB, 1–7 días, slots ≤ 200 |
| Cliente con token (`postAi`) | ✅ | Invitados no llaman a la API; 401 del servidor → aviso de sesión |
| UX invitado | ✅ | Aviso «Inicia sesión para generar con IA» en Crear menú (generar e importar) y Compra; `/login?next=` solo rutas internas; borrador del formulario en `sessionStorage` |
| Tests | ✅ | `tests/ai-routes.test.cjs` (24; 19 fallan con el código anterior); test HTTP de menú usa sesión; `test:db` valida token real y manipulado contra Auth local |
| Comprobaciones | ✅ | lint, typecheck, test 46/46, build, test:db 284/284; manual invitado → login → vuelta con borrador, e identificado (llega a OpenAI; local sin clave → 500 esperado) |
| Pendiente para A4 | ✅ | Hecho en A4 |

## Iteración A4 — Cuotas y trazabilidad de IA ✅ en preview (2026-10-06)
| Tarea | Estado | Nota |
|---|---|---|
| Migración `20261006090000_ai_usage_quotas` (aditiva) | ✅ local | `ai_usage_events` (RLS sin políticas; sin permisos anon/authenticated) + `ai_begin_request(…, p_limits)` / `ai_finish_request(…, p_reason)` solo `service_role`, `pg_advisory_xact_lock` por usuario e IP. Expectativas en `supabase/expectations/` |
| Orden de comprobación | ✅ | Presupuesto global del mes → concurrencia (caducidad de `started` a 2 min) → cuota diaria/mensual por flujo → 30/h por IP. Día/mes en Europe/Madrid. Fallos sin tokens no consumen cuota |
| Servidor (`src/lib/server/ai-usage.ts`) | ✅ | `SUPABASE_SERVICE_ROLE_KEY` solo servidor; cifras D3 por `AI_*`; `ip_hash` HMAC-SHA256 con `AI_IP_HASH_SALT`; 429 + `Retry-After` por motivo; 503 por presupuesto o sin configuración; `X-Request-Id` |
| Rutas | ✅ | begin → OpenAI → finish en `finally` (error, timeout, cancelación `client_aborted`). Importar 25 s y compra 35 s, máx. 1 reintento (timeout/conexión/5xx), coste con `cost.ts`, `store:false`; errores del modelo 502 |
| Logs | ✅ | `ai_usage` {flow, requestId, status, reason, model, costUsd, latencyMs, attempts}; `ai_budget_threshold` al cruzar 50/80 %; eliminados logs con respuesta del modelo |
| UI | ✅ | Compra muestra el mensaje del servidor; Crear menú oculta la pista de reintento en 429/503 |
| Telemetría `menu_generation_requests` | ✅ | Sin cambios |
| Tests | ✅ | `tests/ai-usage.test.cjs` (39); `test:db` +19 (cuotas, concurrencia real en paralelo, IP, presupuesto, caducidad, permisos SQL y Data API) |
| Comprobaciones | ✅ | lint, typecheck, test 85/85, build, test:db 303/303 (también desde `db:reset`); manual con OpenAI simulado local: 4 menús + 5.º 429, concurrencia 429, presupuesto 503, mensajes en UI |
| Aplicar en becook-preview | ✅ | 20261006115739 (2026-10-06, Cowork). Permisos verificados: sin acceso anon/authenticated; EXECUTE solo service_role |
| Variables en Vercel (Preview `audit-opt`, proyecto `be-cook`) | ✅ | `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `AI_IP_HASH_SALT` con rama `audit-opt` |
| Prueba de punta a punta en Preview | ✅ | 2026-10-06: invitado → aviso de login; menú (0,009 $, 7,5 s) y compra (0,03–0,04 $, 20–28 s) registrados con ip_hash de 64 hex; 5.º menú → 429 «límite de 4 menús por hoy» (`daily_quota`). Registros sintéticos de la prueba anulados (`synthetic_quota_test_reset`) |
| Hallazgo para B6 | ⚠️ | La compra se generó 2 veces en 1 min al navegar (defecto H7/H14 de la auditoría) |
| Producción | ⏳ | Con OK, backup y variables propias antes del merge a `main` |

## Pasos del roadmap
| Paso | Iter. | Estado | Nota |
|---|---|---|---|
| 01 Credenciales de recuperación | A1 | ✅ | Archivo retirado + gitleaks (`f6555fd`); códigos regenerados (confirmado por Sergio 2026-10-05) |
| 02 Entorno de pruebas y cambios reproducibles | A1 | ✅ | Local + preview + CI; producción reconciliada y con `enforce_reference_ownership` (2026-10-06); esquemas prod = preview |
| 03 Dependencias | A2 | ✅ | 2026-10-06: next/eslint-config-next 16.2.1→16.3.8, supabase-js 2.49.4→2.117.2 + transitivas; audit 17→5 (riesgo residual aceptado, ver A2) |
| 04 Rutas de IA protegidas | A3 | ✅ | 2026-10-06: sesión verificada en servidor (401), límites 413/415/400, UX invitado con retorno; ver A3 |
| 05 Cuotas y trazabilidad de IA | A4 | 🟡 | ✅ en preview y probado de punta a punta (2026-10-06). Falta producción antes del merge a `main` |
| 06 Datos locales por identidad | B1 | ⏳ | |
| 07 Fuente de verdad y sincronización | B1 | ⏳ | |
| 08 Contrato perfil ↔ BD | B2 | ⏳ | |
| 09 Calendario ISO | B3 | ⏳ | |
| 10 Escrituras de semana seguras | B4 | ⏳ | |
| 11 Aplicar menú ≠ generar compra | B5 | ⏳ | |
| 12 Compra ligada a su semana | B6 | ⏳ | |
| 13 Despensa remota segura | B7 | ⏳ | |
| 14 Firma de compra estable | B6 | ⏳ | |
| 15 Estados de sincronización visibles | B5 | ⏳ | |
| 16 Contexto alimentario por semana | C1 | ⏳ | |
| 17 Fichas de plato versionadas | C2 | ⏳ | |
| 18 Validación de restricciones | C3 | ⏳ | |
| 19 Compra desde recetas y despensa | C4 | ⏳ | |
| 20 Reconciliar cambios de plato | C4 | ⏳ | |
| 21 Reglas culinarias y sustitución | C5 | ⏳ | |
| 22 Importación y borradores | C6 | ⏳ | |
| 23 Alta, login y recuperación | D1 | ⏳ | |
| 24 Perfil simplificado | D2 | ⏳ | |
| 25 Onboarding y primer menú | D2 | ⏳ | |
| 26 Aplicar propuesta visible y segura | D3 | ⏳ | |
| 27 Generación honesta | D3 | ⏳ | |
| 28 «Otra idea» por plato | D3 | ⏳ | |
| 29 Semana con «Hoy» | D4 | ⏳ | |
| 30 Compra completa y despensa | D5 | ⏳ | |
| 31 Despensa con acciones claras | D5 | ⏳ | |
| 32 Navegación y estados vacíos | D6 | ⏳ | |
| 33 Legibilidad y accesibilidad | D6 | ⏳ | |
| 34 Consolidar componentes | D6 | ⏳ | |
| 35 Tests de recorridos críticos | E1 | ⏳ | Se adelantan tests en cada iteración |
| 36 Usabilidad en dispositivos | E2 | ⏳ | Requiere a Sergio |
| 37 Operación y privacidad | E3 | ⏳ | |
| 38 Beta cerrada y apertura | E4 | ⏳ | Requiere a Sergio |

## Migraciones por entorno
| Migración | Local | becook-preview | becook (producción) |
|---|---|---|---|
| preview_bootstrap / baseline | ✅ | ✅ 20260924112904 | n/a (esquema previo) |
| reconcile_ownership (datos) | n/a | n/a | ✅ 2026-10-06 (SQL Editor, fuera del ledger) |
| enforce_reference_ownership | ✅ | ✅ 20260924112917 | ✅ 20261005220924 |
| ai_usage_quotas | ✅ | ✅ 20261006115739 | ✅ 20261006171007 |

## Decisiones
| # | Decisión | Fecha |
|---|---|---|
| D1 | Códigos de recuperación de Vercel regenerados | 2026-10-05 |
| D2 | IA solo con sesión verificada | 2026-10-05 |
| D3 | Cuotas: menú 4/día y 20/mes; importar y compra 10/día; 1 concurrente; 30/h por IP; corte global 25 $/mes (avisos 50/80 %); límite OpenAI 30 $/mes | 2026-10-06 |
| D4 | Datos incompatibles de producción pueden eliminarse | 2026-10-05 |
| D5 | Cuotas y rate limit en tabla Supabase + RPC | 2026-10-05 |
| D6 | Sin backups automáticos: avisar y hacer backup antes de cada cambio en producción | 2026-10-05 |
| D6b | Reconciliación 2026-10-06 sin backup externo (datos irrelevantes, decisión de Sergio); se mantiene copia interna `backup_20261005` | 2026-10-06 |
