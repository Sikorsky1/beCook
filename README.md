# beCook

Aplicación Next.js, TypeScript y Supabase.

## Desarrollo local seguro

Requisitos: Node 24, npm y Docker local arrancado.

```sh
npm ci
npm run db:start
npm run db:seed
npm run dev
```

`dev` utiliza Supabase local verificado y desactiva las llamadas reales de IA.
No hace falta copiar claves de producción ni cambiar `.env.local`.

Consultar la [guía de entorno, fixtures, pruebas y migraciones](docs/development/local-database.md)
y el [informe de la iteración 02](docs/development/iteration-02.md).

```sh
npm test
npm run test:db
npm run lint
npm run typecheck
npm run build
npm run db:stop
```

Las pruebas de base comprueban aislamiento RLS e integridad de las seis relaciones
privadas. Ver el [cierre 02B](docs/development/iteration-02b.md). La migración está
validada en desarrollo; su aplicación en producción requiere reconciliación de
datos y autorización separadas. No hay despliegue en este workflow de CI.

## Secretos antes de un commit

Instalar Gitleaks 8.30.1 con checksum verificado y ejecutar `npm run secrets:check`
después de preparar los archivos con Git. Consultar
[instalación, hook local y falsos positivos](docs/security/secret-detection.md).
