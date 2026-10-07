# beCook — Progreso del roadmap

Actualizado: 2026-10-07 · Rama: `audit-opt` (= `main` tras PR #6) · Plan: `docs/development/2026-10-05-plan-implementacion-roadmap.md`
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

## Iteración A4 — Cuotas y trazabilidad de IA ✅ (2026-10-06, en producción)
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
| Producción | ✅ | Migración 20261006171007; `AI_IP_HASH_SALT` y `SUPABASE_SERVICE_ROLE_KEY` (sensible, solo Production) en Vercel be-cook |

## Bloque A en producción ✅ (2026-10-06)
| Elemento | Resultado |
|---|---|
| PR | [#6](https://github.com/Sikorsky1/beCook/pull/6) `audit-opt` → `main`, merge commit (sin squash/rebase); checks de la PR en verde; sin conflictos (keepalive d108e75 = ac22a3a) |
| Commit de merge | `512206d` (2026-10-06 17:28 UTC); `audit-opt` sincronizada por fast-forward |
| Despliegue be-cook | `dpl_HuitjA7FscP4fN6h3i4RuEATGbxe` READY, alias `www.becook.xyz` y `becook.xyz`. Anterior (rollback): `dpl_BXcpRGFHQwxqifzEF2FmpgrrTEsA` (d108e75) |
| Variables Production | `SUPABASE_SERVICE_ROLE_KEY` de `wejvptpkxlllfpskyisu` (verificada por ref y rol, pasada por stdin, tipo Secret); `AI_IP_HASH_SALT`. Preview solo con copia de rama `audit-opt` |
| Comprobaciones | `/login` 200 · `POST /api/generate-menu` sin sesión 401 · `POST /api/generate-shopping-list` sin sesión 401 · extra: `POST /api/import-menu` 401; `/week`, `/create-menu`, `/shopping/list` 200 |
| Efecto visible | Los invitados dejan de tener IA (D2) |
| Pendiente | Generación real con sesión en producción (manual, Sergio) |

## Hotfix A4.1 — Timeout de la lista de la compra ✅ (2026-10-06, en producción)
| Elemento | Detalle |
|---|---|
| Hallazgo (producción) | La compra tardó 67 s y luego falló dos veces por timeout a 70 s (35 s × 2 intentos; `ai_usage_events`). La ruta usaba `OPENAI_MODEL` (gpt-5.6-sol) por Responses **sin `reasoning`** → esfuerzo por defecto del modelo; `OPENAI_REASONING_EFFORT` no lo usa ninguna ruta |
| Arreglo (solo `/api/generate-shopping-list`) | `reasoning: {effort: "low"}` (solo modelos gpt-5*); timeout 55 s por intento; **sin reintento tras timeout**; un reintento solo si el fallo (conexión o 5xx) llega en ≤ 10 s; `maxDuration` 80 → 90 s. Menú e importación sin cambios |
| Medición OpenAI simulado | Colgado: antes 2 intentos, 70,0 s, 502 · después 1 intento, 55,1 s, 502. Respuesta inmediata: igual (200, 1 intento) |
| Medición OpenAI real (local, semana de 7 días, gpt-5.6-sol) | Antes: 19,0 s y 34,7 s; razonamiento 516 y 1.659 tokens; 0,028 y 0,052 $ · Después: 10,2 s y 8,2 s; razonamiento 278 y 211; 0,024 y 0,021 $; 33–36 artículos (antes 35–37) |
| Tests | `tests/openai-retry.test.cjs` (5; 4 fallan con el código anterior): política de reintento, `reasoning` low en compra y ausente en importar, `maxDuration` cubre el peor caso |
| Comprobaciones | lint, typecheck, test 90/90, build |
| Producción | [PR #7](https://github.com/Sikorsky1/beCook/pull/7), merge commit `bb47993` (2026-10-06 21:22 UTC), checks en verde. Despliegue be-cook `dpl_BhB2LfQCNEZWGn1pBHv1HQ81XAc3` READY en `www.becook.xyz` (anterior para rollback: `dpl_HuitjA7FscP4fN6h3i4RuEATGbxe`). `/login` 200 · `POST /api/generate-shopping-list` sin sesión 401 · extra `POST /api/generate-menu` sin sesión 401. `audit-opt` = `main` por fast-forward |
| Pendiente | Generar una lista real con sesión en producción y revisar su latencia en `ai_usage_events` (Sergio) |

## Iteración B1 — Identidad y fuente de verdad ✅ (2026-10-06, en producción el 2026-10-07)
| Elemento | Detalle |
|---|---|
| Defecto reproducido | Con el código anterior, B veía el perfil de A (`becook-profile` con su alergia), su semana y su despensa tras A → logout → B. En el navegador, `fixture-1` veía un perfil local antiguo (hombre, 174 cm) en vez del suyo (mujer, 165 cm) |
| Identidad | `src/lib/session/identity.ts` + `IdentityProvider`/`useIdentity` en el layout: `resolving` → `ready`; `epoch` en cada login, logout, cambio de usuario o caducidad. Logout explícito borra la caché del usuario (confirmación si hay pendientes); caducidad la conserva y muestra aviso |
| Claves | `becook:<guest|u_userId>:<entidad>[:YYYY-Www]`, sobre `{v:1, data, savedAt, remoteVersion, pending}` (`src/lib/storage/scoped-storage.ts`). Sin accesos directos a `localStorage` fuera de esa capa |
| Fuente de verdad | Repositorios (`src/lib/data/`): caché propia + revalidación filtrada por `user_id` de perfil, semana, despensa y compra; nada vacío sin confirmación remota. Conflictos: **gana el remoto** (versión = `updated_at`), pendientes reenviados solo si la base no cambió, guardados serializados por entidad, `overwrite` solo tras confirmar «reemplazar semana» |
| Origen de los 30 registros cruzados | La despensa y Crear menú tomaban el `profileId` del perfil local de otra cuenta. Ahora el perfil es siempre del ámbito actual y la despensa enlaza el perfil propio leído del servidor |
| Compra (parte de H7) | Caché por semana → lista remota de esa semana → IA. Eliminado el «última semana» por defecto al sincronizar |
| Datos antiguos | Movidos a invitado con `legacy-origin`; oferta explícita «¿Quieres añadirlos a tu cuenta?» que solo añade lo que la cuenta no tiene; rechazo → quedan como invitado |
| Tests | `tests/session-isolation.test.cjs` (16; mutaciones: claves sin ámbito → 5 fallos, logout sin borrar → falla H3); `test:db` +4 contra Auth/RLS reales |
| Comprobaciones | lint, typecheck, test 106/106, build, test:db 307/307 (tras `db:reset`). Manual con fixtures A y B: migración de claves antiguas, oferta e importación (9 semanas añadidas, perfil y despensa conservados), perfil de A correcto, logout sin rastro de A, B solo ve lo suyo, cambio desde un segundo dispositivo visible al recargar |
| Producción | [PR #8](https://github.com/Sikorsky1/beCook/pull/8), merge commit `9acc880` (2026-10-06 22:10 UTC), checks en verde. Despliegue be-cook `dpl_3hdkPSnXeFKoGxPjWytuFTBpPsne` READY en `www.becook.xyz` (anterior para rollback: `dpl_BhB2LfQCNEZWGn1pBHv1HQ81XAc3`). `/login`, `/week`, `/profile` 200 · `POST /api/generate-menu` sin sesión 401. `audit-opt` = `main` por fast-forward |
| Pendiente | Prueba manual en producción con dos cuentas (A → logout → B) y oferta de importación en un navegador con datos antiguos (Sergio) |

## Iteración B2 — Contrato perfil ↔ BD 🟡 (2026-10-07; código listo, migración pendiente en remotos)
| Elemento | Detalle |
|---|---|
| Defectos reproducidos | Tests contra Supabase local que fallaban con el código anterior (9 de 11): 6–7 días → `profiles_weekly_training_days_check`; «Otro» primero → `profiles_goal_check`; `disliked_foods` se guardaba como texto JSON (`["pollo",…]`, `[]`) y se leía como `[]` |
| Producción (solo recuentos) | 3 perfiles; los 3 `disliked_foods` son arrays JSON (2 `[]`, 1 con un elemento, sin comas); 0 `maintenance`, 0 `other`; máx. 3 días. La lectura nueva los conserva sin migrar datos |
| `disliked_foods` | Texto canónico `pollo, brócoli` (sin vacíos ni duplicados; vacío → NULL). Lectura tolerante: JSON antiguo, literal `{…}` y texto separado por `,` `;` o salto de línea. Límite 150 sobre el texto serializado; contador y mensaje en el formulario, sin truncar al pegar |
| `goal` legacy | Derivado de `goals` (fuente de verdad): primer objetivo admitido por la CHECK legacy; solo «Otro» o vacío → `healthy_eating`. Nunca `other` ni `maintenance`. `maintenance` antiguo con `goals` vacío se lee como `healthy_eating` (como la migración 20260608). Sin cambios en las CHECK de `goal`/`goals` |
| Validación | `validateProfileForStorage` con los rangos de la BD (altura, peso, personas, días 0–7, valores de enumeración, `other_goal` y `disliked_foods` ≤ 150); el formulario no guarda si falla y `profileToRow` la repite como barrera |
| Migración `20261007090000_profiles_training_days_0_7` | ✅ local. Sustituye la CHECK 0–5 por 0–7 (solo ampliación). Expectativas con `replaces` en `supabase/expectations/` |
| Tests | `tests/profile-contract.test.cjs` (7, valores antiguos y límites); `test:db` +17: guardar → recargar → leer en otro dispositivo (6 y 7 días, «Otro», alimentos rechazados, vacío → NULL), JSON antiguo, `maintenance`, > 150, 8/−1 rechazados y 6/7 aceptados por la CHECK |
| Comprobaciones | lint, typecheck, test 113/113, build, test:db 324/324 (también tras `db:reset` + `db:seed`). Manual en `npm run dev`: 7 días + «Otro» + «Ganar masa muscular» → BD `goal=muscle_gain`; lista > 150 bloqueada con mensaje (168/150); «pollo,  brócoli / queso azul, Pollo» → `pollo, brócoli, queso azul`; segundo dispositivo (almacenamiento vacío + login) lee todo; cambio allí a 6 días + «setas» leído desde un tercer cliente |
| Pendiente (Sergio, Cowork) | Aplicar la migración en becook-preview (registrar en `applied-preview.json`), validar la Preview de `audit-opt` (6–7 días fallan hasta entonces) y después en producción antes del merge |
| Nota de entorno | La sincronización de `Documents` crea copias « 2»/« 3» dentro de `.next` (caché de Turbopack, `routes.d 2.ts`) y rompe build/typecheck; se resolvió apartando la caché. Hay también un `.git/index 2` sin tocar |

## Pasos del roadmap
| Paso | Iter. | Estado | Nota |
|---|---|---|---|
| 01 Credenciales de recuperación | A1 | ✅ | Archivo retirado + gitleaks (`f6555fd`); códigos regenerados (confirmado por Sergio 2026-10-05) |
| 02 Entorno de pruebas y cambios reproducibles | A1 | ✅ | Local + preview + CI; producción reconciliada y con `enforce_reference_ownership` (2026-10-06); esquemas prod = preview |
| 03 Dependencias | A2 | ✅ | 2026-10-06: next/eslint-config-next 16.2.1→16.3.8, supabase-js 2.49.4→2.117.2 + transitivas; audit 17→5 (riesgo residual aceptado, ver A2) |
| 04 Rutas de IA protegidas | A3 | ✅ | 2026-10-06: sesión verificada en servidor (401), límites 413/415/400, UX invitado con retorno; ver A3 |
| 05 Cuotas y trazabilidad de IA | A4 | ✅ | En producción desde 2026-10-06 (PR #6) |
| 06 Datos locales por identidad | B1 | ✅ | En producción desde 2026-10-07 (PR #8): claves con ámbito, identidad antes que datos; ver B1 |
| 07 Fuente de verdad y sincronización | B1 | ✅ | En producción desde 2026-10-07 (PR #8): remoto canónico, política en `docs/development/data-sync.md` |
| 08 Contrato perfil ↔ BD | B2 | 🟡 | Migración aplicada en preview y producción (2026-10-07); UI validada en Preview por Sergio; falta merge a `main` |
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
| profiles_training_days_0_7 | ✅ | ✅ 20261007122056 | ✅ 20261007143519 |

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
