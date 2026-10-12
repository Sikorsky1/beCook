#!/usr/bin/env bash
# P37: copia completa de PRODUCCIÓN (becook, wejvptpkxlllfpskyisu): esquema, datos, roles y
# recuentos por tabla. Copia saneada de ~/Backups/becook/backup-produccion.sh. Solo la ejecuta
# Sergio, en su Mac, antes de cada escritura en producción (AGENTS.md: producción no tiene
# backups automáticos). Solo lee de producción (pg_dump); nunca escribe en ella.
#
#   bash scripts/ops/backup-production.sh [etiqueta]     # → ~/Backups/becook/<etiqueta | AAAA-MM-DD>
#
# - La contraseña sale del llavero de macOS (servicio becook-prod-db, cuenta postgres.<ref>) o se
#   pide sin eco. No se imprime ni se guarda; los errores de la CLI se muestran con ella tapada.
#   Mientras dura el volcado viaja en los argumentos de la CLI (visible solo para tu usuario local).
# - La copia va fuera del repositorio, con permisos 700/600, y nunca sobrescribe otra.
# - data.sql se hace con --use-copy (una fila por línea) para poder contar filas: counts.txt.
#   Incluye auth.users, identities, sesiones y refresh tokens: la copia es tan sensible como la BD.
# - SHA256SUMS permite comprobar después que la copia no ha cambiado.
set -euo pipefail
umask 077

REF="wejvptpkxlllfpskyisu"
HOST="aws-0-eu-west-1.pooler.supabase.com"
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
BASE="${BECOOK_BACKUP_DIR:-$HOME/Backups/becook}"
LABEL="${1:-$(date +%F)}"
CLI="$ROOT/node_modules/.bin/supabase"

if [[ ! "$LABEL" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Etiqueta no válida: solo letras, números, punto, guion y guion bajo." >&2
  exit 2
fi
case "$BASE" in /*) ;; *) BASE="$PWD/$BASE" ;; esac
inside_repo() { case "$1/" in "$ROOT"/*) return 0 ;; *) return 1 ;; esac; }
if inside_repo "$BASE"; then echo "La copia no puede quedar dentro del repositorio." >&2; exit 2; fi
mkdir -p "$BASE"
DEST="$(cd "$BASE" && pwd -P)/$LABEL"
if inside_repo "$DEST"; then echo "La copia no puede quedar dentro del repositorio." >&2; exit 2; fi
if [ -e "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null)" ]; then
  echo "Ya existe una copia en $DEST: elige otra etiqueta (nunca se sobrescribe)." >&2
  exit 2
fi
[ -x "$CLI" ] || { echo "Falta la CLI de Supabase del proyecto (npm ci)." >&2; exit 2; }
mkdir -p "$DEST"
chmod 700 "$DEST"

echo "Copia de producción ($REF) en $DEST"
pw="$(security find-generic-password -a "postgres.$REF" -s becook-prod-db -w 2>/dev/null || true)"
if [ -z "$pw" ]; then
  read -rs -p "Contraseña de la BD de producción: " pw
  echo
fi
[ -n "$pw" ] || { echo "Sin contraseña: no se hace la copia." >&2; exit 2; }
enc="$(printf '%s' "$pw" | python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read(),safe=""))')"
unset pw
url="postgresql://postgres.$REF:${enc}@$HOST:5432/postgres"
cleanup() { unset url enc; }
trap cleanup EXIT

redact() { sed -e "s#${enc}#***#g" -e 's#postgresql://[^ ]*#postgresql://***#g' >&2; }
dump() {
  # Entorno mínimo: ninguna variable SUPABASE_*, DATABASE_URL ni .env interviene.
  env -i PATH="$PATH" HOME="$HOME" "$CLI" db dump --db-url "$url" "$@" 2> >(redact)
}

dump -f "$DEST/schema.sql"
dump --data-only --use-copy -f "$DEST/data.sql"
dump --role-only -f "$DEST/roles.sql"
cleanup

chmod 600 "$DEST"/*.sql
node "$ROOT/scripts/ops/count-dump-rows.cjs" "$DEST/data.sql" > "$DEST/counts.txt"
(cd "$DEST" && shasum -a 256 schema.sql data.sql roles.sql counts.txt > SHA256SUMS)
chmod 600 "$DEST/counts.txt" "$DEST/SHA256SUMS"

for file in schema.sql data.sql; do
  [ -s "$DEST/$file" ] || { echo "ERROR: $file está vacío; la copia no es válida." >&2; exit 1; }
done
grep -q "^public.profiles	" "$DEST/counts.txt" || { echo "ERROR: data.sql no contiene public.profiles." >&2; exit 1; }

# Solo agregados: tamaños, tablas y filas totales por esquema.
ls -la "$DEST"
awk -F'\t' '{split($1, p, "."); rows[p[1]] += $2; tables[p[1]]++} END {for (s in rows) printf "%s: %d tablas, %d filas\n", s, tables[s], rows[s]}' "$DEST/counts.txt" | sort
echo "Copia completa. Comprueba que existe antes de escribir en producción (AGENTS.md)."
echo "Simulacro opcional con esta copia: bash scripts/ops/restore-drill.sh \"$DEST\""
