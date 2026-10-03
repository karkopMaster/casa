#!/usr/bin/env bash
# En el VPS:  bash /tmp/casa/crm/dashboard-mikrotik/instalar-tarjetas.sh
# Copia tarjetas.js a backend/public y lo enlaza en los HTML que cargan el bundle. Copia de seguridad en /home/ubuntu/backups/.
set -euo pipefail
P=/home/ubuntu/isp-crm/backend/public; B=/home/ubuntu/backups
HERE="$(cd "$(dirname "$0")" && pwd)"; TS=$(date +%Y%m%d-%H%M%S)
install -m 644 "$HERE/tarjetas.js" "$P/tarjetas.js"
for f in $(grep -l 'assets/index-' "$P"/*.html); do
  cp -a "$f" "$B/$(basename "$f").pre-tarjetas-$TS"
  if grep -q 'tarjetas.js' "$f"; then echo "ya enlazado: $f"; continue; fi
  if grep -q '</body>' "$f"; then sed -i 's#</body>#<script src="/tarjetas.js?v=1" defer></script>\n</body>#' "$f"
  else sed -i 's#</head>#<script src="/tarjetas.js?v=1" defer></script>\n</head>#' "$f"; fi
  echo "enlazado: $f"
done
chown ubuntu:ubuntu "$P/tarjetas.js" "$P"/*.html 2>/dev/null || true
echo "Listo. Recarga con Ctrl+Shift+R."
