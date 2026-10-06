# Detección local de secretos

Se usa [Gitleaks 8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1),
con sus reglas predeterminadas y una comprobación adicional de nombres de archivos.
No añade dependencias npm ni envía el contenido del repositorio a un servicio.

## Instalación y uso

Instala el binario oficial de la versión indicada para tu plataforma en el PATH,
o en `.tools/gitleaks` (directorio ignorado). Verifica el SHA256 del archivo
descargado contra `gitleaks_8.30.1_checksums.txt` de la misma publicación antes de
extraerlo. También puedes indicar una ruta mediante `GITLEAKS_BIN`.
En el entorno donde se preparó esta iteración ya está instalado en `.tools/gitleaks`.

```sh
git add -- <archivos-revisados>
npm run secrets:check
npm run secrets:test
```

El comando analiza **todos los blobs del índice de Git**, es decir, el árbol del
próximo commit. No se basa en la copia de trabajo: detecta también un secreto
preparado para commit que se haya borrado después sin volver a preparar el archivo.
No incluye archivos sin seguimiento ni cambios sin preparar; vuelve a ejecutarlo
después del último `git add`. Una eliminación preparada deja de formar parte del
análisis aunque se conserve una copia local ignorada.

Para activar la comprobación automática en un nuevo clon, primero comprueba que
no haya otros hooks que deban conservarse y después ejecuta:

```sh
git config --local core.hooksPath .githooks
```

Ya se activó en este clon, donde no existían hooks personalizados. No se ha añadido
CI: es un control local y no impide que alguien lo omita deliberadamente o publique
commits antiguos. Los colaboradores deben instalarlo también.

## Salida y excepciones

- Código 0: análisis completado sin hallazgos.
- Código 1: archivo local de credenciales o patrón de secreto detectado.
- Código 2: no se pudo completar la comprobación; el hook bloquea el commit.

La salida solo contiene archivo, regla, línea cuando procede y estado. El proceso
captura stdout/stderr de Gitleaks, exige redacción del 100 % y nunca muestra el
texto coincidente ni la excepción del proceso. La instantánea temporal tiene
permisos privados, trata los enlaces simbólicos como texto y se elimina al terminar.
No se crean informes persistentes con valores de secretos. Una terminación forzada
del proceso podría dejar la instantánea temporal en el directorio temporal del sistema.

Se bloquean exportaciones con `recovery…codes` o `backup…codes` en el nombre,
archivos `.env` (excepto las tres plantillas explícitas), claves privadas y rutas
habituales de credenciales de proveedores. Las plantillas siguen pasando por
Gitleaks: permitir su nombre no permite secretos en su contenido.

Actualmente no hay excepciones añadidas. Si hay un falso positivo, añade a
`.gitleaks.toml` una allowlist **de la regla concreta**, con `condition = "AND"`,
una ruta exacta anclada y un patrón exacto del valor sintético, más una justificación
escrita. Nunca añadas secretos reales a la configuración. No uses una allowlist
global, una baseline que oculte el incidente, ni excluyas carpetas enteras.
Los comentarios de bypass en código y los archivos `.gitleaksignore` se ignoran
deliberadamente. Un archivo local de credenciales debe retirarse del índice o,
si es una plantilla legítima, convertirse en una plantilla sin valores reales.

## Límites

Gitleaks detecta patrones, no demuestra ausencia de secretos ni comprueba si están
activos. Se habilita inspección de archivos comprimidos hasta dos niveles; no hay
OCR ni extracción específica de PDF/Numbers. Los submódulos y los conflictos del
índice bloquean el análisis en vez de omitirlos silenciosamente. La versión y las
reglas requieren revisiones periódicas; el proyecto upstream anuncia mantenimiento
de seguridad, sin nuevas funcionalidades. El saneamiento histórico y la revocación
de credenciales son tareas diferentes de este control preventivo.
