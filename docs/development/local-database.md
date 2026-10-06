# beCook: desarrollo y pruebas con Supabase local

El proyecto alojado de pruebas tiene un procedimiento separado en
[Supabase alojado y Vercel Preview](hosted-preview.md). Estos comandos locales
no se redirigen al remoto y GitHub Actions continúa usando Docker.

Este entorno usa exclusivamente el proyecto Docker `becook-iteration02`.
No necesita cuenta Supabase, enlace remoto, clave de producción ni OpenAI.
Requiere Node 24 (ver `.nvmrc`), npm y Docker Desktop arrancado, o Docker Engine
local en Linux. Supabase CLI 2.117.0 está fijada en el lockfile. Docker usa varios GB.
La configuración sigue la [guía oficial de Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).

## Desde un clon limpio

Trabajar en `audit-opt`. Instalar Node 24 e instalar Gitleaks 8.30.1 siguiendo
`docs/security/secret-detection.md` (incluida la verificación de checksum).

```sh
npm ci
npm run db:start
npm run db:seed
npm run dev
```

Abrir la dirección local que muestra Next.js. `dev` y `dev:local` obtienen la
URL y la clave anónima del CLI **después** de verificar los contenedores.
Esas variables tienen precedencia sobre `.env.local`, que no se modifica.
OpenAI se inicia con una clave vacía para evitar gasto real; la generación de IA
no forma parte de esta iteración. No ejecutar directamente `next dev` para este
flujo: su carga habitual de `.env.local` puede seleccionar el remoto.

Identidades exclusivamente ficticias para iniciar sesión en la aplicación local:

| Usuario | Correo de prueba | Contraseña pública, solo local |
| --- | --- | --- |
| A | fixture-1@example.invalid | Local-fixture-only-2026! |
| B | fixture-2@example.invalid | Local-fixture-only-2026! |

La contraseña es un dato sintético versionado, nunca una credencial real.
Cada identidad tiene perfil, restricciones, semana diferente, comida, cena,
lista con un artículo comprado y otro pendiente, despensa y solicitud ficticia.
La carga usa INSERT con conflicto por ID sin reemplazar registros existentes.
Si se editan los fixtures a mano, repetir el seed no deshace esas ediciones.

```sh
npm test
npm run test:db
npm run lint
npm run typecheck
npm run build
```

`test:db` debe devolver código 0. Incluye las doce regresiones originales y
pruebas de INSERT, UPDATE, NULL, FK inexistentes, propiedad y borrados. Ver
`docs/development/iteration-02b.md` para la migración y las precondiciones remotas.
Los tests ordinarios simulan OpenAI y no necesitan Supabase.

Para terminar: Ctrl+C en Next.js y `npm run db:stop`. La parada conserva
los volúmenes; no detiene otros proyectos Docker. Un siguiente `db:start`
recupera el mismo entorno.

## Reconstrucción vacía

```sh
npm run db:start
npm run db:reset
npm run db:seed
npm run test:db
```

`db:reset` destruye **solo** los datos del proyecto local dedicado tras verificar
su identidad. Usarlo cuando se quieran descartar expresamente las ediciones
sintéticas locales; nunca para recuperar datos. No acepta URL, flags ni argumentos
adicionales. No existe un reset remoto en este procedimiento.

## Baseline e historial

`supabase/baseline/remote-metadata.json` contiene solo metadatos obtenidos por
SELECT el 2026-09-23. No contiene filas de aplicación, usuarios, sesiones ni secretos.
`inspect.sql` permite repetir la inspección principal en modo lectura.
La baseline SQL reconstruye el estado público observado: siete tablas, columnas,
PK/FK/CHECK/UNIQUE, índices, 28 políticas, RLS, dos funciones, seis triggers,
event trigger `ensure_rls` y permisos de objetos. Los esquemas de plataforma
Auth/Storage/etc. los crea la distribución local de Supabase; no se copian del remoto.
PostgreSQL local y remoto tienen versión mayor 17; el parche de la imagen puede diferir.

La baseline está **fuera** de `supabase/migrations`: no es una migración pendiente
de producción. Se creó inicialmente con `supabase migration new` y se trasladó
al directorio exclusivo de bootstrap. Rechaza un esquema público no vacío.

El lanzador crea el directorio ignorado `.supabase-local` y prepara allí una
migración local compuesta, con este orden:

1. Baseline observada.
2. Las tres migraciones históricas originales, sin modificar, en orden cronológico.
3. Reconciliación exclusivamente local: elimina las 12 políticas duplicadas
   `*_own_week` que añade el primer SQL y restaura el CHECK real de `goals`.
4. Las nuevas migraciones posteriores a la baseline se copian y aplican en orden.

La baseline ya incluye `goals NOT NULL DEFAULT '{}'`, `other_goal`, columnas
ISO, telemetría, relaciones e índices ausentes del historial. Reproducir el historial
sobre ella no constituye una reconstrucción del pasado: es un bootstrap documentado
del estado observado, más comprobación de compatibilidad con los SQL conservados.
El ledger **local** registra el bloque como `20260923103650`; el remoto tenía
el ledger vacío. Nunca copiar ese ledger al remoto ni marcar migraciones remotas
como aplicadas automáticamente. Una segunda aplicación de la baseline se impide
por el ledger y por la condición de esquema vacío.

La configuración raíz desactiva aplicación automática de migraciones y seed:
un `supabase start` directo no debe intentar reconstruir un historial incompleto.
Usar siempre los comandos npm. El workspace generado no debe editarse ni enlazarse;
un archivo `.temp/project-ref` hace fallar el lanzador.

## Protecciones y pruebas

Las operaciones solo admiten el socket local de Docker Desktop o
`/var/run/docker.sock`. Se rechazan DOCKER_HOST/DOCKER_CONTEXT y endpoints
TCP/SSH, aunque se llamen “test”. Se verifican nombre, etiqueta de proyecto,
estado e imagen del contenedor, y después `becook_local.identity`.
SQL se ejecuta por `docker exec` contra el ID verificado, nunca con una URL
aportada por el entorno. El primer bootstrap exige contenedor verificado y
esquema vacío; la marca se crea como parte de él.

La API requiere además el gateway del mismo proyecto, su puerto y la URL
exacta `http://127.0.0.1:54321`. Solo se obtiene la clave anon local;
ninguna prueba emplea service role. El entorno de los subprocesos se limita a
variables del sistema. Las salidas CLI/SQL sensibles se capturan y no se publican.
Los nueve scripts históricos `test-*.ts` conservan su implementación pero fallan
antes de cargar configuración o ejecutar consultas; quedan sustituidos para uso
operativo por `test:db`. No hay pruebas remotas habilitadas.

Las pruebas SQL usan `SET LOCAL ROLE authenticated` y JWT claims consumidos
por `auth.uid()`, verificando ambos. Auth y PostgREST se prueban además con
inicio de sesión real de A/B. Se verifican los mapeadores de aplicación.
Las operaciones adversariales se revierten mediante subtransacciones y ROLLBACK,
incluso cuando el defecto permite escribir. Los resultados distinguen cero filas,
RLS 42501, permiso 42501 sin RLS y restricción 23514.

La comparación de metadatos no compara datos. La instantánea remota permanece
intacta. `supabase/expectations/20260923194029_enforce_reference_ownership.json`
describe las únicas adiciones esperadas: 13 constraints y sus 3 índices. Se compara
el conjunto completo, incluidas las políticas sin cambios; cualquier diferencia
no declarada falla. También se exige que las constraints estén validadas y sean
inmediatas. Al añadir otra migración, revisar su delta explícitamente, sin
sobrescribir la evidencia remota ni excluir clases enteras de objetos.

## Migraciones futuras: procedimiento para Codex

1. Confirmar rama, cambios locales y alcance. Conservar los SQL históricos.
2. Crear el archivo en la raíz con
   `npx --no-install supabase migration new nombre_descriptivo`.
   Leer `--help` de la versión fijada antes de usar otros comandos.
3. Revisar SQL antes de aplicarlo: DROP/TRUNCATE/DELETE, cambios de tipo,
   NOT NULL, locks, defaults, funciones SECURITY DEFINER, grants y RLS.
   No aceptar una FK como prueba suficiente de pertenencia al usuario.
4. `npm run db:start`, `npm run db:migrate`, probar contratos y RLS.
   No usar MCP conectado al remoto para experimentar con DDL.
5. Repetir `db:reset`, `db:seed`, `test:db` para demostrar la reconstrucción.
   Probar también la aplicación incremental sobre fixtures locales existentes.
6. Revisar el delta contra metadatos remotos recientes obtenidos solo con SELECT.
   Las diferencias conocidas de bootstrap/ledger no se “arreglan” aplicando la
   baseline al remoto. Revisar explícitamente cada futura migración remota.
7. Documentar SQL exacto, proyecto autorizado, precondiciones, impacto, bloqueo,
   verificación posterior y plan de recuperación. Requiere autorización separada
   antes de escribir remotamente; pasar un build no autoriza el despliegue.
8. Preferir cambios compatibles por fases. Para cambios destructivos, comprobar
   backup/restauración en entorno aislado y planificar recuperación de datos;
   una migración inversa no recupera filas borradas. Nunca usar reset remoto.

No hay proyecto Supabase alojado de pruebas, Vercel Preview ni despliegue automático.
Esa ampliación puede estudiarse después. CI separa aplicación y base local; no
consume secretos del repositorio, ni publica dumps/logs como artefactos.


## Integridad de referencias: migración 02B

`20260923194029_enforce_reference_ownership.sql` añade FK compuestas para
`weeks.profile_id`, `weeks.generation_request_id`, `pantry_items.profile_id`,
`menu_generation_requests.profile_id`, `menu_generation_requests.created_week_id`
y `profiles.active_week_id`. El par (referencia, user_id) debe existir en la tabla
padre. Tres claves únicas (id, user_id) soportan las FK. Cuatro CHECK impiden
eludirlas mediante un propietario nulo cuando existe una referencia.

Las referencias opcionales siguen admitiendo NULL. Borrar un padre limpia solo
la referencia, conservando user_id. No cambian las políticas RLS ni los grants.
Las FK originales también se conservan. La creación legítima respeta el orden:
perfil → solicitud → semana → completar solicitud / establecer semana activa.
No se necesitan funciones SECURITY DEFINER ni subconsultas recíprocas en RLS.

Aplicación local incremental: `npm run db:migrate`, después `npm run test:db`.
Reconstrucción completa: `db:reset`, `db:seed`, `test:db`. Repetir `db:migrate`
y `db:seed` no debe cambiar los fixtures ni duplicar el ledger. CI comprueba
ambos comandos repetidos y los recuentos exactos de los fixtures.

**Antes de cualquier aplicación remota autorizada:**

1. Ejecutar únicamente el SELECT de `supabase/checks/reference-ownership-counts.sql`
   con acceso capaz de ver todos los registros, sin filtrar los agregados por RLS.
   El 23-09-2026 se detectaron enlaces entre propietarios diferentes y sin propietario.
2. Acordar qué hacer con cada grupo inconsistente mediante un proceso autorizado.
   No elegir unilateralmente propietarios, borrar datos o poner referencias a NULL.
   Los totales pueden contar una misma fila en varias relaciones.
3. Repetir los agregados: todos deben ser cero. Comprobar también que el esquema
   remoto aún coincide con las precondiciones, y disponer de backup recuperable.
4. Revisar/aplicar **solo esta migración incremental** al proyecto expresamente
   autorizado. No empujar la baseline, reparar el ledger remoto automáticamente
   ni aplicar a ciegas todo el historial local de bootstrap.
5. La migración es transaccional, valida filas existentes y falla si hay conflictos.
   Usa lock_timeout de 5 s y statement_timeout de 120 s; planificar una ventana
   corta sin escrituras. Si esos límites no bastan, revisar volumen/locks antes
   de proponer otra estrategia, sin quitar la validación.
6. Validar constraints, lecturas y operaciones autorizadas después de aplicarla.
   En un fallo de aplicación, la transacción revierte DDL. Una reversión posterior
   requeriría otra migración explícita que retire solo las seis FK, cuatro CHECK
   y tres UNIQUE añadidos; debilitaría otra vez la integridad y necesita autorización.
   No hay rollback de datos porque esta migración no los transforma; la
   reconciliación de datos tiene su propio backup y procedimiento de recuperación.

No ejecutar pruebas sintéticas de escritura sobre producción. Su validación remota
necesita un plan acordado distinto de `test:db`. La corrección local no significa
que los datos ni el despliegue de producción estén protegidos por la nueva migración.
