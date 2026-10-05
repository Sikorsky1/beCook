2026-10-05

# beCook — Plan de implementación del roadmap unificado

Fuente: `docs/audit-2026-09-15/beCook_roadmap_unificado.md` (38 pasos) + auditorías originales (`INFORME.md` backend, PDF UI/UX).
Rama de trabajo: `audit-opt`. Merge a `main` más adelante, decisión de Sergio.

## 1. Estado de partida (verificado hoy)

| Elemento | Estado |
|---|---|
| Código de aplicación (`src/`) | Sin cambios desde la auditoría (`6eebc81`). Los pasos 03–38 siguen pendientes. |
| Paso 01 · credenciales | Archivo retirado del seguimiento + gitleaks + hook (`f6555fd`). **Pendiente:** confirmar que los códigos de Vercel se han regenerado (sigue en el historial). |
| Paso 02 · entorno aislado | Supabase local (Docker) + `becook-preview` + CI (`checks.yml`). Previews de `audit-opt` en Vercel → `becook-preview` (**verificado**). |
| Esquema producción vs preview | Iguales salvo la migración `enforce_reference_ownership` (solo en preview) y los grants (diferencia documentada). Ledger de producción vacío. |
| ⚠️ Datos de producción | No cumplen `enforce_reference_ownership`: 18 `menu_generation_requests` y 12 `pantry_items` con `profile_id` de otro propietario o sin propietario; 4 perfiles y 8 semanas con `user_id` NULL. **Aplicarla tal cual en producción fallaría.** Requiere reconciliación previa. |
| Otras ramas Preview en Vercel | Usan las variables generales = **Supabase de producción**. No crear ramas nuevas sin añadirles variables propias. |

## 2. Reparto de herramientas

| Herramienta | Uso |
|---|---|
| **Claude Code (Mac)** | Implementación: código, `npm install`, Node 24, Docker/Supabase local, `test:db`, build, commits y push. |
| **Cowork** | Planificación, revisión de diffs, migraciones en `becook-preview`/producción vía conector, verificación de despliegues Vercel, seguimiento. |
| **GitHub Actions** | Red de seguridad en cada push: lint, tipos, tests, build y `test:db` en Docker. |

El entorno Cowork en el Mac no tiene red ni Docker: puede editar, pero no instalar dependencias ni probar la base local.

## 3. Flujo de cambios de base de datos (preview → producción)

1. Migración nueva en `supabase/migrations/` (fuente única).
2. Prueba en Supabase local (`db:start`, `test:db`) y CI.
3. Aplicación en `becook-preview` (verificando ID `qdhpdhnpcsfhmygjofqb`); registro en `supabase/hosted/applied-preview.json`.
4. Validación funcional en el Preview de Vercel.
5. Producción (`wejvptpkxlllfpskyisu`) **solo con OK explícito por migración**, backup previo y registro en un nuevo `supabase/hosted/applied-production.json`.
6. Antes del merge a `main`, en producción solo cambios **aditivos** (expand). Borrados/renombrados (contract) después del despliegue del código nuevo.

## 4. Plan por iteraciones

Cada iteración = 1 PR/commit verificable. «BD» indica si toca el esquema (y por tanto preview → producción).
Esfuerzo según auditoría: S ≤ ½ jornada · M 1–2 jornadas · L varias jornadas.

### Iteración 0 — Gobernanza (Cowork, ahora)
- Reglas en `AGENTS.md`: destinos Supabase, flujo del §3, prohibiciones (no `db push`, no reset remoto, no escribir en producción sin OK).
- `PROGRESS.md` en la raíz: estado por paso, para retomar entre sesiones.
- Diagnóstico (solo lectura) de los registros de producción incompatibles con `enforce_reference_ownership` y propuesta de reconciliación.

### Bloque A — Contención (Fase 0 del roadmap)
| It. | Pasos | Contenido | BD | Esf. |
|---|---|---|---|---|
| A1 | 01, 02 | Cierre: confirmación regeneración códigos Vercel; reconciliar datos de producción y aplicar `enforce_reference_ownership` | Sí (prod) | S |
| A2 | 03 | Reauditoría y parches selectivos: Next 16.2.1 → última 16.x parcheada, eslint-config-next, supabase-js, transitivas. Sin cambio de stack | No | S–M |
| A3 | 04 | Sesión verificada en servidor para las 3 rutas de IA; validación de tamaño/tipo; token Supabase en `Authorization` | No | S–M |
| A4 | 05 | Cuotas persistentes por usuario, concurrencia, límite por IP, registro servidor (flujo, modelo, coste, latencia, request ID), timeouts/reintentos en compra e importación | Sí (tabla uso/cuotas + RPC) | M |

### Bloque B — Identidad, guardado y coherencia (Fase 1)
| It. | Pasos | Contenido | BD | Esf. |
|---|---|---|---|---|
| B1 | 06, 07 | Capa de identidad/sesión; cachés por `userId`; remoto canónico para autenticados; importación explícita de datos locales antiguos | No | M–L |
| B2 | 08 | Adaptadores de perfil alineados con el esquema; CHECK entrenamiento 0–5 → 0–7 (ampliación no destructiva); `disliked_foods` texto↔lista; objetivo legacy | Sí (aditivo) | S–M |
| B3 | 09 | Fechas desde año/semana ISO; semana 53; URL sincronizada | No | S–M |
| B4 | 10 | Escritura transaccional de semana (RPC con propietario, versión e idempotencia); edición por slot | Sí (función + columna versión) | M |
| B5 | 11, 15 | Resultados explícitos local/remoto/compra; indicador de sincronización; reintento sin IA | No | M |
| B6 | 12, 14 | Compra ligada a `weekId`/`listId`/`itemId`; lectura remota primero; actualización por artículo; firma de compra sin texto de presentación | Posible (índices; respetar 108 listas existentes) | M |
| B7 | 13 | Despensa remota por artículo con versión y propietario | Posible (columna versión) | M |

### Bloque C — Contrato culinario (Fase 2)
| It. | Pasos | Contenido | BD | Esf. |
|---|---|---|---|---|
| C1 | 16 | Perfil validado en servidor; contexto alimentario congelado por semana (raciones + versión de restricciones) | Sí | M |
| C2 | 17 | Fichas de plato versionadas (ingredientes, cantidades, raciones, tiempo, pasos, alérgenos); slots apuntan a versión | Sí (tablas nuevas) | L |
| C3 | 18 | Validación de restricciones contra ingredientes estructurados; inferido vs revisado | No/Sí | M |
| C4 | 19, 20 | Compra derivada de fichas + raciones + despensa; delta al editar plato sin perder comprados | Sí (origen de artículo) | L |
| C5 | 21 | Reglas culinarias (salsas ambiguas) + sustitución de un slot | No | S–M |
| C6 | 22 | Parseo local de importaciones; borradores por usuario/semana; errores 400/422/502 | Sí (borradores) | M |

### Bloque D — Experiencia (Fase 3)
| It. | Pasos | Contenido | Esf. |
|---|---|---|---|
| D1 | 23 | Alta, login, recuperación de contraseña, retorno a destino | M |
| D2 | 24, 25 | Perfil simplificado sin datos inventados + onboarding de 3 pasos y primer menú | L |
| D3 | 26, 27, 28 | CTA fijo y confirmación propia; generación honesta con cancelación; «Otra idea» por plato | M–L |
| D4 | 29 | Semana con bloque «Hoy» | M |
| D5 | 30, 31 | Compra continua con despensa descontada; Despensa «Tengo / Se acabó»; artículos manuales | M–L |
| D6 | 32, 33, 34 | Navegación de 3 destinos, accesibilidad y táctil, consolidación de componentes | M |

### Bloque E — Validación y apertura (Fase 4)
| It. | Pasos | Contenido | Quién |
|---|---|---|---|
| E1 | 35 | Tests de contrato/RLS A/B, integración de endpoints, E2E (Playwright) en CI. **Se adelantan tests en cada iteración anterior** | Claude Code |
| E2 | 36 | Pruebas en iPhone/Android, redes lentas, Core Web Vitals | Sergio (Claude prepara guion y mide lo automatizable) |
| E3 | 37 | Alertas de errores y presupuesto, backup/restauración, rollback, privacidad, exportación/borrado de cuenta | Mixto; textos legales a revisar por responsable competente |
| E4 | 38 | Beta cerrada y apertura por etapas con criterios de salida | Sergio |

## 5. Decisiones pendientes de Sergio

| # | Decisión | Bloquea | Recomendación |
|---|---|---|---|
| D1 | ¿Regeneraste los códigos de recuperación de Vercel? | A1 | Regenerarlos si no |
| D2 | Política de IA para invitados | A3 | IA solo con sesión (lo que propone el roadmap) |
| D3 | Cuotas: nº generaciones/día por usuario y presupuesto mensual OpenAI | A4 | Proponer cifras iniciales tras A3 |
| D4 | Cómo reconciliar los 30 registros incompatibles de producción (y 12 filas sin propietario) | A1 | Ver diagnóstico de la iteración 0 antes de decidir |
| D5 | Almacenamiento de cuotas/rate limit | A4 | Tabla en Supabase + RPC (sin servicios externos nuevos) |
| D6 | Backups de producción (plan de Supabase / descarga manual) | Primera migración a producción | Confirmar antes de A1 |

## 6. Regla de cierre por iteración

Comprobar que el defecto sigue presente → implementar → tests nuevos + `lint`, `typecheck`, `test`, `test:db`, `build` → CI verde → Preview de Vercel validado → migración a preview/producción si aplica → actualizar `PROGRESS.md`.
