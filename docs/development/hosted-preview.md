# Supabase de pruebas alojado y Vercel Preview

Estado comprobado el 24 de septiembre de 2026. Continúa la iteración 02.
**Supabase de pruebas preparado; aislamiento de los despliegues Vercel pendiente.**
Rama `audit-opt`, commit de partida `1ce63f94edf86282d3444f29c16c1a54bc6de310`.

## Destinos y límites

| Uso | Proyecto | Identificador |
| --- | --- | --- |
| Producción, becook.xyz | becook | wejvptpkxlllfpskyisu |
| Pruebas alojadas autorizadas | becook-preview | qdhpdhnpcsfhmygjofqb |
| Tests de desarrollo y CI | Docker local | becook-iteration02 |

La URL y la referencia de la clave pública incorporadas en los JS públicos de
`www.becook.xyz/login` apuntan a `wejvptpkxlllfpskyisu`. Se extrajeron únicamente
identificadores, sin mostrar claves. También coincide con el host de `.env.local`.

El conector confirmó el nombre/ID, estado saludable y PostgreSQL 17 del nuevo
proyecto. Antes de escribir: cero tablas públicas, cero usuarios Auth y ledger
vacío. Los únicos objetos públicos previos eran los gestionados por Supabase.
Se volvió a comprobar identidad y vaciado antes de aplicar el esquema.

No se modificaron producción, Vercel, main ni los documentos previos del usuario.
No hubo push, merge, despliegue, reset remoto, copia de datos reales ni llamadas IA.

## Inicialización reproducible del proyecto nuevo

No ejecutar `supabase db push` desde la carpeta raíz: contiene historia anterior
a la baseline que no representa una secuencia válida de inicialización alojada.
No enlazar `.supabase-local` a ningún remoto. Los comandos `db:*` siguen siendo locales.

1. Verificar por Management API/conector el ID **qdhpdhnpcsfhmygjofqb**, nombre
   **becook-preview**, y compararlo expresamente con el ID de producción.
2. Inspeccionar tablas, usuarios, funciones de aplicación e historial. Si hay
   objetos/datos previos, detener la inicialización; no resetear ni reparar el ledger.
3. `node scripts/prepare-hosted-preview.cjs` genera SQL **sin conexión**.
4. Revisar `supabase/hosted/20260924000100_preview_bootstrap.sql`. Aplicarlo como
   migración `preview_bootstrap` mediante el conector, con `project_id` explícito
   y verificado. La guardia SQL rechaza un esquema público con tablas existentes.
5. Aplicar el archivo original
   `supabase/migrations/20260923194029_enforce_reference_ownership.sql` como
   `enforce_reference_ownership`, exclusivamente en ese destino verificado.
6. Leer el ledger y comparar metadatos antes de cargar fixtures.

Esto ya se ejecutó. **No volver a aplicar la baseline.**

| Versión real del ledger alojado | Nombre | Fuente |
| --- | --- | --- |
| 20260924112904 | preview_bootstrap | supabase/hosted/20260924000100_preview_bootstrap.sql |
| 20260924112917 | enforce_reference_ownership | supabase/migrations/20260923194029_enforce_reference_ownership.sql |

El conector asigna su timestamp al aplicar. `supabase/hosted/applied-preview.json`
registra la correspondencia y SHA-256 del contenido exacto. El ledger alojado tiene
dos migraciones; no se ha falsificado para aparentar el historial de producción/local.
Para futuras migraciones: revisar el cambio local, testear reconstrucción y RLS,
comprobar este manifiesto y el ledger remoto, presentar destino/plan y aplicar solo
el incremento autorizado. Registrar su versión real y hash. Nunca aplicar por el
mero hecho de pasar un build. La producción requiere otro procedimiento autorizado.

La adaptación incluye 7 tablas, 79 columnas, 55 constraints validadas, 33 índices,
28 políticas RLS, 6 triggers y `set_updated_at`. Conserva los contratos del snapshot
y añade las seis FK compuestas de 02B. No modifica el snapshot ni las migraciones
históricas. No reproduce Auth/Storage internos, extensiones, roles, event triggers,
`rls_auto_enable`, ACL del schema, default privileges ni `becook_local.identity`.

Los roles anon/authenticated/service_role reciben SELECT/INSERT/UPDATE/DELETE sobre
estas tablas, sujetos a sus roles y RLS; no se trasladan TRUNCATE/REFERENCES/TRIGGER.
Esta diferencia respecto al snapshot está explícitamente contemplada en el comparador.
La otra diferencia aceptada es una única representación equivalente de paréntesis
en `weeks_iso_week_range_chk`, producida por el deparser de PostgreSQL 17.6.
Se siguen rechazando diferencias inesperadas en tablas, columnas, políticas,
constraints, índices, grants, triggers y funciones de aplicación.

Para repetir la comparación: obtener solo metadatos con `supabase/baseline/inspect.sql`
en el proyecto verificado, guardar el objeto `metadata` (no la envoltura del conector)
en `.supabase-local/hosted-preview/metadata.json`, y ejecutar
`node scripts/verify-preview-metadata.cjs`. No contiene datos de usuarios.

## Fixtures y pruebas manuales alojadas

Hay exclusivamente dos cuentas ficticias y datos sintéticos: 2 perfiles, 2 semanas,
2 días con comida/cena, 2 listas, 4 artículos (comprados/pendientes), 2 solicitudes
sin IA y 4 productos de despensa. Las restricciones/preferencias son diferentes.

`node scripts/prepare-preview-fixtures.cjs` es un generador offline para la primera
inicialización, después de `npm run db:start`. Usa el contenedor local verificado
solo para cifrar contraseñas aleatorias mediante bcrypt. No utiliza la contraseña
pública de los fixtures locales. Guarda credenciales y SQL privado con modo 0600
en `.supabase-local/hosted-preview/`, directorio 0700 ignorado por Git. Rechaza
sobrescribir las credenciales existentes. No registrar ni publicar esos archivos.

El SQL privado solo se aplica por el conector al proyecto verificado y exige cero
usuarios y tablas de aplicación sin datos. **Ya está aplicado: no repetirlo.**
No altera configuración ni definiciones internas de la plataforma; únicamente
inserta las dos filas de usuario/identidad Auth necesarias para estos fixtures y
las filas de aplicación ficticias. No se copiaron sesiones, contraseñas ni usuarios.

Los passwords no se imprimieron ni se enviaron al chat: los recibió Auth por HTTPS
desde el archivo privado para validar el acceso real. No se empleó service role.
Un clon limpio no trae estas credenciales alojadas: mantenerlas en almacenamiento
privado del operador; no regenerarlas sobre usuarios existentes ni usar las locales.

Pruebas disponibles, separadas de CI:

```sh
node scripts/prepare-preview-checks.cjs
node scripts/test-preview-api.cjs
```

El primer comando genera `.supabase-local/hosted-preview/security-checks.sql`.
Revisarlo y ejecutarlo por el conector solo después de verificar el ID autorizado.
Contiene 160 aserciones, SET LOCAL ROLE authenticated + JWT claims y comprobación
de auth.uid/current_user, lecturas propias/ajenas, anon, escrituras ajenas, las seis
relaciones en INSERT/UPDATE (propias, nulas, inexistentes, ajenas), falsificación
de propietario y huellas de datos. Las funciones son temporales SECURITY INVOKER.
Todas las escrituras y objetos temporales terminan en ROLLBACK. Para probar INSERT
del perfil único se sustituye temporalmente el perfil ficticio dentro de una
subtransacción que se revierte incluso en caso de éxito; no hay borrado persistente.

El segundo usa `.supabase-local/hosted-preview/api.json` con `{url,key}`, preparado
privadamente con la URL exacta del proyecto y su clave **publishable**. Nunca usar
una secret/service-role key. El archivo de credenciales ya generado especifica el
mismo ID; el script rechaza otro destino, credenciales privilegiadas y redirects en
sus solicitudes de prueba. No carga `.env.local` ni permite URLs por argumentos.
Ejercita Auth real para A/B, GET autenticado, rechazo de los doce UPDATE originales
sin cambios parciales, anon, los mapeadores reales de la aplicación y CRUD de una
fila sintética nueva por usuario. La limpieza elimina solo el UUID recién creado
por la prueba, como su propietario; nunca toca fixtures ni datos preexistentes.

Resultados: **160/160 SQL** y **63/63 Auth/API/aplicación**. Las constraints se
compararon contra baseline + delta, con cero sin validar. Las 28 políticas coinciden.
Los agregados finales de las seis relaciones dan cero referencias incompatibles;
tras limpiar las filas API temporales siguen existiendo solo las dos semanas seed.
Los seis enlaces protegidos son weeks.profile_id, weeks.generation_request_id,
pantry_items.profile_id, menu_generation_requests.profile_id,
menu_generation_requests.created_week_id y profiles.active_week_id.

En desarrollo sigue pasando `test:db` **282/282**. Tests generales **22/22**,
lint, typecheck y build pasan. Build con Node 24 y variables de proveedores vacías.
La reconstrucción limpia ya quedó validada en 02B; en esta sesión se repitieron el
arranque/parada local y test:db, sin reset adicional. Detección de secretos sin
hallazgos en 167 archivos del índice. GitHub Actions sigue usando Docker
aislado; no se añadieron tests remotos a npm test ni al workflow.

## Dos proyectos Vercel, dos Preview de audit-opt

| Proyecto | Producción | Preview de la misma rama audit-opt | Deployment observado |
| --- | --- | --- | --- |
| be-cook | becook.xyz / be-cook.vercel.app, main | be-cook-git-audit-opt-sikorsky1991.vercel.app | HWYdcqgqGQLx5EBs2zxEAUyYTKoJ |
| be_cook | becook.vercel.app, main | becook-git-audit-opt-sikorsky1991.vercel.app | 6gBsxJp2y8kx7nC4mVTcFEWrLiDV |

Ambos repositorios conectados son Sikorsky1/beCook. Ambos Preview son del 19 de
septiembre, commit 6eebc817; no contienen el commit local 1ce63f9 ni esta preparación.
Un push nuevo a audit-opt puede disparar **dos builds Preview**. En ambos proyectos
Next.js/Node 24, los overrides de Build/Install están desactivados y el Ignored Build
Step es Automatic. No se detectaron comandos de migración en ese camino ni en
scripts lifecycle/package/workflow. Los scripts de aplicación sí permiten escrituras
con la sesión de usuario cuando se usa el sitio: por eso separar variables es obligatorio.

Inventario leído en el panel, sin revelar valores Secret:

| Variable | be-cook | be_cook |
| --- | --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | Production + Preview | Production + Preview |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Production + Preview | Production + Preview |
| OPENAI_API_KEY | Production solamente | No aparece |
| OPENAI_AI_KEY | No aparece | Production + Preview |
| OPENAI_MODEL / OPENAI_FALLBACK_MODEL | Production + Preview | Production + Preview |
| OPENAI_REASONING_EFFORT | Production solamente | No aparece |

No aparecen DATABASE_URL, service-role, otras conexiones Supabase ni variables
específicas de rama. La pestaña Shared muestra **No shared variables linked** en
los dos proyectos. “Production and Preview” es aquí una variable del proyecto con
dos destinos, no una Shared Variable de equipo. Valores Secret no recuperables:
su ámbito se verificó; su contenido efectivo en cada Preview **no**.

## Cambios que debe hacer Sergio desde el panel

Repetir en **ambos proyectos**; no modificar el proyecto de producción Supabase.

1. Abrir [variables de be-cook](https://vercel.com/sikorsky1991/be-cook/settings/environment-variables)
   y después [variables de be_cook](https://vercel.com/sikorsky1991/be_cook/settings/environment-variables).
2. Para `NEXT_PUBLIC_SUPABASE_URL`: menú `…` → `Edit` → `Environments`.
   Quitar **Preview**, conservar **Production**. No escribir en `Value`, no rotar
   ni cambiar el valor existente. Guardar únicamente el cambio de ámbito. Si el
   panel exige reintroducir el secreto para ello, cancelar y resolver su conservación
   desde el almacén seguro; no guardar un valor vacío o de pruebas en Production.
3. Repetir exactamente el cambio de ámbito para `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. `Add Environment Variable`: crear `NEXT_PUBLIC_SUPABASE_URL`, valor
   `https://qdhpdhnpcsfhmygjofqb.supabase.co`, **solo Preview**, todas las ramas
   no productivas. No seleccionar Production ni Development.
5. Crear otra `NEXT_PUBLIC_SUPABASE_ANON_KEY`, **solo Preview**, todas las ramas.
   Copiar la clave **publishable** de `becook-preview` desde Supabase → Settings →
   API Keys. El nombre de variable conserva “ANON” por el contrato del código;
   supabase-js acepta la publishable (comprobado en esta sesión). No usar secret ni
   service_role, ni copiar la clave de becook. No ponerla en Git/chat.
6. Filtrar Preview y revisar cualquier override de `audit-opt` u otra rama. Debe
   coincidir con la pareja nueva o eliminarse solo su override redundante. Se
   recomienda una única pareja Preview para todas las ramas y ninguna excepción.
   Revisar también Shared y cualquier integración que pueda volver a añadir valores.
7. En be-cook conservar `OPENAI_API_KEY` de Production sin cambios y mantener
   Preview sin ella por ahora. En be_cook quitar únicamente Preview del ámbito
   de `OPENAI_AI_KEY`, conservando Production y su valor. No renombrarla ni copiar
   esa credencial a `OPENAI_API_KEY` de Preview. Los nombres de modelo no son claves.
8. Comprobar que el filtro Production conserva su pareja original y la rama main.
   No cambiar Domains, Production Branch, claves Supabase originales ni sus políticas.

Precedencia: una variable específica de rama prevalece sobre la Preview general;
una variable de proyecto prevalece sobre una Shared de equipo con igual nombre y
entorno. Production no es un fallback implícito de Preview: el problema actual
es que ambas están explícitamente seleccionadas. Fuentes:
[entornos y ramas](https://vercel.com/docs/environment-variables#preview-environment-variables),
[variables compartidas](https://vercel.com/docs/environment-variables/shared-environment-variables).

## Recompilación y verificación pendiente

En becook-preview → Authentication → URL Configuration se comprobó `Site URL =
http://localhost:3000` y ninguna Redirect URL. No apunta a producción. La prueba
Auth realizada es login/password con cuentas ficticias confirmadas; no se probaron
correos de alta/recuperación ni OAuth. Si se van a probar esos flujos, tras aislar
Vercel elegir el Preview principal como Site URL (por ejemplo
`https://be-cook-git-audit-opt-sikorsky1991.vercel.app`) y autorizar únicamente los
retornos exactos necesarios de los Preview seleccionados en **este proyecto nuevo**.
No añadir becook.xyz ni comodines globales. No se ha modificado esta configuración.

Guardar variables no modifica los JS ya publicados. `NEXT_PUBLIC_*` se incorpora
en el build. **No usar ninguno de los dos Preview antiguos para pruebas de escritura.**

Después de separar las variables, en cada proyecto: Deployments → localizar el
Preview de **audit-opt** → `…` → `Redeploy`, destino **Preview**, configuración
actual y sin reutilizar Build Cache. Nunca Promote to Production ni redeploy de main.
Esto puede hacerse con el commit remoto existente sin hacer push de los cambios
locales. Si el diálogo propone reutilizar variables/configuración antiguas, cancelar.

Antes de autorizar el push:

- Registrar el ID y fecha del nuevo deployment de cada proyecto y que su rama sea audit-opt.
- Verificar con sesión Vercel autorizada la configuración efectiva Preview/branch.
- Abrir cada Preview en un contexto de navegador limpio, sin sesión/caché de producción.
  En Network inspeccionar **solo el host** de las solicitudes Auth/REST: debe ser
  qdhpdhnpcsfhmygjofqb.supabase.co y nunca wejvptpkxlllfpskyisu.supabase.co.
  No compartir headers, tokens ni capturas de valores. No usar cuentas reales.
- Probar acceso y una operación ficticia de lectura/escritura contra el nuevo
  proyecto, verificando A/B. No llamar endpoints IA para comprobar variables.
- Verificar la pareja URL/clave pública del build y la ausencia de conexiones
  privilegiadas/overrides a producción. No basta con ver el nombre de una variable.
- Repetir revisión de build/install/hooks/integraciones y CI antes de publicar.
- Las URLs inmutables de deployments antiguos conservan su configuración; un
  redeploy actualiza el alias de rama pero **no sanea el deployment anterior**.
  No utilizarlos; mantener su protección o retirar su acceso mediante una decisión
  explícita del propietario. No hemos borrado ni alterado esos deployments.

`node scripts/inspect-preview-bundles.cjs` es una inspección HTTP de solo lectura de
HTML/JS y emite únicamente hosts/referencias/roles públicos, nunca claves. Hoy ambos
devuelven 302 de protección: **no verificados**. No se eludió esa protección.
Incluso si este chequeo pasa después, no sustituye la revisión de variables servidor,
Network autenticado ni operaciones de aplicación. No acceder a la configuración
antigua mediante tokens/cookies volcados a archivos para saltarse la protección.

## IA y cierre

El código consulta `OPENAI_API_KEY`, no `OPENAI_AI_KEY`. Según los ámbitos actuales,
no hay clave bajo el nombre consumido por audit-opt en Preview. No se ha comprobado
el entorno interno de cada deployment antiguo ni que las dos claves pertenezcan a
la misma cuenta: no afirmar gasto cero basándose solamente en el panel.

Para probar IA más adelante: proyecto OpenAI específico y clave restringida,
solo Preview; por ejemplo presupuesto mensual de 5 USD, alertas tempranas y
**Enforce a hard limit** en Limits del proyecto de pruebas, si está disponible
para la cuenta. Las alertas solas no detienen gasto y la aplicación del límite
no es instantánea. No cambiar límites de la organización/producción. Si no se
puede verificar un límite exigible, mantener Preview sin clave hasta acordar
el control de gasto. [OpenAI: Spend limits](https://developers.openai.com/api/docs/guides/spend-limits).
No se ha creado ese proyecto ni alterado credenciales de IA en esta sesión.

La iteración 02 sigue completada en desarrollo. El Supabase alojado de pruebas
está inicializado y probado; **el aislamiento Vercel continúa pendiente** de los
cambios manuales, rebuild y verificaciones anteriores. No se ha aplicado ni validado
la corrección en producción. Los problemas de datos reales documentados en 02B
siguen requiriendo reconciliación autorizada por separado. No hay push autorizado.
GitHub Actions de estos cambios todavía no se ha ejecutado remotamente.
