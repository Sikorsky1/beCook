# beCook — Progreso del roadmap

Actualizado: 2026-10-09 · Rama: `audit-opt` (= `main` tras PR #11, más B6, C5 paso 21 y D1 paso 23 integrados en local, sin push) · Plan: `docs/development/2026-10-05-plan-implementacion-roadmap.md`
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

## Iteración B2 — Contrato perfil ↔ BD ✅ (2026-10-07, en producción el 2026-10-07)
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
| Producción | [PR #9](https://github.com/Sikorsky1/beCook/pull/9), merge commit `a17d120` (2026-10-07 16:18 UTC), checks en verde. Migración en becook-preview (`20261007122056`) y becook (`20261007143519`) antes del merge; UI validada por Sergio en la Preview. Despliegue be-cook `dpl_37MQ5zomRkhFD7rvEEnKPXPunZLm` READY en `www.becook.xyz` (anterior para rollback: `dpl_3hdkPSnXeFKoGxPjWytuFTBpPsne`). `/login`, `/week`, `/profile` 200 · `/` 307 → `/week` · `POST /api/generate-menu` y `/api/generate-shopping-list` sin sesión 401. `audit-opt` = `main` + commits de documentación |
| Nota de entorno | La sincronización de `Documents` crea copias « 2»/« 3» dentro de `.next` (caché de Turbopack, `routes.d 2.ts`) y rompe build/typecheck; se resolvió apartando la caché. Hay también un `.git/index 2` sin tocar |

## Iteración B3 — Calendario ISO y semana seleccionada ✅ (2026-10-08, en producción el 2026-10-08)
| Elemento | Detalle |
|---|---|
| Defectos reproducidos | `tests/calendar.test.cjs`: 10 de 10 fallan con el código anterior. `parseIsoWeek` aceptaba 2025-W53 (lunes 29-12-2025 = 2026-W01); vista previa con fechas fijas («2 abr» para un miércoles de W41); importar solo el miércoles se mostraba con la fecha del lunes; flechas/«Volver a hoy» sin URL; `truncate` en el título |
| `src/lib/isoWeek.ts` | Única fuente de fechas: aritmética de calendario en UTC (sin efecto de zona ni DST), días lunes–domingo con `dateKey` y etiqueta propia (meses fijos, sin `toLocaleDateString`). «Hoy» = día de calendario en Europe/Madrid (`Intl`, `timeZone`). `weeksInIsoYear`; la semana 53 se **rechaza** en años de 52 (decisión de Sergio), con motivo explícito |
| Selección de semana (`src/lib/weekSelection.ts`) | La URL `?week=YYYY-Www` manda. Sin parámetro: preferencia con ámbito de B1 y, si no hay, semana actual en Madrid (`replace`). Anterior/siguiente/hoy hacen `push` (Atrás funciona). URL inválida → semana actual + aviso visible («2025 no tiene semana 53. Mostramos la semana actual.»). Enlaces antiguos `?isoYear=&isoWeek=` se reescriben. Crear menú usa la misma regla; desaparecen `startDate`/`endDate` |
| Vista previa e importación | Eliminado `previewDatesByDay`. `importedMenuToWeekDays(días, semana)` y `withWeekDates` fechan por nombre del día y ordenan lunes→domingo. Parciales: solo se guardan y muestran los días importados (decisión de Sergio); en `/week` cada tarjeta lleva el id de su posición real y la tira deshabilita los días sin menú |
| Firma de compra | `getWeekSignature` ya no incluye la fecha presentada (día + platos). Las cachés anteriores se aceptan (`matchesWeekSignature`) y se reescriben, sin nueva llamada a la IA. Corrige además que aplicar menú (fechas de vista previa) y abrir Compra (fechas reales) nunca coincidían. Firma completa: B6 |
| Título | Sin `truncate`; forma compacta por debajo de `sm` («31 ago – 6 sept»), año cuando la semana cruza de año («28 dic 2026 – 3 ene 2027», 2 líneas a 320 px); `aria-label` con la forma completa |
| Base de datos | Sin cambios: `week_days` ya guarda `day_name` y `position`. Producción (solo recuentos, 2026-10-07): 21 semanas, 0 semanas 53 inválidas, 0 parciales, 0 nombres de día desconocidos |
| Tests | `tests/calendar.test.cjs` (10, con `TZ=America/Los_Angeles`): semanas 52/53/01 en 2015/2020/2026/2032 y 2021/2024/2025/2027, cruces de año, DST 29-03 y 25-10-2026, «hoy» en Madrid alrededor de medianoche, DST y Nochevieja, parcial solo miércoles / salteados / desordenado, recarga con `?week=`, inválidas y antiguas, anterior/siguiente/hoy con cambio de año, firma |
| Comprobaciones | lint, typecheck, test 123/123, build, test:db 324/324 (también tras `db:reset` + `db:seed`). Manual en `npm run dev` (usuario ficticio A): `/week` → `?week=2026-W41`; siguiente ×2, «Volver a hoy», anterior y Atrás del navegador; carga directa de 2026-W53 → siguiente 2027-W01; `?week=2025-W53` y `/create-menu?week=2027-W53` → semana actual con aviso; `?isoYear=2025&isoWeek=40` → `?week=2025-W40`; importación de miércoles + sábado (respuesta de IA simulada en el navegador, sin clave de OpenAI en local) → vista previa «14 oct / 17 oct», BD `Miércoles/2` y `Sábado/5`, `/week` con tarjetas en sus días; Compra reutiliza la lista (0 llamadas al endpoint). 320/390 px sin desbordamiento ni recorte; sin errores en consola |
| Producción | [PR #10](https://github.com/Sikorsky1/beCook/pull/10), merge commit `806738e` (2026-10-07 22:37 UTC), checks en verde; sin migraciones. UI validada por Sergio en la Preview. Despliegue be-cook `dpl_GXNNPUjw2ZR2VBK4rCCvytpPq3i8` READY en `www.becook.xyz` (anterior para rollback: `dpl_37MQ5zomRkhFD7rvEEnKPXPunZLm`); el bundle servido contiene el código de B3. `/week`, `/create-menu`, `/login` 200 · `POST /api/generate-menu` sin `Authorization` 401. `audit-opt` = `main` por fast-forward antes de este commit de documentación |

## Iteración B4 — Escrituras de semana seguras ✅ (2026-10-08, en producción el 2026-10-08)
| Elemento | Detalle |
|---|---|
| Defectos reproducidos | `scripts/week-write-db-tests.cjs` (en `test:db`), con la migración aplicada y el cliente anterior: **fallan los 6 escenarios** (1 de 1, 2 en 2 de 3 rondas —carrera—, 3 en 3 de 3, 4 en 3 de 3, 5 y 6): fallo a mitad deja la semana a medias; dos guardados paralelos mezclan o pisan; doble clic aplica dos veces; creación simultánea; editar un plato reescribe las 7 filas; una petición de generación ajena se guardaba **sin el vínculo** (reintento genérico de `insertWeekRow`) |
| Migración `20261008090000_week_transactional_writes` | ✅ local, becook-preview y becook. Aditiva: `weeks.version` (bigint, trigger `set_weeks_version` en INSERT/UPDATE), `weeks.request_keys` (≤ 20), `UNIQUE (week_id, position)`, `apply_week` y `update_week_slot` `SECURITY INVOKER`, solo `authenticated`. Resultado `applied | duplicate | conflict`. El reemplazo **conserva `weeks.title`** (la app no lo muestra ni lo escribe; antes se ponía `''`). Expectativas en `supabase/expectations/` (sin `replaces`; `supersedes` documenta la ruta de cliente sustituida) |
| Cliente | `saveWeekToSupabase` (select → update → DELETE → INSERT) y su reintento sin vínculo eliminados; `markMenuGenerationRequestApplied` eliminado (lo hace `apply_week` en la misma transacción). Guardado completo vía `apply_week`, edición de plato vía `update_week_slot` (`saveWeekSlot`). Versión de semana = `weeks.version`, comparada **dentro** de la transacción (sin lectura previa); cachés anteriores con `updated_at` → versión desconocida (gana el remoto). Duplicado → se cachea lo que tiene la cuenta |
| «Usar este menú» | Deshabilitado mientras guarda; clave estable por intento (mismo menú y semana, también al reintentar tras fallo de red); lee la semana remota sin reenviar pendientes (un pendiente rechazado ya no bloquea aplicar un menú) y guarda sobre esa versión; `overwrite` solo tras «Ya hay menú… ¿reemplazarlo?»; sin confirmación, si otro dispositivo crea la semana → conflicto. Mensajes para aplicado / ya aplicado / conflicto / sin conexión. La compra solo se genera tras un guardado correcto (`src/lib/applyWeek.ts`) |
| Despliegue | Compatible: con la migración aplicada, el cliente de `main` (806738e, copia congelada en `tests/fixtures/`) sigue creando y reemplazando semanas; sus escrituras suben la versión y una pestaña nueva con versión anterior recibe conflicto (escenario 7 de `test:db`). Orden: migración → código |
| Política | `docs/development/data-sync.md` actualizado: gana el remoto, versión `weeks.version`, `overwrite` solo tras confirmar, sección «Escrituras de semana (B4)» |
| Tests | `tests/week-writes.test.cjs` (12): mapeo de resultados, versiones, días por nombre, clave por intento, mensajes, conflicto, duplicado, error sin reintento, edición por comida, pendientes y pendiente atascado. `test:db` +14 (6 escenarios, 3 rondas en los concurrentes, + 2 de despliegue) |
| Comprobaciones | lint, typecheck, test 135/135, build, test:db 338/338 (tras `db:reset` + `db:seed`). Manual en `npm run dev` (usuario ficticio A, importación simulada en el navegador): aplicar en semana vacía (W45, sin pregunta, versión 1, una clave) y reemplazar (W44, una sola confirmación) con **doble clic real** → botón deshabilitado, una sola aplicación; editar un plato → solo esa comida, mismas filas; dos pestañas (comparten almacenamiento: la segunda edición se guarda sin pisar la primera); cambio de «otro dispositivo» por SQL → conflicto, nada escrito y aviso con la versión de la cuenta |
| Observaciones | Un pendiente que el servidor rechaza siempre queda `pending` hasta la siguiente carga (resultados explícitos y reintento: B5). Tras editar un plato, la caché guarda la copia de la pestaña con la versión nueva hasta la siguiente revalidación. El script manual desactivado `scripts/test-save-week.ts` se eliminó (usaba la ruta borrada) |
| Producción | [PR #11](https://github.com/Sikorsky1/beCook/pull/11), merge commit `5a573ff` (2026-10-08 21:33 UTC), checks en verde (application, database, Vercel). Migración aplicada antes del merge, registrada en remoto en varias partes: becook-preview `20261008205929` `_columns`, `20261008205940` `_version_trigger`, `20261008210218` `_update_week_slot`; becook `20261008211358` `backup_before_b4`, `20261008211427` `_columns`, `20261008211456` `_version_trigger`, `20261008211526` `_update_week_slot` (ninguna entrada se llama `apply_week`). Comprobado por metadatos en ambos: columnas, `UNIQUE`, CHECK, trigger, `apply_week`/`update_week_slot` con EXECUTE solo `authenticated` y definiciones idénticas entre proyectos. Despliegue be-cook `dpl_DkQ7Zv1LwPuZoueVDcCJK98vaZFA` READY en `www.becook.xyz` (anterior para rollback: `dpl_GXNNPUjw2ZR2VBK4rCCvytpPq3i8`). `/week`, `/create-menu`, `/login` 200 · `/` 307 · `POST /api/generate-menu` sin `Authorization` 401. `audit-opt` = `main` por fast-forward antes de este commit de documentación. Falta registrar la migración en `supabase/hosted/applied-*.json` |

## Iteración B6 — Compra ligada a su semana y firma estable 🟡 (2026-10-09, integrada en `audit-opt`, sin aplicar en remoto)
Pasos 12 y 14 del roadmap (H7; §5, §9, §13).

| Elemento | Detalle |
|---|---|
| Defectos reproducidos | Script contra Supabase local con el cliente anterior (6164872): **dos marcados → 3 listas y 9 artículos** (una lista completa por clic); **volver a aplicar los mismos platos** (`apply_week` sube `updated_at`) → la lista remota se da por caducada → nueva llamada a la IA y marcados perdidos; un dispositivo **con caché no ve los 2 marcados** hechos en otro (la caché se leía antes que la cuenta). Además, por lectura de código: marcar antes de resolver `remoteWeekId` no guardaba nada, y salir de Compra abortaba la generación y la relanzaba al volver (la doble compra en 1 min observada en A4) |
| Migración `20261009090000_shopping_list_per_week` | ✅ local. Aditiva: `shopping_lists.week_signature` (NULL en las listas existentes, CHECK 1–8000), índice `(week_id, created_at DESC, id DESC)`, `save_shopping_list` y `set_shopping_items_checked` `SECURITY INVOKER`, solo `authenticated`. **No modifica filas existentes**: las listas antiguas quedan como historial. Expectativas en `supabase/expectations/` (sin `replaces`; `supersedes` documenta la ruta de cliente sustituida) |
| Lista vigente | La más reciente de su semana; la lista se busca por la semana del usuario (`auth.uid`, año, semana), nunca por «la última creada». Cambiar de platos crea una lista nueva y conserva la anterior |
| Firma de compra (paso 14) | `getShoppingSignature`: semana ISO + platos por posición (normalizados: mayúsculas, espacios; un día libre entero = sin día) + raciones + restricciones + origen de ingredientes (`shoppingListContext`: 2 personas, sin restricciones, `dish-titles-v1`, preparado para C1/C2). Sin fechas ni `weeks.version` (sube en cualquier escritura, también al aplicar el mismo menú); la versión es solo guarda de concurrencia al guardar. Listas sin firma: regla anterior (generada después del último cambio). Cachés de B3 y anteriores aceptadas y reescritas |
| Cliente (`src/lib/data/shopping.ts`) | Lectura: lista de la cuenta → copia del dispositivo solo si la cuenta no responde (aviso) → sin copia, error con «Reintentar» y **sin generar**. IA solo si la cuenta confirma que no hay lista para ese contenido. Marcar = `set_shopping_items_checked` del artículo (fijar valor, en cola por semana, el último gana); lista sustituida → `stale`, no escribe y se relee. Sin conexión: marcados `pending` reenviados al cargar; lista generada sin guardar se guarda después **sin IA**. Una generación por contenido, no se cancela al salir de la página. «Usar este menú» usa `ensureShoppingList` (mismo menú → misma lista y marcados) |
| Eliminado | `saveShoppingListToSupabase` (INSERT de lista completa), `syncShoppingListToSupabase`, `generateAndCacheShoppingListForWeek`, `getRemoteWeekId`, `loadRemoteShoppingList` y el script desactivado `scripts/test-save-shopping-list.ts` (usaba la ruta borrada y «la última semana») |
| Despliegue | Compatible: con la migración aplicada, el cliente de `main` (5a573ff, copia congelada en `tests/fixtures/legacy-shopping-client-5a573ff.ts`) sigue guardando y leyendo listas, y el cliente nuevo reutiliza su lista más reciente sin IA y la marca en su sitio (escenario 8 de `test:db`). Orden: migración → código |
| Política | `docs/development/data-sync.md`, sección «Lista de la compra (B6)» |
| Tests | `tests/shopping-week.test.cjs` (17): firma, generación única y reutilización, marcado por artículo, segundo dispositivo y caché antigua, mismo menú otra vez, cambio de plato con historial, semana pasada, lista sustituida (`stale`), marcado sin conexión, lista generada sin conexión, cuenta inalcanzable sin copia, dos llamadas simultáneas → 1 IA, dos dispositivos → 1 lista, semana cambiada al generar, listas sin firma, invitado, marcados rápidos en orden. `tests/calendar.test.cjs` adaptado a la firma nueva. `test:db` +12 (`scripts/shopping-db-tests.cjs`): 5 recorridos, concurrencia (3 rondas), versión/validación, permisos (otro usuario, anon, artículos de dos listas) y 2 de despliegue |
| Comprobaciones | lint, typecheck, test 152/152, build, test:db 350/350 (también tras `db:reset` + `db:seed`). `npm run dev` en :3000: `/shopping/list`, `/week`, `/create-menu`, `/login` 200; `POST /api/generate-shopping-list` sin sesión 401. **Sin prueba manual en navegador** (extensión de Chrome no disponible en esta sesión): pendiente |
| Observaciones | Editar un plato sigue regenerando la lista entera (los marcados de la anterior quedan en el historial); el delta por ingrediente es C4 (paso 20). La pantalla sigue leyendo la semana seleccionada del dispositivo, no `?week=`. Estados de guardado completos y reintento visible por entidad: B5 |
| Pendiente | Prueba manual en navegador (Sergio); aplicar la migración en becook-preview y registrarla en `supabase/hosted/applied-preview.json`; validar la Preview; producción con OK explícito y backup previo. Antes de producción, solo recuentos: listas por semana y listas con `week_signature` NULL (todas lo serán) |
| Integración | 2026-10-09: `audit/p23-login`, `audit/p21-reglas` y `audit/b6-compra` integradas en `audit-opt` (en ese orden, `merge --no-ff`, sin conflictos). Tras cada merge: lint, typecheck, test y build en verde (147 → 167 → 184 tests). Con todo junto: `db:reset` + `db:seed` + `test:db` 358/358. Sin push |

## Iteración C5 — Reglas culinarias y sustitución selectiva 🟡 (2026-10-09, integrada en `audit-opt`; falta CI y Preview)
Paso 21 del roadmap.

| Elemento | Detalle |
|---|---|
| Defectos reproducidos | Con el código anterior: `selectionToMenu` aceptaba un menú con «Pollo con salsa especial»; «Espaguetis al pesto» pasaba como compatible con vegano y sin lactosa (el pesto lleva queso); no existía forma de cambiar un plato sin regenerar la semana. `tests/dish-substitution.test.cjs` y la entrada nueva de `tests/ai-routes.test.cjs` fallan con el código anterior |
| Reglas culinarias (`src/lib/menu-generation/culinary-rules.ts`) | Se rechazan los títulos indeterminados: «salsa» sin decir cuál («con salsa», «su salsa», «salsa casera»), y salsa, aliño, aderezo, marinada, adobo, guarnición, acompañamiento o relleno con calificativo vago («especial», «secreta», «de la casa», «del chef», «al gusto», «a elegir», «sorpresa»…), además de «ingrediente/toque secreto». Se admiten las salsas concretas («de tomate», «de yogur y eneldo», «verde», «brava», «teriyaki», «bechamel», «al pesto», «a la vizcaína») y los nombres tradicionales («albóndigas en salsa», «bacalao al pil pil»). Solo rechazan: nunca se arregla un título inventando ingredientes. Las 27 recetas del catálogo pasan |
| Generación de menú | `selectionToMenu` aplica las reglas (`ambiguous_dish` → 422, sin regenerar, como ya ocurría con los platos genéricos). El prompt pide nombrar siempre la salsa. `pesto` y `carbonara` cuentan como lácteo en `visibleFoodConflict` (vegano y sin lactosa) |
| Sustitución (`src/lib/menu-generation/substitution.ts`) | «Otra idea» para una comida: (1) siguiente receta del **catálogo revisado** compatible con el perfil (restricciones, alergias, alimentos que no gustan y términos de «otras alergias» visibles en el título), distinta del plato actual, de las ideas descartadas y de los otros 13 platos, primero las del mismo momento (comida/cena). Local, sin IA ni coste. (2) Si el catálogo se agota, **un único intento acotado de IA**, solo si el usuario lo pide. La propuesta se revalida contra el menú completo (duplicados en la semana, restricciones, genérico, reglas culinarias) y `validateSubstitutedWeek` comprueba que los otros 13 platos no cambian |
| Ruta `POST /api/substitute-dish` | Guard de A3 (sesión, 415, 16 KB, 400). Si el catálogo tiene alternativa, la devuelve sin abrir registro de uso. Si no: `beginAiUsage` con **flujo `menu`** (decisión de Sergio del 2026-10-09: sin migración; cada idea de IA cuenta como 1 de los 4 menús/día y 20/mes), modelo de menú, `reasoning_effort: none`, 120 tokens, 15 s, **sin reintento ni modelo de respaldo**. Salida inválida → 422 con motivo (`invalid_output:<motivo>`); fallo de OpenAI → 502; cuota → 429. Coste, tokens y motivo en `ai_usage_events` (`ai_finish_request`); log `dish_substitution` sin platos, perfil ni IDs. `maxDuration` 30 s |
| Interfaz (`/week`) | Al editar una comida aparece «Otra idea»: rellena el campo con la propuesta y su origen («Receta del catálogo revisado» / «Idea propuesta por IA»); cada nueva petición descarta la anterior. Con el catálogo agotado: identificado → «Pedir idea a la IA» con aviso de que cuenta como un menú; invitado → enlace de inicio de sesión (nunca llama a la API). **Guardar** usa el guardado de una sola comida de B4 (`saveWeekSlot` → `update_week_slot`, sin cambios), con su manejo de conflictos. No se ofrece ninguna idea hasta haber leído el perfil de la identidad actual (un perfil vacío saltaría las alergias) |
| Base de datos | Sin cambios ni migraciones. Sin `test:db` nuevo: la escritura es `update_week_slot`, ya cubierta en B4 (solo cambia esa comida, versión e idempotencia) |
| Tests | `tests/dish-substitution.test.cjs` (13): reglas (13 rechazos, 15 aceptaciones, catálogo completo), pesto, menú con plato ambiguo rechazado, idea de catálogo compatible/nueva/no descartada y orden por momento, catálogo agotado, perfil malformado, los 8 motivos de rechazo, los otros 13 platos intactos, límites de la petición; ruta: catálogo sin IA ni cuota, IA en un intento con flujo `menu` y coste, 4 salidas inválidas → 422 sin reintento, 503 → 502 sin respaldo, cuota 429 antes de OpenAI, 400 antes de cobrar, sin platos en logs. `tests/ai-routes.test.cjs` +7 (la nueva ruta en la batería de A3: 401, token inválido, Auth caída, 415, 413, 400, 200) |
| Comprobaciones | lint, typecheck, test 155/155, build. `test:db` ejecutado en la integración (sin cambios de esquema). Manual en `next dev` (puerto 3002) **como invitado, sin Supabase ni OpenAI** (variables vacías que tienen prioridad sobre `.env.local`, que apunta a producción), con Chromium headless por CDP: semana W41 y perfil vegetariano + «brócoli» en almacenamiento local → 4 ideas del catálogo, todas compatibles y distintas; luego aviso de catálogo agotado con enlace de login; guardar → solo cambia «Martes/comida»; 320 px sin desbordamiento; sin errores en consola. `POST /api/substitute-dish` sin sesión → 401 |
| Pendiente | CI tras el push; prueba identificada en local o en la Preview con IA (catálogo agotado → «Pedir idea a la IA», registro en `ai_usage_events` con flujo `menu`, cuota del día); validación de la Preview; merge. No se ha probado la ruta de IA con OpenAI real |
| Observaciones | El catálogo es pequeño (27 recetas; 5 compatibles con vegano y 4 tras quitar el pesto), así que con restricciones se agota pronto y se llega a la IA. Las ideas de IA no se distinguen de los menús en `ai_usage_events` (mismo flujo); solo en el log `dish_substitution`. Si se quiere una cuota propia, hace falta migración (`flow` admite solo `menu`, `import`, `shopping`). La edición manual de un plato y los menús importados siguen sin pasar por las reglas (paso 22: advertir sin modificar la elección del usuario). «Otra idea» en la vista previa de Crear menú es el paso 28 (D3) |
| Integración | 2026-10-09: `audit/p23-login`, `audit/p21-reglas` y `audit/b6-compra` integradas en `audit-opt` (en ese orden, `merge --no-ff`, sin conflictos). Tras cada merge: lint, typecheck, test y build en verde (147 → 167 → 184 tests). Con todo junto: `db:reset` + `db:seed` + `test:db` 358/358. Sin push |

## Iteración D1 — Alta, login y recuperación de cuenta 🟡 (2026-10-09, integrada en `audit-opt`; falta configurar Auth remoto)
Paso 23 del roadmap.

| Elemento | Detalle |
|---|---|
| Defectos reproducidos | `tests/account-flows.test.cjs`: 7 de 12 fallan con el código anterior (los otros 5 prueban el módulo nuevo de mensajes). Login siempre a `/profile` sin `next`; `safeNextPath` aceptaba `/login?next=…` (posible bucle); alta sin `next` y siempre a `/profile`; sin recuperación de contraseña ni página de retorno del email; errores de Auth en inglés tal cual (`error.message`); texto de alta con «Supabase»; el aviso de sesión caducada volvía a la ruta **sin** `?week=` y perdía el borrador de Crear menú |
| Navegación (`src/lib/navigation.ts`) | Destino por defecto tras login: `/week`; tras alta sin destino: `/profile` (cuenta nueva sin preferencias; lo revisará D2). Las pantallas de cuenta (`/login`, `/signup`, `/forgot-password`, `/reset-password`, `/auth/*`, también con mayúsculas, barra final o escapes) nunca son destino → sin bucles. `authHref` conserva `next` entre pantallas; `authRedirectUrl` construye los enlaces de email |
| Flujos (`src/lib/auth/account.ts`) | Cliente inyectado y resultados explícitos: `signInWithEmail`, `signUpWithEmail` (`signed_in` / `confirm_email`), `resendSignupConfirmation`, `requestPasswordReset`, `updatePassword`, `readAuthLinkError`. Mensajes en español por código de Auth (credenciales, email sin confirmar, cuenta existente, contraseña débil o repetida, límites de envío, sin conexión, enlace caducado); nunca el texto del proveedor. Contraseña nueva ≥ 8 caracteres en cliente. Recuperación con respuesta neutra (no revela si el email tiene cuenta); el alta con confirmación activa tampoco |
| Pantallas | `/login` (enlace «¿La has olvidado?», reenvío de confirmación si falta, «Ya has iniciado sesión» con Continuar en vez de redirigir solo), `/signup` (pantalla «Revisa tu email» con reenvío), `/forgot-password`, `/reset-password` (enlace caducado/usado → explicación y «Pedir otro enlace»; éxito → Continuar al destino), `/auth/callback` (retorno del email de alta; error → reenvío o login). Todas con `next`, `replace` al terminar (Atrás no vuelve al formulario), etiquetas asociadas, `role="alert"/"status"`, ancho máximo `max-w-md`. Texto centrado en guardar menú, compra y despensa entre dispositivos; sin «Supabase». «Seguir sin iniciar sesión» vuelve al destino pedido |
| Sesión caducada | El aviso no aparece en las pantallas de cuenta; «Iniciar sesión» vuelve a la página actual **con su consulta** (`?week=`) y antes ejecuta los guardados de borrador registrados (`src/lib/session/login-return.ts`); Crear menú registra el suyo. Perfil «Entrar o crear cuenta» → `/login?next=/profile`. Navegación inferior: Perfil activo en todas las pantallas de cuenta |
| Base de datos | Sin cambios ni migraciones |
| Tests | `tests/account-flows.test.cjs` (12). `tests/ai-routes.test.cjs`: destino por defecto `/profile` → `/week`. `scripts/auth-db-tests.cjs` en `test:db` (+7, ejecutados en la integración): alta, contraseña errónea, alta duplicada, recuperación neutra, enlace de recuperación → `/reset-password?next=` con sesión, contraseña nueva sustituye a la anterior, enlace reutilizado rechazado, `redirectTo` ajeno no se respeta. Usa `generateLink` (no envía emails) y borra el usuario |
| Comprobaciones | lint, typecheck, test 147/147, build (rutas nuevas estáticas). `test:db` ejecutado en la integración (ver fila Integración). Recorrido real contra Auth local en `next dev` :3001 (script Node, sin navegador: la extensión de Chrome no estaba conectada): alta con sesión inmediata; contraseña errónea → mensaje en español; recuperación → email real en Mailpit → 303 a `http://127.0.0.1:3001/reset-password?next=%2Fshopping%2Flist%3Fweek%3D2026-W41` con sesión `recovery`; página 200; contraseña cambiada (antigua rechazada, nueva acepta); mismo enlace otra vez → `otp_expired` → «El enlace ha caducado o ya se ha usado». Usuario de prueba borrado. Las 5 pantallas responden 200 |
| Pendiente (remoto, no tocado) | **Supabase Auth, becook (producción)**: Site URL `https://becook.xyz`; Redirect URLs `https://becook.xyz/auth/callback`, `https://becook.xyz/reset-password`, `https://www.becook.xyz/auth/callback`, `https://www.becook.xyz/reset-password` (las URLs llevan `?next=…`; si se prefiere comodín: `https://becook.xyz/**` y `https://www.becook.xyz/**`). **becook-preview**: `https://*-sikorsky1991.vercel.app/**` (Preview de `audit-opt`) y `http://127.0.0.1:3000/**`. Plantillas de email en español (hoy en inglés, p. ej. «Reset your password»): «Confirma tu cuenta de beCook» y «Crea una contraseña nueva para beCook», con `{{ .ConfirmationURL }}`. Decidir confirmación de email en producción (la app soporta ambos modos; recomendado activarla antes del registro abierto), longitud mínima de contraseña en Auth = 8 (coherente con el cliente) y protección de contraseñas filtradas (auditoría §11). SMTP propio antes de abrir: el SMTP por defecto de Supabase limita mucho los envíos |
| Pendiente (manual, Sergio) | Probar en navegador/móvil: alta (con y sin confirmación), login con `next`, recuperación con un email real en Preview tras configurar las URLs, sesión caducada en Crear menú (borrador y semana conservados) |
| Decisiones a confirmar | Destino por defecto tras login `/week` y tras alta `/profile`; contraseña nueva ≥ 8 en cliente; una sesión ya iniciada que abre `/reset-password` puede cambiar la contraseña sin la anterior (comportamiento por defecto de Supabase con `secure_password_change = false`) |
| Integración | 2026-10-09: `audit/p23-login`, `audit/p21-reglas` y `audit/b6-compra` integradas en `audit-opt` (en ese orden, `merge --no-ff`, sin conflictos). Tras cada merge: lint, typecheck, test y build en verde (147 → 167 → 184 tests). Con todo junto: `db:reset` + `db:seed` + `test:db` 358/358. Sin push |

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
| 08 Contrato perfil ↔ BD | B2 | ✅ | En producción desde 2026-10-07 (PR #9): días 0–7, `goal` legacy derivado de `goals`, `disliked_foods` como texto; ver B2 |
| 09 Calendario ISO | B3 | ✅ | En producción desde 2026-10-08 (PR #10): URL `?week=`, fechas por nombre de día, semana 53 rechazada; ver B3 |
| 10 Escrituras de semana seguras | B4 | ✅ | En producción desde 2026-10-08 (PR #11): `apply_week`/`update_week_slot`, versión e idempotencia; ver B4 |
| 11 Aplicar menú ≠ generar compra | B5 | ⏳ | |
| 12 Compra ligada a su semana | B6 | 🟡 | Integrado en `audit-opt` (2026-10-09): lista vigente por semana, lectura remota primero, marcado por artículo; migración solo local; ver B6 |
| 13 Despensa remota segura | B7 | ⏳ | |
| 14 Firma de compra estable | B6 | 🟡 | Integrado en `audit-opt` (2026-10-09): firma canónica sin fechas ni versión; mismo menú → misma lista; ver B6 |
| 15 Estados de sincronización visibles | B5 | ⏳ | |
| 16 Contexto alimentario por semana | C1 | ⏳ | |
| 17 Fichas de plato versionadas | C2 | ⏳ | |
| 18 Validación de restricciones | C3 | ⏳ | |
| 19 Compra desde recetas y despensa | C4 | ⏳ | |
| 20 Reconciliar cambios de plato | C4 | ⏳ | |
| 21 Reglas culinarias y sustitución | C5 | 🟡 | Integrado en `audit-opt` (2026-10-09): reglas de títulos, «Otra idea» con catálogo y luego IA (flujo `menu`); ver C5 |
| 22 Importación y borradores | C6 | ⏳ | |
| 23 Alta, login y recuperación | D1 | 🟡 | Integrado en `audit-opt` (2026-10-09): alta, login con `next`, recuperación; falta Auth remoto (URLs, plantillas); ver D1 |
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
| week_transactional_writes | ✅ | ✅ 20261008205929, 20261008205940, 20261008210218 | ✅ 20261008211358 (backup_before_b4), 20261008211427, 20261008211456, 20261008211526 |
| shopping_list_per_week | ✅ | ✅ 20261009154554 | ⏳ |

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
| D7 | «Otra idea» con IA cuenta en el flujo `menu` (1 de los 4/día y 20/mes), sin migración de cuota propia | 2026-10-09 |
