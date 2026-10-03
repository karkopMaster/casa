#!/usr/bin/env bash
# EN EL VPS:  bash /tmp/casa/crm/apk-cliente/instalar-apk-cliente.sh
# 1) agrega el tipo "cliente" a apkbase/gen-apk.sh   2) copia la ruta y la monta en /descargar-app-cliente.apk
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
R=/home/ubuntu/isp-crm; B=/home/ubuntu/backups; TS=$(date +%Y%m%d-%H%M%S)
IDX="$R/backend/src/index.ts"
grep -q 'app.use("/descargar-app.apk", apkClienteRoutes);' "$IDX" || { echo "ABORTO: no encuentro app.use de apkClienteRoutes en index.ts"; exit 1; }
LINEA_IMPORT=$(grep -n 'import apkClienteRoutes from' "$IDX" | head -1 | cut -d: -f1)
[ -n "$LINEA_IMPORT" ] || { echo "ABORTO: no encuentro el import de apkClienteRoutes en index.ts"; exit 1; }
cp -a "$R/apkbase/gen-apk.sh" "$B/gen-apk.sh.pre-cliente-$TS"; cp -a "$IDX" "$B/index.ts.pre-apkcliente-$TS"
python3 "$HERE/parchar-gen-apk.py" "$R/apkbase/gen-apk.sh" || true
bash -n "$R/apkbase/gen-apk.sh"
install -m 644 "$HERE/apkPortal.routes.ts" "$R/backend/src/routes/apkPortal.routes.ts"
if ! grep -q 'apkPortal.routes' "$IDX"; then
  sed -i "${LINEA_IMPORT}a import apkPortalRoutes from \"./routes/apkPortal.routes\";" "$IDX"
  sed -i 's#^app.use("/descargar-app.apk", apkClienteRoutes);#app.use("/descargar-app.apk", apkClienteRoutes);\napp.use("/descargar-app-cliente.apk", apkPortalRoutes);#' "$IDX"
fi
chown ubuntu:ubuntu "$R/apkbase/gen-apk.sh" "$R/backend/src/routes/apkPortal.routes.ts" "$IDX" 2>/dev/null || true
echo "Listo. Compila y reinicia (ver LEEME.txt)."
