2026-10-05

# Iteración 0 — Propuestas pendientes de OK

## 1. Cambio propuesto en `AGENTS.md` (se añade al final; no se modifica nada existente)

```markdown
## Entornos Supabase y cambios en producción

| Entorno | Proyecto | Ref | Uso |
| --- | --- | --- | --- |
| Local | Docker `becook-iteration02` | — | Desarrollo y tests (`db:start`, `test:db`) |
| Preproducción | becook-preview | qdhpdhnpcsfhmygjofqb | Desarrollo alojado y Preview de Vercel (`audit-opt`). Escritura permitida |
| Producción | becook | wejvptpkxlllfpskyisu | becook.xyz. Solo lectura de metadatos y agregados, salvo OK explícito de Sergio para una operación concreta |

- Verificar el ref del proyecto contra esta tabla antes de cada escritura remota.
- Flujo de cada cambio de esquema: migración en `supabase/migrations/` → local + CI →
  becook-preview (registrar en `supabase/hosted/applied-preview.json`) → validar Preview →
  producción con OK explícito (registrar en `supabase/hosted/applied-production.json`).
- Antes del merge a `main`, en producción solo cambios aditivos. Borrados o renombrados,
  después de desplegar el código que ya no los usa.
- Producción NO tiene backups automáticos. Antes de cualquier escritura en producción:
  avisar a Sergio, hacer backup completo (esquema, datos y roles) fuera del repositorio,
  confirmar que existe y guardar además una copia interna `backup_AAAAMMDD` de las filas afectadas.
- Prohibido: `supabase db push`, reset remoto, aplicar migraciones remotas porque pasen build o tests,
  imprimir datos personales de producción (solo recuentos y agregados).
- Vercel: el Preview de `audit-opt` usa becook-preview. Cualquier otra rama Preview usa las
  variables generales (producción): no desplegar ramas nuevas sin variables propias.
- Seguimiento: actualizar `PROGRESS.md` al cerrar cada iteración. Plan:
  `docs/development/2026-10-05-plan-implementacion-roadmap.md`.
```

## 2. Cuotas de IA (decisión D3)

Datos reales de producción (`menu_generation_requests`, jul–sep 2026):

| Flujo | Modelo | Coste medio | Coste máx. | Latencia media / p90 |
|---|---|---|---|---|
| Generar menú | gpt-5.6-sol | 0,088 $ | 0,175 $ | 40 s / 92 s |
| Generar menú (antiguo) | gpt-4.1-nano | 0,0003 $ | 0,0003 $ | 4 s / 5 s |
| Importar / compra | `OPENAI_MODEL` | **sin registrar** | — | — |

Uso: 2,3 generaciones por usuario y día activo de media; máximo 8 (pruebas de desarrollo).

| Límite | Propuesta inicial | Motivo |
|---|---|---|
| Generar menú | 4/día y 20/mes por usuario | Cubre uso normal (1–2/semana) y reintentos; peor caso ≈ 3,5 $/usuario/mes |
| Importar menú | 10/día por usuario | Modelo barato; pasará a parseo local en C6 |
| Generar compra | 10/día por usuario | Se volverá mayormente determinista en C4 |
| Concurrencia | 1 petición de IA en curso por usuario | Evita dobles clics y paralelismo abusivo |
| Por IP | 30 peticiones de IA/hora | Protección frente a abuso con varias cuentas |
| Presupuesto global | Corte en la app a 25 $/mes; avisos al 50 % y 80 % | Con uso típico (~0,7 $/usuario/mes) alcanza para ~30 usuarios activos |
| Límite en OpenAI | 30 $/mes en el panel de OpenAI (lo configuras tú) | Red de seguridad por encima del corte de la app |

Todos configurables por variable de entorno. Las cifras se revisarán con los costes reales de importación y compra, que A4 empezará a registrar.

## 3. Reconciliación de producción y backup (decisiones D4 y D6)

Script preparado (no ejecutado): `supabase/hosted/production/2026-10-05-reconcile-ownership.sql`.

| Qué | Filas | Acción |
|---|---|---|
| `menu_generation_requests` con perfil de otro usuario | 18 | Conservar fila, anular `profile_id` (menos destructivo que borrar) |
| `pantry_items` con perfil de otro usuario | 12 | Conservar fila, anular `profile_id` |
| Datos anteriores a Auth sin propietario (may–jun) | 4 perfiles, 8 semanas (+56 días, 45 listas, 1.479 artículos), 2 solicitudes, 22 despensa | Borrar (D4) |

Todo en una transacción, con copia interna previa en `backup_20261005` y comprobación final que aborta si queda algo incompatible. Después se aplica `enforce_reference_ownership` en producción.

**Efecto en la app actual de producción:** con la migración aplicada, si el defecto H3 vuelve a intentar asociar el perfil de otro usuario, la escritura fallará en lugar de mezclar datos. Es el comportamiento correcto; el arreglo de fondo llega en B1.

### Procedimiento (en orden)
1. **Backup completo (tú o Claude Code en tu Mac, con Docker Desktop arrancado).**
   - Supabase → proyecto `becook` → botón *Connect* → copiar la URI de *Session pooler* y poner la contraseña de la base de datos (si no la recuerdas: *Project Settings → Database → Reset password*; la app no la usa).
   - Desde la carpeta del repo (usa el CLI fijado en el proyecto):
     ```sh
     mkdir -p ~/Backups/becook/2026-10-05
     export PROD_DB_URL='postgresql://postgres.wejvptpkxlllfpskyisu:<CONTRASEÑA>@<host-del-pooler>:5432/postgres'
     npx supabase db dump --db-url "$PROD_DB_URL" -f ~/Backups/becook/2026-10-05/schema.sql
     npx supabase db dump --db-url "$PROD_DB_URL" --data-only -f ~/Backups/becook/2026-10-05/data.sql
     npx supabase db dump --db-url "$PROD_DB_URL" --role-only -f ~/Backups/becook/2026-10-05/roles.sql
     unset PROD_DB_URL
     ```
   - Comprobar que los tres ficheros existen y no están vacíos. **Fuera del repo**: contienen datos personales.
   - Verificar con `npx supabase db dump --help` si hace falta incluir el esquema `auth` en el volcado de datos.
2. **Validar el script en Supabase local** (Claude Code): ejecutarlo contra el contenedor local terminado en `ROLLBACK`.
3. **Me confirmas que el backup existe y das el OK** → ejecuto el script en producción por el conector.
4. Aplico `enforce_reference_ownership` en producción, verifico el esquema contra preview y registro la versión y su SHA-256 en `supabase/hosted/applied-production.json`.
