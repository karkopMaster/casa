#!/usr/bin/env bash
# EN EL VPS:  bash /tmp/casa/crm/boton-app-cliente/instalar-boton-app.sh
# Instala el endpoint (clienteApp.routes.ts, montado en /api/cliente-app) y enlaza boton-app.js en el HTML del panel.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
R=/home/ubuntu/isp-crm; P=$R/backend/public; B=/home/ubuntu/backups; TS=$(date +%Y%m%d-%H%M%S)
IDX="$R/backend/src/index.ts"
grep -q 'app.use("/api/portal", portalRoutes);' "$IDX" || { echo "ABORTO: instala primero el portal del cliente (crm/portal-cliente/instalar-portal.sh)"; exit 1; }
cp -a "$IDX" "$B/index.ts.pre-botonapp-$TS"
install -m 644 "$HERE/clienteApp.routes.ts" "$R/backend/src/routes/clienteApp.routes.ts"
if ! grep -q 'clienteApp.routes' "$IDX"; then
  sed -i 's#^import portalRoutes from "./routes/portal.routes";#import portalRoutes from "./routes/portal.routes";\nimport clienteAppRoutes from "./routes/clienteApp.routes";#' "$IDX"
  sed -i 's#^app.use("/api/portal", portalRoutes);#app.use("/api/portal", portalRoutes);\napp.use("/api/cliente-app", clienteAppRoutes);#' "$IDX"
fi
install -m 644 "$HERE/boton-app.js" "$P/boton-app.js"
for f in $(grep -l 'assets/index-' "$P"/*.html); do
  cp -a "$f" "$B/$(basename "$f").pre-botonapp-$TS"
  if grep -q 'boton-app.js' "$f"; then sed -i "s#/boton-app.js?v=[0-9A-Za-z-]*#/boton-app.js?v=$TS#" "$f"; echo "versión actualizada en $f"
  elif grep -q '</body>' "$f"; then sed -i "s#</body>#<script src=\"/boton-app.js?v=$TS\" defer></script>\n</body>#" "$f"; echo "enlazado en $f"
  else sed -i "s#</head>#<script src=\"/boton-app.js?v=$TS\" defer></script>\n</head>#" "$f"; echo "enlazado en $f"; fi
done
chown ubuntu:ubuntu "$P/boton-app.js" "$P"/*.html "$R/backend/src/routes/clienteApp.routes.ts" "$IDX" 2>/dev/null || true
echo "Listo. Compila y reinicia (ver LEEME.txt)."
