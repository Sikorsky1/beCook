# Iteración 02 — Entorno de pruebas y cambios reproducibles

Fecha: 2026-09-23. Estado de la entrega original: **parcialmente completada**.

Actualización posterior: ver [cierre de la iteración 02B](iteration-02b.md).
Este documento conserva el diagnóstico y los resultados previos a la corrección.
La base independiente se reconstruye y se puede probar; el aislamiento referencial
completo no pasa. No se han modificado las políticas para ocultar esos defectos.

## A. Estado inicial

- Rama `audit-opt`; HEAD `f6555fd7cb26ddaf15eb84b72d1ffb4acdb22941`.
- Se conservaron los seis cambios previos: dos PDF eliminados de su ubicación
  anterior, sus dos copias no seguidas en `original_audit` y dos archivos del roadmap.
- `supabase/` solo contenía tres migraciones: RLS de hijos (20260607), objetivos
  de perfil (20260608), calendario ISO (20260611). Ninguna creaba las tablas.
  Se leyeron completas en ese orden; permanecen idénticas a HEAD.
- El remoto beCook se identificó comparando el host configurado con el proyecto
  del conector. Solo se ejecutaron listados y SELECT de catálogos. Su ledger de
  migraciones estaba vacío, pese a tener implementados objetos de esos SQL.
- Node 25.6.1 y npm 11.9.0 disponibles; también un runtime Node 24 existente.
  Docker Desktop/CLI 28.3.2 instalado pero inicialmente detenido; se arrancó.
  No había Supabase CLI ni psql en PATH. Se añadió CLI 2.117.0 fijada; psql se
  usa dentro del contenedor local. No había configuración local ni CI.
- `.env.local` apuntaba al proyecto alojado. Contiene configuración Supabase
  pública y OpenAI; no se imprimieron sus valores ni se modificó el archivo.
  Next carga variables según su precedencia normal; las variables públicas
  se incorporan al bundle durante build. Los scripts históricos usaban dotenv
  sobre `.env.local`, o `node --env-file=.env.local`.

Inventario de riesgo:

| Script/grupo | Operación previa | Tratamiento |
| --- | --- | --- |
| test-supabase-week.ts | INSERT en weeks, sin usuario autenticado | Bloqueado antes de operar |
| test-save-week.ts | Guarda semana/días; helper puede actualizar y reemplazar días | Bloqueado |
| test-save-profile.ts | UPSERT perfil; fixture anterior usa 7 días, incompatible con CHECK real 0–5 | Bloqueado |
| test-save-shopping-list.ts | INSERT lista e items, toma última semana | Bloqueado |
| test-save-pantry.ts | INSERT despensa | Bloqueado |
| test-read-*.ts (4) | SELECT e impresión de filas completas | Bloqueados para evitar lecturas reales accidentales |
| benchmark-menu.cjs | Llama a OpenAI con coste y escribe informe local; no escribe Supabase | Conservado, fuera de CI; no ejecutado |
| import-nutritionist.py | Lee Numbers, escribe JSON local | Conservado; no ejecutado |
| check-secrets, register-typescript y tests ordinarios | Archivos locales, mocks, repositorios temporales | Conservados y probados |
| Helpers de src/lib/supabase | INSERT/UPSERT/UPDATE/DELETE usados por la aplicación | Sin cambios funcionales; desarrollo selecciona local |

Los únicos consumidores operativos encontrados para los probes antiguos eran
scripts npm; otros documentos los mencionaban como auditoría. Se conserva su
implementación y se ofrece `test:db` como sustitución autenticada.

La iteración 01 permanece: detector, hook, exclusiones y retirada de recuperación.
Se amplía el detector para bloquear artefactos locales incluso con `git add -f`.
La rotación/revocación pendiente de aquella iteración sigue siendo una dependencia
operativa externa; este trabajo no la confirma ni reintroduce las credenciales.

## B. Archivos y cambios

Nuevos:

- `.nvmrc`: Node 24.
- `.github/workflows/checks.yml`: jobs de aplicación y PostgreSQL local, sin despliegue.
- `supabase/config.toml`, `supabase/.gitignore`: configuración CLI local.
- `supabase/baseline/remote-metadata.json`, `inspect.sql`,
  `20260923103650_local_baseline.sql`: evidencia estructural y bootstrap local.
- `supabase/seed.sql`: A/B, perfiles, semanas, comidas/cenas, listas,
  artículos pendientes/comprados, despensa y solicitudes ficticias.
- `scripts/local-supabase.cjs`: arranque, identidad, reconstrucción, migración,
  seed, desarrollo y parada.
- `scripts/legacy-supabase-disabled.ts`: bloqueo incondicional de probes antiguos.
- `scripts/test-local-db.cjs`: esquema, roles, RLS, Auth, API y contratos reales.
- `tests/local-supabase.test.cjs`: protecciones contra destinos/flags incorrectos.
- `docs/development/local-database.md` y este informe.

Modificados:

- `package.json` y lockfile: CLI fijada, comandos locales y `dev` seguro.
- Nueve `scripts/test-*.ts`: primer import de bloqueo; retirada de dotenv.
- `.gitignore`: workspace y estado CLI locales.
- `scripts/check-secrets.cjs`, `tests/secrets.test.cjs`: artefactos locales prohibidos.
- `eslint.config.mjs`: permite require solo en el archivo CommonJS de auditoría
  existente, como ya se permitía en scripts/tests.
- `README.md`, `AGENTS.md`: procedimiento para desarrollador y futuras iteraciones.

Sin cambios en `src/`, endpoints, recetas, UI, cachés, modelos ni políticas remotas.

## C. Reproducibilidad y diferencias

Se inició Supabase local, se aplicó el bootstrap, se hizo reset **local**,
se cargaron fixtures dos veces sin duplicación y se volvió a aplicar el ledger
sin repetir la baseline. La guía explica el bloque local compuesto y su relación
con las tres migraciones históricas. No es un dump de datos ni se inserta como
migración remota pendiente.

La comparación automática coincide con el snapshot inspeccionado:
7 tablas públicas; columnas y nulabilidad/defaults; 42 restricciones; 30 índices;
28 políticas; RLS habilitado; dos funciones; seis triggers; event trigger
`ensure_rls`; permisos de tablas y funciones; ausencia de otras relaciones/enums.
Los números exactos pueden consultarse en el JSON de metadatos.
La marca privada `becook_local.identity` solo existe en local.
Supabase CLI reproduce la plataforma; no se pretende clonar configuraciones
gestionadas, usuarios, almacenamiento, extensiones de plataforma por versión
menor ni secretos del proyecto remoto.

Diferencias históricas reconciliadas **solo en el bootstrap local**:

- Políticas remotas `*_own` frente a nombres `*_own_week` en el primer SQL.
- `goals` remoto NOT NULL con default array vacío y CHECK distinto.
- Restricción de longitud de `other_goal`, columnas de telemetría y su CHECK,
  relaciones, unicidad de perfiles e índices que no estaban versionados.
- Ledger remoto vacío frente a ledger local con bootstrap compuesto. Su
  reconciliación remota queda pendiente de revisión específica; no se ejecutó
  repair, push, DDL ni modificación de tablas del remoto.

## D. Validaciones y hallazgos

| Comprobación ejecutada | Resultado |
| --- | --- |
| npm ci en copia limpia sin .env.local, Node 24 | Pasa |
| npm test / runner equivalente Node 24 | 19/19 pasan |
| npm run lint / ESLint equivalente en copia limpia | Pasa tras corregir alcance CommonJS |
| npm run typecheck / tsc --noEmit en copia limpia | Pasa |
| npm run build en checkout original | Falla ECANCELED al leer un módulo Next |
| next build Node 24 en copia limpia, sandbox | Falla por puerto interno prohibido |
| Mismo build limpio con permiso de ejecución | Pasa, 17 páginas generadas |
| db:start, db:reset, db:seed dos veces, db:migrate | Pasan, destino local verificado |
| test:db | 107 pasan / 12 fallan |
| dev local + GET / siguiendo redirección | HTTP 200 |
| test:supabase histórico | Rechazado antes de escribir, como se esperaba |
| git diff --cached --check | Pasa tras retirar una línea vacía final |
| npm run secrets:check | Sin hallazgos en 151 archivos del índice |
| db:stop + inspección Docker | Parado; volumen dedicado conservado; n8n sigue activo |

El build exitoso se hizo sin variables de producción. No se hicieron cambios
funcionales para solventar problemas del sandbox/filesystem. npm informó 12
vulnerabilidades de dependencias (3 bajas, 2 moderadas, 6 altas, 1 crítica);
no se aplicó `npm audit fix` ni una actualización ajena al alcance.
El workflow está incorporado pero no se ha ejecutado en GitHub porque no hubo push.
El job de base seguirá rojo por los fallos reales; no tiene continue-on-error.

### Defecto de aislamiento referencial reproducido

Las lecturas privadas, UPDATE/DELETE de filas ajenas y acceso anon se bloquean
correctamente. También se bloquea insertar o reasignar días/listas/items bajo
semanas/listas ajenas, con RLS 42501. El CHECK de entrenamiento devuelve 23514.

Sin embargo, cada uno de estos seis UPDATE sobre una fila **propia** acepta
referencias a una entidad del otro usuario, tanto A→B como B→A:

| Tabla | Columna afectada |
| --- | --- |
| weeks | profile_id |
| weeks | generation_request_id |
| pantry_items | profile_id |
| menu_generation_requests | profile_id |
| menu_generation_requests | created_week_id |
| profiles | active_week_id |

Las políticas de esas tablas comprueban user_id de la fila, pero no la propiedad
de la entidad enlazada. Las FK comprueban existencia, no pertenencia. No se ha
demostrado lectura directa de filas ajenas; sí enlaces cruzados incompatibles
con el contrato de propiedad. Los ensayos exitosos indebidos se revierten siempre.

Corrección propuesta, **no aplicada**: conservar SELECT/USING y añadir a los
WITH CHECK de INSERT/UPDATE las condiciones de pertenencia de cada FK opcional:
`parent_id IS NULL OR EXISTS (SELECT 1 FROM parent WHERE id=parent_id AND user_id=auth.uid())`,
además de `user_id=auth.uid()`. Revisar cada alias, SELECT RLS del padre y ciclos;
no añadir esas consultas recíprocas indiscriminadamente a políticas SELECT.
Antes de aplicar, revisar posibles enlaces ya inconsistentes con agregados de
solo lectura, decidir su tratamiento y probar la migración local completa.
No se corrigen silenciosamente datos ni políticas de producción.

## E. Seguridad y Git

No hubo escrituras sobre producción: la actividad remota fue descubrimiento,
SELECT de catálogos y lectura del ledger. Todas las escrituras de base de esta
sesión se dirigieron al contenedor local verificado; no se usó service role.
Los probes de RLS corren como authenticated/anon y comprueban auth.uid.
No se copiaron filas reales ni se mostraron claves en logs.

Se conserva la protección de iteración 01 y se comprueba el índice completo con
Gitleaks antes de entregar. Esto detecta patrones y nombres prohibidos; no es una
certificación absoluta de ausencia de secretos ni confirma revocaciones anteriores.
Los cambios previos de documentación quedan fuera del conjunto preparado.
No se modificó main; no hubo merge, push ni despliegue.
No se crea commit porque no pasan todas las validaciones RLS.

## F. Uso y migraciones

Consultar `local-database.md` para el procedimiento completo. Secuencia habitual:

```sh
npm ci
npm run db:start
npm run db:seed
npm run dev
# En otra terminal:
npm test
npm run test:db
# Al terminar, Ctrl+C en Next.js:
npm run db:stop
```

Nueva migración: `npx --no-install supabase migration new nombre`, revisión
destructiva y de seguridad, `db:migrate`, contratos/RLS, `db:reset` local,
`db:seed` y pruebas de reconstrucción. La guía exige comparación de metadatos,
autorización remota posterior y recuperación proporcionada al cambio.

## G. Cierre

**Parcialmente completada**. Ya hay un esquema reconstruible, datos sintéticos,
entorno local aislado, pruebas y CI. Falta resolver con una migración revisada
los seis defectos referenciales y obtener test:db completamente verde. No se
implementa esa corrección aquí por la instrucción de documentar y proponer
los problemas de RLS encontrados, conservando las políticas existentes.
Antes de publicar: revisar los archivos preparados y la propuesta, cerrar los
fallos autorizados, repetir validaciones, crear commit descriptivo en audit-opt.
