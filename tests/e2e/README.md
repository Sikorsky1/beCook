# E2E de beCook (paso 35)

Recorridos críticos con Playwright 1.61.1 contra Supabase **local**, un OpenAI **simulado** y un
build de producción de Next hecho solo con variables locales. No hay ninguna llamada real a OpenAI
ni a un proyecto Supabase alojado.

## Ejecutar

```sh
npm run db:start      # contenedor dedicado becook-iteration02
npm run db:seed
npm run test:e2e      # build + servidores + Playwright (2–3 min en un Mac; ~12 s de pruebas)
```

- `npm run test:e2e -- --grep conflicto`: los argumentos extra van a Playwright.
- `E2E_SKIP_BUILD=1 npm run test:e2e`: reutiliza el último build del E2E (se vuelve a comprobar).
- `node scripts/e2e.cjs --serve`: deja los servidores arriba para depurar (Ctrl+C).
- Informe: `playwright-report/` (HTML) y trazas de los fallos en `test-results/playwright/`.
  Logs de los servidores en `test-results/servers/`.
- Navegador: localmente, el Chromium en caché de Playwright 1.61.1 (`chromium-1228`); si falta,
  `E2E_CHANNEL=chrome` usa el Chrome instalado. No hace falta `npx playwright install` en el Mac.

## Qué hace `scripts/e2e.cjs`

1. Verifica el contenedor y obtiene URL, clave anónima y service role locales con `localApi()` de
   `scripts/local-supabase.cjs` (la URL tiene que ser `http://127.0.0.1:54321`).
2. **Build aislado de `.env.local`**: lee solo los *nombres* de los `.env*` y los pasa vacíos al
   subproceso (Next nunca sustituye una variable ya definida), añade `__NEXT_PROCESSED_ENV` para
   que Next no cargue ficheros `.env*` y fija `NEXT_PUBLIC_SUPABASE_*` locales. Después comprueba
   el bundle: el cliente contiene `127.0.0.1:54321` y ningún fichero de `.next` menciona un
   proyecto `*.supabase.co`; si no, aborta antes de arrancar nada. El build queda en `.next`
   (un `npm run build` posterior lo sustituye).
3. Borra las identidades sintéticas `e2e-…@example.invalid` de ejecuciones anteriores.
4. Arranca el OpenAI simulado (`mock-openai.cjs`, `127.0.0.1:4010` o el siguiente libre) y dos
   `next start` sobre el mismo build (puertos desde 3100; nunca 3000):
   - **main**: `OPENAI_BASE_URL` → simulado, `OPENAI_API_KEY=sk-test-e2e-local`, service role
     local, `AI_IP_HASH_SALT` nuevo en cada ejecución, `AI_IP_HOURLY=10000`, presupuesto 1000 USD,
     `AI_QUOTA_IMPORT_DAILY=1` (para el 429) y el resto de cuotas como en D3.
   - **budget**: igual con `AI_MONTHLY_BUDGET_USD=0` (para el 503 por presupuesto).
5. Mantiene despierto el reloj de PostgREST (ver «Problemas conocidos») y lanza Playwright.
6. Si todo pasa, vuelve a borrar las identidades sintéticas (en un fallo se conservan para depurar).

## OpenAI simulado

`node:http` sin dependencias, solo en `127.0.0.1`. Atiende `/v1/chat/completions` y
`/v1/responses` según el nombre del esquema (`menu_selection`, `dish_substitution`,
`imported_menu`, `shopping_list`, `shopping_list_by_dish`, `dish_card`) con
`fixtures/openai-responses.json` y 120 + 80 tokens por llamada, así que el registro de uso guarda
coste igual que en producción. Para `menu_selection` elige 7 comidas y 7 cenas válidas del catálogo
que manda la petición. La librería `openai` lee `OPENAI_BASE_URL`; en producción de Vercel esa
variable está prohibida (`blockedOpenAIEndpointResponse` en `src/lib/openai/config.ts`).

## Recorridos

| Fichero | Recorrido | Proyectos |
| --- | --- | --- |
| `recorrido-principal.spec.ts` | Alta por formulario → onboarding (con despensa exprés) → propuesta → «Usar este menú» → Semana → ficha estimada por IA → Compra → marcar → recargar | 390 y 320 |
| `invitado-importa.spec.ts` | Invitado pega una tabla, se ordena sin IA (cero peticiones a `/api/*`), «Solo en este dispositivo», recarga | 390 y 320 |
| `aislamiento.spec.ts` | A y B: RLS (B no lee semana, días ni listas de A), otro navegador como B y cambio de cuenta en el mismo dispositivo | 390 |
| `sincronizacion.spec.ts` | Sin red (`route.abort` sobre `/rest/v1/**`) → «Pendiente de sincronizar» + «Reintentar» → guardado; conflicto de versión entre dos contextos; doble clic en «Usar este menú» (una semana, versión 1, misma clave) | 390 |
| `api.spec.ts` | `request`: 401 sin sesión en las 5 rutas de IA, token falsificado, 429 por cuota diaria con `Retry-After`, 503 por presupuesto | sin navegador |

Las identidades se crean con la API de administración local y **un** inicio de sesión por
contraseña cada una: Auth local admite 30 altas/inicios cada 5 minutos por IP. Una ejecución usa
unas 9; tres ejecuciones seguidas en menos de 5 minutos pueden llegar al límite.

## Selectores y nombres accesibles

Solo `getByRole` / `getByLabel` / `getByText`. Si una pantalla cambia un nombre, hay que ajustar
aquí. Nombres en los que se apoyan (lista de P34 «nombres congelados» incluida):

- h1: «Crea tu cuenta», «Bienvenido a beCook», «Para quién cocinas y qué necesitas»,
  «¿Qué tienes ya en casa?», «Prepara tu menú semanal», «Tu compra»; h2 «Revisa tu semana».
- «Navegación principal» → enlace «Compra».
- Alta: campos «Email», «Contraseña», «Repite la contraseña»; botón «Crear cuenta».
  Login: «Email», «Contraseña», «Entrar». Perfil: «Cerrar sesión», «Entrar o crear cuenta».
- Onboarding: «Empezar», grupo «Personas» (radio «2»), «Comer más saludable», grupos
  «Restricciones alimentarias» y «Alergias» (casilla «Ninguna»), «Guardar y continuar», grupo
  «Despensa exprés» (botones con `aria-pressed`), «Terminar y crear mi menú» / «Saltar y crear mi menú».
- Crear menú: «Crear menú semanal», región «Usar la propuesta» con «Usar este menú» y su estado
  «Menú guardado en tu cuenta.», «Ver mi semana», «Otra idea para la comida del lunes».
  Importar: cuadro «Pega tu menú de la semana», «Procesar menú».
- Semana: botones «Comida de hoy: X. Ver ficha» / «Comida del Martes: X. Ver ficha»; diálogo con
  el nombre del plato, «Crear ficha estimada (IA)», regiones «Ingredientes» y «Pasos», «Cerrar»,
  «Cambiar plato de la comida del Martes», cuadro «Comida del Martes», «Guardar comida de Martes».
  Vacía: «No hay menú para esta semana».
- Compra: casillas «Huevos, 14 ud» (se busca por el nombre, no la cantidad), «N/M comprados»,
  «2 raciones por comida», vacía «No hay una semana guardada.».
- Estados (B5): «Guardado en tu cuenta», «Solo en este dispositivo», «Pendiente de sincronizar» /
  «Error: reintentar» y botón «Reintentar»; conflicto «Tu cuenta tenía cambios más recientes de otro dispositivo».

## Problemas conocidos

- **PGRST303 «JWT issued at future» en PostgREST local (v16.2)**: tras unos segundos sin
  peticiones, su reloj en caché se queda atrás y rechaza tokens recién emitidos y válidos (visto
  con 2,75 s de antigüedad). La app muestra «No se ha podido cargar tu cuenta» con «Reintentar».
  El orquestador hace una petición anónima cada 250 ms para evitarlo; si aun así pasa en la
  primera carga, el test pulsa «Reintentar» (como haría una persona) y lo deja anotado como
  `postgrest-iat` en el informe.
- Pendiente tras integrar P37: recorrido de exportación y borrado de cuenta.
