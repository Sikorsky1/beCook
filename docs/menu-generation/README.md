# Reparación del generador de menús — 10 septiembre 2026

La baseline se ejecutó sobre `69b072e` antes de modificar el comportamiento. Se inspeccionaron rutas, prompts completos, configuración, SDK, esquema, validación, frontend, persistencia, autenticación, despensa, compra, historial, migraciones y scripts. No había tests de generación: se añadió un harness que llama al mismo `POST`, con perfiles sintéticos y medición del transporte real de OpenAI.

## Diagnóstico y arquitectura anterior

Navegador → perfil local/Supabase → usuario autenticado → últimas 4 semanas (hasta 2 consultas) → INSERT de petición → POST `/api/generate-menu` → sanitización parcial → prompt → Chat Completions → JSON.parse/validación parcial → respuesta → UPDATE de telemetría → vista previa.

El endpoint no consulta Supabase ni guarda el menú. «Usar este menú» guarda localmente, sincroniza `weeks`/`week_days`, llama por separado a `/api/generate-shopping-list` (Responses API), guarda la compra y marca la petición aplicada. La página de compra puede repetir su llamada si falta caché. Importar texto utiliza otra llamada Chat Completions, independiente de generar.

Modelo anterior: `gpt-5.6-sol`, fallback `gpt-5.6-terra`, reasoning `high`, configurados tanto por defecto como en `.env.local`. SDK OpenAI 6.47.0: 2 reintentos automáticos y timeout de 600 s por intento; sin límite explícito de salida. El fallback podía duplicar los 3 intentos: 1 llamada normal, hasta 6 intentos HTTP. No había un segundo juez ni regeneraciones por validación.

La causa medida de la latencia es el razonamiento: 593–1.582 tokens internos para producir 14 nombres. Ningún caso baseline necesitó retry/fallback. Cambiar únicamente `high` a `none`, conservando el prompt antiguo, llevó A de 38,95 a 8,80 s. La telemetría histórica agregada de Sol también mostraba aproximadamente 50 s de media (20 generaciones) y 103,8 s de máximo.

El prompt anterior repetía alcance semanal, prioridad, dificultad, equilibrio y formato en system y user. No ordenaba explícitamente revisar varias veces: incluso prohibía ciclos repetidos. Pero pedía conciliar unas 15 frecuencias nutricionales (incluyendo 4–7 legumbres y categorías solapadas), variedad, ingredientes principales y estilos. Esa presión favorecía platos construidos para cubrir categorías, pese a las reglas de autenticidad. No era solo un problema de red ni de prompt largo.

## Decisión A frente a B

| Opción | Calidad y cobertura | Latencia/esfuerzo | Decisión |
|---|---|---|---|
| A: reparar generación libre | Conserva peticiones específicas y cobertura amplia; no garantiza identidad por catálogo | Cambio pequeño; quitar reasoning high aporta la mayor mejora medida | Base elegida |
| B: biblioteca cerrada + selección | Control fuerte de identidad si el catálogo está curado y completo | Los archivos solo tienen nombres: faltan ingredientes, variantes, alérgenos y cobertura de dietas. Completarlo ahora añade trabajo y riesgo | Pospuesta |
| Híbrido mínimo | A + 27 referencias reales, filtradas por conflictos visibles; permite recetas fuera del catálogo | JSON local, sin consultas adicionales, embeddings, RAG, solver ni administración | Implementado |

Se mantuvo Sol con `none`: calidad comprobada en los tres perfiles y coste inferior a un céntimo. Terra `none` pasó A en 4,78 s y $0,004638, pero su muestra añadió más acompañamientos independientes. El ahorro absoluto no justificó cambiar el principal con menos evidencia. Terra queda como fallback. Los modelos 4.1-mini/nano presentes en la tabla histórica son opciones económicas, pero no se ejecutó una matriz extensa ni se eligió Astra. Documentación consultada: [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [precios oficiales](https://developers.openai.com/api/docs/pricing).

## Implementación y límites

- Runtime de menú independiente: `MENU_OPENAI_MODEL` (default Sol), `MENU_OPENAI_FALLBACK_MODEL` (default Terra), `none`, Chat Completions + Structured Outputs. Las antiguas variables `OPENAI_*` siguen controlando importación/compra, sin modificar esos flujos.
- El LLM devuelve dos listas de siete nombres. El código construye días ordenados, estados planned y título. Valida tamaño, nombres no vacíos, duplicados normalizados, nombres genéricos concretos y conflictos alimentarios visibles.
- Una llamada normal; máximo dos intentos, SDK retries=0. Fallback solo para conexión/timeout, modelo inexistente y 5xx; no para 400/429, refusals o fallos de validación. Timeout 20 s por intento, `maxDuration=45`, salida máxima 1.200 tokens, propagación de cancelación. No hay regeneración oculta para corregir platos.
- Perfil reducido a restricciones, alergias, gustos, objetivos y entrenamiento; se excluyen identificadores, fecha de nacimiento y medidas corporales que no son necesarias para elegir nombres sin cantidades/calorías. El texto semanal está separado de preferencias permanentes. No se descartan silenciosamente listas de restricciones malformadas.
- Telemetría reutiliza las columnas existentes. Respuesta/log numérico añade tiempos de preparación, OpenAI, parseo, total, intentos, fallback, tokens internos y caché. `Server-Timing` permite inspección HTTP. El navegador registra tiempos de preparación, petición y persistencia en desarrollo. No se registran prompts, platos, perfiles ni claves en la nueva instrumentación.
- `response_time_ms` sigue significando tiempo OpenAI, incluyendo fallback si existe. No representa la experiencia completa del navegador. No se puede separar tiempo interno de razonamiento y decodificación en milisegundos con la respuesta no streaming; sí se observan sus tokens. Supabase es 0 ms dentro del endpoint, y se mide aparte en el navegador.
- Se actualizan precios Sol/Terra y recargo de escritura de caché según documentación consultada. El coste es una estimación Standard, no la factura; un intento fallido sin usage puede tener coste no observable.

**Alergias:** el catálogo solo contiene nombres. Los filtros detectan algunos conflictos inequívocos y las instrucciones añaden otra protección; nunca certifican ausencia de ingredientes ocultos, derivados, trazas o contaminación cruzada. Son conservadores y pueden rechazar sustituciones seguras cuyo nombre todavía mencione el alimento. `otherAllergies` y restricciones expresadas en texto se conservan para el modelo, sin fingir que un regex entiende todos los casos. La compra sigue infiriendo ingredientes desde los nombres: tampoco es una ficha de receta verificada.

**Material real:** se leyeron el adjunto `recetas beCook.numbers` y los dos Numbers de `menu_nutri/`. El adjunto y `recetas ib wellness.numbers` comparten el listado base. `recetas_cesar.numbers` contiene pautas y raciones individuales, que no se convierten en instrucciones generales. También hay PDFs y una imagen físicamente presentes, inventariados, no usados como autoridad nutricional. Se conservan nombres originales y coordenadas de las 27 celdas seleccionadas; no se interpretan las estrellas ni se inventan ingredientes. Los documentos originales sin seguimiento git se mantienen fuera del commit.

Para incorporar de nuevo el adjunto: instalar `numbers-parser==4.19.0` en un entorno temporal y ejecutar `scripts/import-nutritionist.py ARCHIVO.numbers SALIDA.json`. El script comprueba el layout y conserva la procedencia. El resultado se comparó byte a byte con el JSON incluido.

## BEFORE / AFTER

Tres perfiles sintéticos: A convencional; B vegetariano, alergia a frutos secos y rechazo a berenjena; C rechaza normalmente pasta/setas y solicita exactamente dos platos de pasta, uno con setas.

| Caso | BEFORE total/API s | AFTER total/API s | Input antes → después | Output antes → después | Coste antes → después USD |
|---|---:|---:|---:|---:|---:|
| A | 38,95 / 38,90 | 8,86 / 8,80 | 3.582 → 987 | 1.621 → 231 | 0,050327 → 0,008568 |
| B | 48,78 / 48,76 | 7,38 / 7,36 | 3.602 → 762 | 2.034 → 238 | 0,045522 → 0,007808 |
| C | 22,91 / 22,90 | 7,49 / 7,47 | 3.613 → 1.018 | 1.011 → 207 | 0,025117 → 0,008212 |

Media del handler: 36,88 → 7,91 s (−78,6%). Coste medio comparable: $0,040322 → $0,008196 (−79,7%). Coste BEFORE recalculado con las tarifas actuales, incluyendo caché leída/escrita; los JSON BEFORE conservan además la estimación antigua de la aplicación. Output incluye razonamiento; AFTER tiene 0 tokens internos. Prompt system: 11.561 → 2.489 caracteres (−78,5%); system+user A: 14.604 → 3.859 (−73,6%).

Preparación AFTER 15–50 ms; parseo 3 ms. Estas mediciones ejecutan el handler real y la API real; excluyen montaje de Next, navegador, sesión y persistencia. Todos los casos normales hicieron exactamente una llamada, sin retries/fallbacks, HTTP 200 y 7×2 platos válidos. No es un benchmark estadístico ni un SLA de <10 s.

Revisión manual: 0/42 mezclas claramente incoherentes BEFORE y 0/42 AFTER final. La muestra demuestra calidad al menos comparable, no una mejora universal de calidad. Se añadió protección estructural/determinista y referencias reales. La primera ronda AFTER tenía algunos nombres vagos; se corrigió la instrucción y repitieron A/B/C. C final contiene espaguetis con setas y fideuá (fideos), respetando los dos platos de pasta. Véase [revisión de cada plato](quality-review.md) y JSON de las cinco rondas conservadas.

## Validación

- `npm run lint`: pasa sin avisos.
- `npm run typecheck`: pasa.
- `npm test`: 7 tests; estructura y contrato de almacenamiento, duplicados/genéricos, conflictos visibles, precedencia de datos, precios, transporte/fallback y errores HTTP sin llamadas extra.
- `npm run build`: pasa, 17 páginas, Next 16.2.1. Lint/tipos/build se ejecutaron en `/private/tmp/becook-validation`, copia del mismo código con `npm ci` desde el lockfile, porque varios procesos contra las dependencias originales quedaron bloqueados en `read()`. Sin cambios de versiones.
- Supabase real: transacción con contexto authenticated/RLS, lectura de perfil, INSERT/UPDATE de petición y telemetría, semana calendario, siete días, estado applied, compra y despensa. Todas las aserciones pasaron; rollback de todos los registros de prueba. No se cambió esquema ni RLS. Esto comprueba autorización de base de datos, no un login nuevo con contraseña.
- Navegador: generación real y vista previa de 14 platos; «Usar este menú» conserva `2099-W38` y muestra 14–20 septiembre correctamente; compra con 34 ingredientes; marcado de un ingrediente persiste al recargar; despensa, perfil y pantalla de login disponibles. Se probó el modo local sin credenciales; no se realizó un nuevo login con contraseña ni se midió con precisión el tiempo completo del navegador (la API de inspección no expone Performance). No se confunde esta prueba con autenticación integral.
- Los scripts Supabase antiguos insertan sin sesión y algunos leen semanas reales completas; no se usaron para inventar un éxito ni para imprimir datos privados. Se sustituyó esa ejecución por la transacción reversible descrita.

Defectos previos observados: fechas fijas de marzo/abril en la vista previa (`previewDatesByDay`); el guardado usa la identidad ISO seleccionada. El modo sin cuenta permite persistencia local, pero las escrituras remotas anónimas se rechazan por RLS. La lista de compra es una llamada adicional y no está incluida en las latencias anteriores.

## Reproducción y mejoras posteriores

Archivos de implementación: `src/app/api/generate-menu/route.ts`, `src/lib/menu-generation/{prompt,runtime,validation}.ts`, `src/data/nutritionist-recipes.json`, `src/lib/importMenu.ts`, `src/lib/openai/cost.ts`, `src/components/pages/CreateMenuPage.tsx` (solo instrumentación), `src/lib/supabase/menu-generation-requests.ts` (elimina log de ID). Soporte: `package.json`, `eslint.config.mjs`, `scripts/{benchmark-menu.cjs,register-typescript.cjs,import-nutritionist.py}`, `tests/menu-generation.test.cjs` y este directorio de evidencia. No hay cambios visuales ni de esquema.

`npm run benchmark:menu -- /tmp/resultados.json` ejecuta A/B/C contra la API usando `.env.local`, sin escribir en Supabase. `BENCH_CASE=A` limita a un caso; las variables `MENU_OPENAI_*` permiten probar otro runtime de menú. Cada ejecución real tiene coste. Los fixtures no contienen información personal real.

Siguiente mejora recomendada, no implementada: completar ingredientes y alérgenos revisados del catálogo y transportar ese contexto hasta la lista de compra. Después ampliar cobertura y medir más muestras/latencia percentil 95. También corregir las fechas de vista previa y medir/optimizar la llamada independiente de compra. No se añade ahora biblioteca cerrada, RAG ni rediseño.
