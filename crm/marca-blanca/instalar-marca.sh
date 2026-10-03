#!/usr/bin/env bash
# Ejecutar EN EL VPS:  bash crm/marca-blanca/instalar-marca.sh
# Copia marca.js a backend/public y lo enlaza desde los HTML que cargan el bundle de React.
# Hace copia de cada HTML en /home/ubuntu/backups/ (fuera de la carpeta pública). No recompila nada.
set -euo pipefail
P=/home/ubuntu/isp-crm/backend/public
B=/home/ubuntu/backups
HERE="$(cd "$(dirname "$0")" && pwd)"
TS=$(date +%Y%m%d-%H%M%S)
install -m 644 "$HERE/marca.js" "$P/marca.js"
for f in $(grep -l 'assets/index-' "$P"/*.html); do
  cp -a "$f" "$B/$(basename "$f").pre-marca-$TS"
  if grep -q 'marca.js' "$f"; then sed -i "s#/marca.js?v=[0-9A-Za-z-]*#/marca.js?v=$TS#" "$f"; echo "actualizada la versión del script en: $f"; continue; fi
  if grep -q '</body>' "$f"; then sed -i "s#</body>#<script src=\"/marca.js?v=$TS\" defer></script>\n</body>#" "$f"
  else sed -i "s#</head>#<script src=\"/marca.js?v=$TS\" defer></script>\n</head>#" "$f"; fi
  echo "enlazado: $f"
done
chown ubuntu:ubuntu "$P/marca.js" "$P"/*.html 2>/dev/null || true
echo "Listo. Copias en $B/*.pre-marca-$TS"
