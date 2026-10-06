# Iteración 02B — Integridad referencial y cierre en desarrollo

Fecha: 2026-09-23. Continúa la iteración 02; no incluye la iteración 03.

## A. Diagnóstico confirmado

El punto de partida coincidía con la entrega: rama audit-opt, HEAD
`f6555fd7cb26ddaf15eb84b72d1ffb4acdb22941`, 31 archivos preparados de la
iteración 02 y seis cambios de documentación del usuario ajenos al trabajo.
Se conservaron las protecciones de la iteración 01.

Antes de modificar SQL se arrancó el entorno verificado y se ejecutó `test:db`:
**107 pasan / 12 fallan**. Eran los seis UPDATE de referencias propios hacia
entidades ajenas, en A→B y B→A. Las políticas verificaban user_id de la fila,
pero las FK solo comprobaban el id del padre.

Los enlaces implicados son opcionales UUID y tenían ON DELETE SET NULL.
Existen ciclos profiles↔weeks y weeks↔menu_generation_requests. El código crea
una solicitud, guarda la semana y después marca la solicitud como aplicada;
despensa puede asociarse al perfil; el perfil es único por usuario.

## B. Estrategia y alcance

Se evaluó reforzar WITH CHECK mediante EXISTS. Con las políticas SELECT actuales
(propiedad directa) se podría evitar la recursión, pero esa estrategia mezcla
inexistencia con invisibilidad RLS, no conserva el rechazo FK 23503 para ids
inexistentes y no expresa por sí sola una invariante frente a cambios posteriores
del propietario del padre. Se optó por integridad referencial nativa.

Se añaden:

- Tres UNIQUE (id, user_id) en profiles, weeks y menu_generation_requests.
- Seis FK (referencia, user_id) → padre(id, user_id).
- Cuatro CHECK: cuando hay alguna de esas referencias, user_id no puede ser NULL.
  Evitan que MATCH SIMPLE permita saltarse la validación por un propietario nulo.

La referencia opcional puede seguir siendo NULL. ON DELETE SET NULL se limita
explícitamente a la referencia; nunca borra user_id. ON UPDATE NO ACTION impide
invalidar enlaces existentes al cambiar una clave del padre. RLS sigue impidiendo
que los usuarios transfieran o eliminen su propietario.

No se cambian políticas RLS, grants, columnas, FK históricas ni datos. No se
añaden funciones SECURITY DEFINER, RPC o triggers de aplicación. Las relaciones
circulares válidas se construyen con referencias inicialmente nulas y se completan
en el orden que ya usa el contrato de aplicación.

La solución sigue la documentación de
[FK compuestas y SET NULL parcial de PostgreSQL 17](https://www.postgresql.org/docs/17/ddl-constraints.html).

Archivos nuevos de 02B:

- `supabase/migrations/20260923194029_enforce_reference_ownership.sql`.
- `supabase/expectations/20260923194029_enforce_reference_ownership.json`.
- `supabase/checks/reference-ownership-counts.sql`.
- `scripts/db-test-probe.cjs` y `scripts/reference-ownership-tests.cjs`.
- Este informe.

Modificados sobre la entrega 02: `scripts/test-local-db.cjs`, el workflow de CI,
README y los documentos de desarrollo. No hay cambios de frontend, generador,
flujos de compra/despensa ni archivos de `src/`.

## C. Migración y reproducibilidad

La migración se creó con el CLI fijado mediante `supabase migration new`.
Se aplicó con `npm run db:migrate`, que verifica la identidad local y utiliza
exclusivamente `migration up --local`.

Es incremental, transaccional y no transforma filas. Tiene lock_timeout de 5 s
y statement_timeout de 120 s. Todas sus constraints se validan contra los datos
existentes y son inmediatas; no se ocultan inconsistencias con NOT VALID.
Si hay filas incompatibles, falla y revierte el DDL. No es apropiado aplicarla
ahora en producción sin resolver primero los datos detectados.

La baseline y su snapshot remoto se mantienen intactos. Las expectativas añaden
exactamente 13 constraints y 3 índices al conjunto original; se compara el
esquema completo y se comprueba convalidated. Un cambio inesperado de políticas,
funciones, columnas, permisos o cualquier otro objeto inspeccionado sigue fallando.

Se probaron aplicación incremental sobre los fixtures existentes y reconstrucción:

```sh
npm run db:reset
npm run db:seed
npm run test:db
```

El CLI aplica baseline compuesta `20260923103650` y después
`20260923194029`. No necesita modificaciones manuales de base ni del ledger.
La guía de desarrollo contiene el procedimiento remoto separado, con preflight,
backup, ventana de aplicación, validación y recuperación.

## D. Estado remoto: exclusivamente agregados de lectura

Consulta realizada con el conector autorizado, usando SELECT sin recuperar filas.
“Propietarios distintos” cuenta solo pares con ambos propietarios no nulos.
“Sin propietario” incluye cualquier extremo nulo. Estas dos categorías son disjuntas.

| Relación | Propietarios distintos | Sin propietario | Total incompatible |
| --- | ---: | ---: | ---: |
| weeks.profile_id | 0 | 0 | 0 |
| weeks.generation_request_id | 0 | 1 | 1 |
| pantry_items.profile_id | 12 | 16 | 28 |
| menu_generation_requests.profile_id | 18 | 2 | 20 |
| menu_generation_requests.created_week_id | 0 | 1 | 1 |
| profiles.active_week_id | 0 | 0 | 0 |

Son recuentos de enlaces por relación: una fila puede aparecer en más de una.
No se ha decidido quién debe conservar los enlaces, ni se han borrado, reasignado
o puesto a NULL. Requieren reconciliación autorizada y repetir los agregados antes
de cualquier aplicación remota. La consulta reproducible está en `supabase/checks/`.

## E. Pruebas ejecutadas

| Validación | Resultado |
| --- | --- |
| Reproducción previa | 107 pasan / los mismos 12 fallan |
| Migración incremental + primera regresión ampliada | 275 pasan / 0 fallan |
| Reconstrucción limpia + suite final con recuentos | 282 pasan / 0 fallan |
| npm test | 19/19, ninguno omitido |
| npm run lint | Pasa |
| npm run typecheck | Pasa |
| npm run build con Node 24 y credenciales vacías | Pasa, 17 páginas |
| Repetir db:migrate / db:seed y stop / start | Huellas de datos y ledger idénticas |
| npm run secrets:check | Sin hallazgos en 157 archivos del índice |
| git diff --cached --check | Pasa |
| Parada final local | Volúmenes conservados; otros contenedores intactos |

Se conservan las doce aserciones originales. Su rechazo esperado pasa de RLS 42501
a FK 23503 **después** de comprobar directamente el rechazo y la ausencia de
escritura parcial. No se convierten en éxitos esperados ni se aceptan errores
arbitrarios.

La suite ampliada cubre, por cada relación y usuario:

- UPDATE e INSERT propios, nulos, inexistentes y ajenos.
- Modificación previa a una escritura rechazada, comprobando rollback completo.
- Falsificación del propietario junto con la referencia, cambio del propietario
  del padre y cambio de su id.
- Borrado legítimo del padre: limpia la referencia y conserva el propietario.
- Flujo circular legítimo solicitud→semana→solicitud aplicada/perfil activo.

Los usuarios son authenticated con auth.uid comprobado; también se ejercitan
Auth real, Data API, anon y los mapeadores existentes. No se usa service role.
Las funciones temporales de prueba son SECURITY INVOKER, desaparecen al cerrar
psql y no forman parte del esquema de aplicación.

Cada prueba compara huellas de las filas antes/después y observa los resultados
válidos antes de revertir. Al final se compara también la huella de todas las
tablas públicas, incluyendo A y B, sin imprimir su contenido. Los fixtures
permanecen intactos.

## F. Git, CI y publicación

El commit incluye el trabajo preparado de la iteración 02 y la corrección 02B,
excluyendo los seis cambios previos ajenos. La rama sigue siendo audit-opt;
main no se modifica. No hay merge, aplicación remota ni despliegue.

GitHub Actions separa aplicación y base local. La base se reconstruye, se carga
el seed, se repiten migración/seed y se ejecuta la suite. No hay secretos Supabase
remotos, servicios de despliegue, continue-on-error ni exclusiones de tests.
**Este workflow no ha llegado a ejecutarse en GitHub para estos cambios.**

La comprobación de publicación encontró:

- origin/audit-opt aún apunta a `6eebc8175c63861e91736202c4028cfc3acca6cf`.
- Ese SHA tiene dos despliegues Preview anteriores: `be_cook` y `be-cook`.
- No hay configuración local de Vercel ni acceso verificado a las variables
  actuales de esos proyectos. No puede garantizarse su aislamiento de producción.

Por ello no se hace push sin confirmación del usuario. Un push publicaría también
el commit previo de seguridad `f6555fd`, que todavía no figura en esa referencia
remota. Que este workflow no despliegue no impide que la integración de Vercel
cree Preview por su cuenta. No se ha cambiado su configuración unilateralmente.

## G. Cierre y acciones del usuario

**Iteración 02 completada en desarrollo**. Esto no significa
“migración aplicada y validada en producción”: esa fase está pendiente y no se ha
realizado ninguna escritura sobre el remoto.

Antes de pasar a la iteración 03:

1. Revisar el commit, este informe y los agregados; mantener la rama audit-opt.
2. Verificar/aislar las variables y el comportamiento de ambos Preview, o
   desactivar expresamente su despliegue automático; después confirmar el push.
3. Tras publicar, comprobar que ambos jobs de GitHub Actions terminan correctamente.
4. Registrar un trabajo separado y autorizado para reconciliar los enlaces reales,
   repetir agregados y planificar aplicación/validación remota. No usar test:db
   contra producción. No presentar la producción como corregida mientras siga pendiente.

El trabajo siguiente puede desarrollarse contra Supabase local; no necesita
aplicar esta migración en producción para que el entorno de pruebas sea utilizable.
