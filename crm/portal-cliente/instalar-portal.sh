#!/usr/bin/env bash
# EN EL VPS, como root o ubuntu:   bash /tmp/casa/crm/portal-cliente/instalar-portal.sh
# 1) copia portal.routes.ts al backend y lo monta en /api/portal (parche con copia de seguridad)
# 2) publica el portal del cliente en backend/public/cliente/ (sin datos de ejemplo)
# Después hay que compilar y reiniciar (ver LEEME.txt). No toca facturas, pagos ni contratos.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
R=/home/ubuntu/isp-crm
B=/home/ubuntu/backups; TS=$(date +%Y%m%d-%H%M%S)
IDX="$R/backend/src/index.ts"
grep -q 'import publicRoutes from "./routes/public.routes";' "$IDX" || { echo "ABORTO: no encuentro el import de publicRoutes en index.ts"; exit 1; }
grep -q 'app.use("/api/public", publicRoutes);' "$IDX" || { echo "ABORTO: no encuentro app.use publicRoutes en index.ts"; exit 1; }
cp -a "$IDX" "$B/index.ts.pre-portal-$TS"
install -m 644 "$HERE/portal.routes.ts" "$R/backend/src/routes/portal.routes.ts"
if ! grep -q 'portal.routes' "$IDX"; then
  sed -i 's#^import publicRoutes from "./routes/public.routes";#import publicRoutes from "./routes/public.routes";\nimport portalRoutes from "./routes/portal.routes";#' "$IDX"
  sed -i 's#^app.use("/api/public", publicRoutes);#app.use("/api/public", publicRoutes);\napp.use("/api/portal", portalRoutes);#' "$IDX"
fi
mkdir -p "$R/backend/public/cliente"
python3 - "$HERE/../../portal-cliente/index.html" "$R/backend/public/cliente/index.html" <<'PY'
import re, sys
s = open(sys.argv[1], encoding="utf-8").read()
s, n = re.subn(r"var DEMO = \{.*?promos:\[\][^;]*\};", "var DEMO = null;", s, count=1, flags=re.S)
assert n == 1, "no encontré el bloque DEMO"
open(sys.argv[2], "w", encoding="utf-8").write(s)
PY
chown -R ubuntu:ubuntu "$R/backend/public/cliente" "$R/backend/src/routes/portal.routes.ts" "$IDX" 2>/dev/null || true
if ! grep -q '^PORTAL_JWT_SECRET=' "$R/backend/.env" 2>/dev/null; then
  echo "FALTA: agrega al archivo $R/backend/.env la línea:  PORTAL_JWT_SECRET=$(openssl rand -hex 32)"
fi
echo "Listo. Siguiente: compilar y reiniciar (ver LEEME.txt)."
