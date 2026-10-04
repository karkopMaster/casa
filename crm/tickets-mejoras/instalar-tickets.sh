#!/usr/bin/env bash
# EN EL VPS:  bash /tmp/casa/crm/tickets-mejoras/instalar-tickets.sh
# 1) Agrega DELETE /api/tickets/:id  2) Enlaza tickets-mejoras.js en el panel (asignar técnico al crear + eliminar radicados).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
R=/home/ubuntu/isp-crm; P=$R/backend/public; B=/home/ubuntu/backups; TS=$(date +%Y%m%d-%H%M%S)
python3 "$HERE/aplicar-eliminar.py" "$R/backend/src/routes/tickets.routes.ts"
install -m 644 "$HERE/tickets-mejoras.js" "$P/tickets-mejoras.js"
for f in $(grep -l 'assets/index-' "$P"/*.html); do
  cp -a "$f" "$B/$(basename "$f").pre-tickets-$TS"
  if grep -q 'tickets-mejoras.js' "$f"; then sed -i "s#/tickets-mejoras.js?v=[0-9A-Za-z-]*#/tickets-mejoras.js?v=$TS#" "$f"; echo "versión actualizada en $f"
  elif grep -q '</body>' "$f"; then sed -i "s#</body>#<script src=\"/tickets-mejoras.js?v=$TS\" defer></script>\n</body>#" "$f"; echo "enlazado en $f"
  else sed -i "s#</head>#<script src=\"/tickets-mejoras.js?v=$TS\" defer></script>\n</head>#" "$f"; echo "enlazado en $f"; fi
done
chown ubuntu:ubuntu "$P/tickets-mejoras.js" "$P"/*.html "$R/backend/src/routes/tickets.routes.ts" 2>/dev/null || true
echo "Listo. Compila y reinicia:"
echo "  cd $R/backend && npx tsc -p tsconfig.json --noEmit && npm run build && pm2 restart isp-crm-api --update-env"
