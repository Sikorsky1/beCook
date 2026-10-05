<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Supabase local y migraciones

Seguir `docs/development/local-database.md` antes de cambiar el esquema o ejecutar
pruebas de escritura. Usar `npm run db:start`, `db:seed` y `test:db`; `npm run dev`
selecciona el entorno local verificado. La baseline es solo para bases locales
vacías y está fuera del historial remoto. Nunca aplicar automáticamente migraciones
remotas porque pasen el build o los tests. Los defectos RLS conocidos deben seguir
visibles en las pruebas hasta una corrección autorizada.

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
