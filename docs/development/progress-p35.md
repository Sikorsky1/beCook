# Paso 35 — Recorridos críticos con E2E en CI (ola 8)

Rama `audit/p35-e2e` (desde `audit-opt` 59a3309), sin push ni merge. Resumen para integrar en
`PROGRESS.md` al cerrar la ola. Detalle de uso y selectores en `tests/e2e/README.md`.

| Apartado | Estado | Detalle |
| --- | --- | --- |
| Dependencia | ✅ | `@playwright/test` **1.61.1** exacta (devDependency aprobada). Lockfile: solo `@playwright/test`, `playwright`, `playwright-core` y `fsevents` opcional. Sin `playwright install` en el Mac (Chromium 1228 en caché); en CI, Chrome del runner (`E2E_CHANNEL=chrome`) |
| Script | ✅ | `npm run test:e2e` → `scripts/e2e.cjs` |
| OpenAI simulado | ✅ | `tests/e2e/mock-openai.cjs` (`node:http`, solo 127.0.0.1:4010) para `/v1/chat/completions` y `/v1/responses`, por nombre de esquema (`menu_selection` con platos válidos del catálogo de la petición, `dish_substitution`, `imported_menu`, `shopping_list`, `shopping_list_by_dish`, `dish_card`); 120 + 80 tokens por llamada → coste en `ai_usage_events`. Datos en `tests/e2e/fixtures/openai-responses.json` |
| Defensa en `config.ts` | 🟡 | `openAIBaseUrlBlocked()` y `blockedOpenAIEndpointResponse(flow)`: con `VERCEL_ENV=production` y `OPENAI_BASE_URL` → 503 «La generación con IA no está disponible temporalmente…» y log `openai_base_url_blocked` con el flujo (nunca la URL ni la clave). Test `tests/openai-config.test.cjs` (3). **Falta conectarla en las 5 rutas** (ver Pendientes) |
| Orquestador | ✅ | Usa `localApi()`/`sql()` de `local-supabase.cjs` (crea solo el `config.toml` del workspace si falta). Build con variables locales explícitas: nombres de `.env*` vacíos + `__NEXT_PROCESSED_ENV` (Next lista `.env.local` pero no aplica sus valores). Aborta si el bundle no contiene `127.0.0.1:54321`, si algún fichero de `.next` menciona `*.supabase.co` o si aparece cualquier valor de ≥20 caracteres de un `.env*` (probado con un fichero de control). Dos `next start` sobre el mismo build desde el puerto 3100 (nunca 3000): **main** (OpenAI simulado, service role local, sal nueva por ejecución, `AI_IP_HOURLY=10000`, presupuesto 1000 USD, `AI_QUOTA_IMPORT_DAILY=1`) y **budget** (`AI_MONTHLY_BUDGET_USD=0`). Borra `e2e-…@example.invalid` antes y tras una ejecución verde. `--serve` y `E2E_SKIP_BUILD=1` para depurar |
| Recorridos | ✅ | **12 pruebas** (8 de navegador en 390 px, 2 repetidas en 320×568, 4 de API): alta → onboarding (despensa exprés) → propuesta → aplicar → semana → ficha IA → compra → marcar → recargar (390 y 320); invitado importa tabla sin IA y sin peticiones a `/api/*` (390 y 320); aislamiento A/B (RLS por PostgREST, otro navegador y cambio de cuenta en el mismo dispositivo); sin red → «Pendiente de sincronizar» + «Reintentar» → guardado; conflicto de versión entre dos contextos; doble clic en «Usar este menú» (1 semana, versión 1, una sola clave de idempotencia, 7 días); API: 401 en las 5 rutas sin sesión, token falsificado, 429 `daily_quota` con `Retry-After`, 503 `budget_exhausted` |
| Selectores | ✅ | Solo rol/etiqueta/texto; lista de nombres usados en `tests/e2e/README.md`. El plan de P34 aún no estaba publicado: se usan los nombres actuales; se ajustarán al integrar si P34 cambia alguno |
| CI | ✅ | Job `e2e` en `.github/workflows/checks.yml`, en paralelo, 25 min: `db:start`, `db:reset`, `db:seed`, `test:e2e`; sube `playwright-report/` y `test-results/playwright/` solo si falla (7 días; sin logs de servidor). No obligatorio (decisión 2). Sin secretos del repositorio |
| ESLint | ✅ | `tests/e2e/*.cjs` con `require` permitido; ignora `test-results/`, `playwright-report/`, `blob-report/`. `.gitignore` con los mismos directorios |

## Cifras

- E2E local: **12/12** en 4 ejecuciones completas seguidas (dos con build incremental, una con
  JSON, una en frío tras `rm -rf .next`), sin reintentos ni pruebas *flaky* y sin anotaciones
  `postgrest-iat`. Pruebas: 10–13 s con 3 workers; total con build: 17–21 s en este Mac
  (build en frío ~4 s de compilación). OpenAI simulado por ejecución: 6 `menu_selection`,
  5–6 `shopping_list_by_dish`, 2 `dish_card`, 1 `imported_menu`.
- lint ✅, typecheck ✅, `npm test` **443/443** (con `GITLEAKS_BIN`; sin él fallan los 5 de
  `secrets.test.cjs` que necesitan el binario, igual que antes), build ✅.
- Base local: no se ha hecho `db:reset`; usuarios de exploración borrados y `db:seed` al final.

## Hallazgo: PGRST303 en PostgREST local

PostgREST v16.2 local rechaza a veces un JWT recién emitido y válido con «JWT issued at future»
(visto con 2,75 s de antigüedad, mientras otras peticiones simultáneas con el mismo token daban
200): su reloj en caché se queda atrás tras unos segundos sin tráfico. En la app se ve como «No se
ha podido cargar tu cuenta» + «Reintentar» justo después del alta o del inicio de sesión. Los
relojes de los contenedores coincidían. Mitigación en el E2E: petición anónima cada 250 ms durante
la ejecución y, si aun así ocurre en la primera carga, el test pulsa «Reintentar» y lo anota.
No se ha comprobado si la versión de PostgREST alojada (becook, becook-preview) se comporta igual;
convendría revisarlo porque un proyecto con poco tráfico podría mostrar ese error tras el alta.

## Decisiones

- La defensa vive solo en `config.ts` como pide el plan, pero `generate-menu` y `substitute-dish`
  ni siquiera importan ese módulo, así que un efecto al cargar no las cubriría: se deja como
  función explícita que cada ruta debe llamar.
- 320 px solo para los recorridos visuales (etiqueta `@320`); la lógica de datos, a 390. Así una
  ejecución hace ~9 inicios de sesión, bajo el límite de Auth local (30 cada 5 min por IP).
- Identidades por API de administración local + un inicio de sesión por contraseña, con la sesión
  inyectada en `localStorage` (`sb-127-auth-token`); el formulario solo se usa donde se prueba.
- Las casillas y radios con `sr-only` se marcan pulsando su `label`, como una persona.
- CI con `retries: 1` y 2 workers; local sin reintentos para que se vea cualquier inestabilidad.

## Pendientes

1. **Conectar la defensa** (fuera de los ficheros de P35, necesita OK): en cada una de las 5 rutas
   de IA, justo antes de `beginAiUsage`:
   `const blocked = blockedOpenAIEndpointResponse("<flujo>"); if (blocked) return blocked;`
   (`generate-menu`, `substitute-dish`, `import-menu`, `generate-shopping-list`, `dish-card`).
   Alternativa sin tocar rutas: fallar `next build` en `next.config.ts` con esa combinación.
2. Tras integrar P37: recorrido de exportación y borrado de cuenta.
3. Tras integrar P34: ajustar nombres si alguno cambia (lista en `tests/e2e/README.md`).
4. Primera ejecución real del job en GitHub Actions (no probado: sin push).
5. Revisar PGRST303 en los proyectos alojados.
