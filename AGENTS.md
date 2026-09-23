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
