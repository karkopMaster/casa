#!/usr/bin/env bash
# EN EL VPS:  bash /tmp/casa/crm/facturar-morosos/instalar-tope.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
F=/home/ubuntu/isp-crm/backend/src/services/billing.ts
mkdir -p /home/ubuntu/backups; cp -a "$F" "/home/ubuntu/backups/billing.ts.pre-tope-$(date +%Y%m%d-%H%M%S)"
python3 "$HERE/aplicar-tope.py" "$F"
mv -f "$F.pre-tope" /home/ubuntu/backups/billing.ts.pre-tope 2>/dev/null || true
chown ubuntu:ubuntu "$F" 2>/dev/null || true
echo "Ahora: cd /home/ubuntu/isp-crm/backend && sudo -u ubuntu npx tsc -p tsconfig.json --noEmit && sudo -u ubuntu npm run build && sudo -u ubuntu pm2 restart isp-crm-api --update-env"
echo "Después enciende el interruptor:  node $HERE/interruptores.js redcien --si --aplicar"
