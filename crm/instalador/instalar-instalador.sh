#!/usr/bin/env bash
# EN EL VPS:  bash /tmp/casa/crm/instalador/instalar-instalador.sh
# 1) regla de seguridad (auth.ts + instalador.ts)  2) rutas del instalador (/api/instalador) montadas en index.ts
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
R=/home/ubuntu/isp-crm/backend/src
B=/home/ubuntu/backups; TS=$(date +%Y%m%d-%H%M%S); mkdir -p "$B"
IDX="$R/index.ts"
grep -q 'app.use("/api/clientes", clientesRoutes);' "$IDX" || { echo "ABORTO: no encuentro app.use de clientesRoutes en index.ts"; exit 1; }
LINEA=$(grep -n '^import clientesRoutes from' "$IDX" | head -1 | cut -d: -f1)
[ -n "$LINEA" ] || { echo "ABORTO: no encuentro el import de clientesRoutes en index.ts"; exit 1; }
cp -a "$R/middleware/auth.ts" "$B/auth.ts.pre-instalador-$TS"; cp -a "$IDX" "$B/index.ts.pre-instalador-$TS"
python3 "$HERE/aplicar-instalador.py" "$R/middleware/auth.ts" || true
mv -f "$R/middleware/auth.ts.pre-instalador" "$B/auth.ts.pre-instalador" 2>/dev/null || true
install -m 644 "$HERE/instalador.ts" "$R/middleware/instalador.ts"
install -m 644 "$HERE/instalador.routes.ts" "$R/routes/instalador.routes.ts"
if ! grep -q 'instalador.routes' "$IDX"; then
  sed -i "${LINEA}a import instaladorRoutes from \"./routes/instalador.routes\";" "$IDX"
  sed -i 's#^app.use("/api/clientes", clientesRoutes);#app.use("/api/clientes", clientesRoutes);\napp.use("/api/instalador", instaladorRoutes);#' "$IDX"
fi
chown ubuntu:ubuntu "$R/middleware/auth.ts" "$R/middleware/instalador.ts" "$R/routes/instalador.routes.ts" "$IDX" 2>/dev/null || true
echo "Ahora: cd /home/ubuntu/isp-crm/backend && sudo -u ubuntu npx tsc -p tsconfig.json --noEmit && sudo -u ubuntu npm run build && sudo -u ubuntu pm2 restart isp-crm-api --update-env"
echo "Luego:  bash $HERE/instalar-pantalla.sh   y crea el tipo de usuario 'Instalador' (con rol TECNICO) para quien corresponda."
echo "Prueba: cd /home/ubuntu/isp-crm/backend && node $HERE/probar-instalador.js correo_del_instalador"
echo "Deshacer: cp $B/auth.ts.pre-instalador-$TS $R/middleware/auth.ts ; cp $B/index.ts.pre-instalador-$TS $IDX ; rm $R/routes/instalador.routes.ts $R/middleware/instalador.ts"
