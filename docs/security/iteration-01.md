# Iteración 01 — Retirar credenciales de recuperación expuestas

Fecha: 2026-09-19. Alcance: exclusivamente paso 01 de fase 0.
Estado: **parcialmente completado, pendiente de confirmación de rotación**.

Actualización de publicación: el usuario ha autorizado el commit y push de esta
iteración en `audit-opt`, que será la rama de publicación hasta nuevo aviso.
Esta autorización no confirma la rotación ni autoriza sanear el historial.
Las referencias siguientes al estado sin commit describen la entrega inicial.

## 1. Estado inicial

- Rama: `main`; HEAD: `6eebc8175c63861e91736202c4028cfc3acca6cf`.
- `vercel/recovery-codes.txt` existía y estaba seguido por Git.
- El commit que introduce la ruta en el historial ordinario local es
  `bcbed8ed1f3fb3e7b9acb6652e9f2f0b7f9e4f42`, del 17 de julio de 2026.
- Había seis cambios locales ajenos: dos PDF de auditoría eliminados de su ruta
  anterior, dos PDF sin seguimiento en `original_audit/` y dos archivos nuevos del
  roadmap (`.md` y `.pdf`). Se conservaron sus estados y contenidos.
- `.env*`, `*.pem` y `.vercel` ya estaban ignorados. No había detector de secretos
  ni hooks personalizados activos.

## 2. Archivos y cambios

| Archivo | Cambio |
| --- | --- |
| `vercel/recovery-codes.txt` | Eliminación preparada en el índice; copia local conservada e ignorada. |
| `.gitignore` | Excluye exportaciones de recuperación, claves privadas y credenciales locales; permite tres nombres de plantilla `.env`. |
| `.gitleaks.toml` | Hereda las reglas de Gitleaks sin excepciones globales añadidas. |
| `scripts/check-secrets.cjs` | Analiza el índice completo; bloquea nombres sensibles; publica solo metadatos. |
| `.githooks/pre-commit` | Ejecuta el detector antes de cada commit. |
| `tests/secrets.test.cjs` | Cinco pruebas locales con datos ficticios y repositorios temporales. |
| `package.json` | Añade `secrets:check` y `secrets:test`, sin cambiar dependencias. |
| `README.md` | Enlaza las instrucciones del control. |
| `docs/security/secret-detection.md` | Instalación, uso, excepciones y límites. |
| `docs/security/iteration-01.md` | Este informe, sin valores de credenciales. |

Configuración local adicional: `core.hooksPath=.githooks`; binario Gitleaks 8.30.1
en `.tools/gitleaks`, ignorado, descargado de la publicación oficial y comprobado
contra su SHA256. Estos dos elementos no viajan automáticamente a nuevos clones.
No se cambiaron archivos funcionales, dependencias, endpoints ni servicios.

La copia local de recuperación se conserva deliberadamente porque la invalidez
de las credenciales no está confirmada. No pertenece al árbol del próximo commit.
No se debe abrir un diff de su eliminación para revisar esta iteración: mostraría
los valores antiguos. Revisar únicamente nombres/estadísticas y los controles nuevos.

## 3. Exclusiones y detección

Las 21 comprobaciones de `.gitignore` pasan: recuperación, `.env.local`, claves
privadas y credenciales de proveedores quedan excluidos; plantillas, `vercel.json`,
configuración Next/TypeScript/npm, código fuente y recursos públicos quedan permitidos.
Ningún archivo seguido restante queda ignorado accidentalmente.

Ejecutar después del último `git add`:

```sh
npm run secrets:check
npm run secrets:test
```

El detector bloquea también un archivo sensible incorporado con `git add -f`.
Devuelve 1 ante hallazgos y 2 si el análisis no puede completarse. No muestra valores
ni fragmentos de coincidencias. Las excepciones futuras deben limitarse a una regla,
una ruta y un valor sintético concreto, con justificación; no se añadió ninguna.

El análisis inicial del índice y de todos los commits alcanzables por referencias
locales, con las reglas predeterminadas de Gitleaks, no produjo otros hallazgos.
La revisión de nombres tampoco encontró otros archivos sensibles seguidos.
**Esto no certifica ausencia de secretos:** no hay OCR/extracción de PDF o Numbers,
no se han inspeccionado clones ajenos, y no se ha comprobado la validez de credenciales.
El archivo de recuperación se identifica por su ruta; Gitleaks predeterminado no lo
detectó, razón por la que se añadió el bloqueo específico por nombre.

## 4. Validación

- Eliminación del índice confirmada; copia local conservada y excluida.
- Pruebas del detector: 5/5, con un token enteramente ficticio, sin valores en salida.
- `npm test`: 12/12, incluidas pruebas existentes con transporte simulado; sin consumo
  de OpenAI ni escrituras de producción.
- `npm run typecheck`: falla por identificador duplicado `LayoutProps` en el archivo
  generado `.next/types/routes.d 2.ts`, ajeno a estos cambios.
- `npm run secrets:check`: pasa sobre los 137 archivos del índice final.
- `npm run lint` y `npm run build`: no completados. Quedaron bloqueados sin producir
  resultados; las muestras de ambos procesos con Node 25 muestran espera en
  `read`/`uv_fs_read` durante la carga de módulos. Se reintentaron con el Node 24
  ya instalado, sin resultado final durante más de dos minutos; al recoger la
  salida, el segundo build había anunciado el inicio de la compilación. Se
  terminaron únicamente los procesos iniciados para estas comprobaciones. No se
  afirma que lint o build hayan pasado ni se modificaron dependencias para repararlos.
- Sintaxis de ambos scripts Node y del hook shell: correcta. `git diff --cached
  --check`: correcto. El hook está versionado como ejecutable y configurado localmente.
- El conjunto preparado contiene exactamente los diez archivos de esta iteración;
  HEAD sigue en el commit inicial. Las configuraciones funcionales siguen disponibles.
- Se verificaron los hashes/ausencias de los seis cambios previos: conservados.
- No se ejecutaron pruebas `test:supabase*`, benchmark, despliegues ni migraciones.

## 5. Exposición histórica

El archivo está en el árbol de `main` local y en el historial accesible. La consulta
de solo lectura `git ls-remote` confirmó que `main` remoto apunta a
`feb0a7a9e566000872fff7c9b9adced2463edc88`, cuyo árbol local contiene la ruta.
Por tanto, la exposición llegó al remoto; no es solo una posibilidad.

No aparece en `feat/design-handoff` (local/remoto) ni en las etiquetas
`v0.2-supabase-foundation` y `v0.3-ai-menu-foundation`, según las referencias revisadas.
También está en dos árboles de instantáneas locales bajo `refs/codex/turn-diffs/`
(una captura y un checkpoint). `origin/HEAD` y `origin/main` también lo referencian.
No se inspeccionaron referencias ocultas del servidor, pull requests, reflogs ni
objetos inalcanzables. No se puede descartar distribución en clones, forks, copias
de seguridad, logs o artefactos. La privacidad del repositorio no elimina ese riesgo.

Recomendación: priorizar la confirmación de revocación; después, autorizar y coordinar
un saneamiento del historial que retire la ruta de todas las referencias afectadas,
incluidas las instantáneas locales. Prepararlo en un clon dedicado, inventariar
referencias/PR, acordar una ventana sin escrituras y verificar el resultado antes de
actualizar el remoto. Reescribir cambia hashes y exige actualizar referencias remotas,
coordinar ramas, etiquetas, PR y clones; los clones antiguos pueden reintroducir el
historial. Podría requerirse ayuda del proveedor para referencias/cachés del servidor.
Ni esa operación garantiza eliminar todas las copias distribuidas ni sustituye la
revocación. **No se ha reescrito ningún historial ni actualizado el remoto.**

## 6. Acción personal en Vercel y condición de cierre

**Punto operativo detenido:** no se ha verificado un acceso alternativo a tu cuenta.
La sesión actual del navegador no constituye esa verificación.

1. Conserva tu sesión actual. En los ajustes de autenticación de tu cuenta,
   identifica un segundo factor disponible: aplicación TOTP o passkey registrada.
2. Abre una ventana privada u otro perfil y prueba un inicio de sesión nuevo con tu
   conexión habitual, completando el segundo factor de Vercel con ese método,
   **sin usar ninguno de los códigos de recuperación expuestos**. Verifica que
   llegas a la cuenta correcta. El 2FA de GitHub por sí solo no demuestra que puedas
   completar el segundo factor de Vercel.
3. Si no puedes completarlo, detente y resuelve el acceso con el soporte de Vercel.
   No elimines los factores existentes ni los códigos para intentar desbloquearlo.
4. Comunica únicamente qué método funcionó y que pudiste acceder; no compartas
   códigos, capturas con códigos, contraseñas, tokens ni claves.

Solo después de confirmar ese acceso, queda pendiente el procedimiento admitido por
Vercel en los ajustes de autenticación/2FA para gestionar y generar nuevos códigos.
La [documentación oficial de 2FA](https://vercel.com/docs/two-factor-authentication)
admite TOTP y passkeys y permite generar otro conjunto, pero **no afirma expresamente
que los anteriores queden invalidados**. Antes de dar la rotación por confirmada,
debe existir confirmación explícita en la interfaz o del soporte sobre la invalidación
de los códigos previos. Si no la hay, solicitarla al soporte; no inferirla por ver
códigos nuevos. Guardar el nuevo conjunto en un gestor de contraseñas fuera del
repositorio y de carpetas distribuidas. No se ha realizado ninguna de estas operaciones.

| Estado requerido | Situación |
| --- | --- |
| Código preparado | Eliminación del archivo en el índice y controles preparados, sin commit. |
| Rotación pendiente | Sí: faltan acceso alternativo verificado y confirmación de invalidez de códigos previos. |
| Rotación confirmada | No. |
| Historial evaluado | Sí; se recomienda saneamiento posterior coordinado, aún no autorizado ni ejecutado. |

Para cerrar el paso 01 faltan tu revisión de los cambios y la confirmación de Vercel
de que los códigos expuestos ya no sirven, después de verificar el acceso alternativo.
El saneamiento posterior requiere autorización separada. No hay commit, push,
force-push, rebase ni revocación unilateral.
