#!/usr/bin/env bash
# EN EL VPS:  bash /tmp/casa/crm/instalador/instalar-instalador.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
M=/home/ubuntu/isp-crm/backend/src/middleware
mkdir -p /home/ubuntu/backups; cp -a "$M/auth.ts" "/home/ubuntu/backups/auth.ts.pre-instalador-$(date +%Y%m%d-%H%M%S)"
python3 "$HERE/aplicar-instalador.py" "$M/auth.ts"
mv -f "$M/auth.ts.pre-instalador" /home/ubuntu/backups/auth.ts.pre-instalador 2>/dev/null || true
install -m 644 "$HERE/instalador.ts" "$M/instalador.ts"
chown ubuntu:ubuntu "$M/auth.ts" "$M/instalador.ts" 2>/dev/null || true
echo "Ahora: cd /home/ubuntu/isp-crm/backend && sudo -u ubuntu npx tsc -p tsconfig.json --noEmit && sudo -u ubuntu npm run build && sudo -u ubuntu pm2 restart isp-crm-api --update-env"
echo "Luego: crea el tipo de usuario 'Instalador' (Tipos de usuario) y asigna ese tipo a quien corresponda. Prueba con: bash $HERE/probar-instalador.sh"
