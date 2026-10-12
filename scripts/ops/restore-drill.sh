#!/usr/bin/env bash
# P37: simulacro de restauración en el Docker local verificado (nunca contra un proyecto alojado).
#   bash scripts/ops/restore-drill.sh --from-local        # vuelca la BD local (datos sintéticos) y la restaura
#   bash scripts/ops/restore-drill.sh ~/Backups/becook/X   # restaura una copia hecha con backup-production.sh
# Restaura en una base desechable (becook_restore_drill) dentro del contenedor local, compara filas
# por tabla con counts.txt, revisa esquema, RLS y propietarios, y la borra. La BD local compartida
# ("postgres") no se modifica. Solo imprime recuentos y tiempos.
# Con una copia de producción, los datos personales pasan por el Docker local durante el simulacro
# y se borran al terminar: hacerlo solo Sergio, en su máquina, con la copia fuera del repositorio.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ "$#" -ne 1 ]; then
  echo "Uso: bash scripts/ops/restore-drill.sh --from-local | <directorio de la copia>" >&2
  exit 2
fi
exec node scripts/ops/restore-drill.cjs "$1"
