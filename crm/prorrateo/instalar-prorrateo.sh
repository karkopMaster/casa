#!/usr/bin/env bash
# EN EL VPS:  bash /tmp/casa/crm/prorrateo/instalar-prorrateo.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
F=/home/ubuntu/isp-crm/backend/src/services/billing.ts
mkdir -p /home/ubuntu/backups; cp -a "$F" "/home/ubuntu/backups/billing.ts.pre-prorrateo-$(date +%Y%m%d-%H%M%S)"
python3 "$HERE/aplicar.py" "$F"
chown ubuntu:ubuntu "$F" 2>/dev/null || true
echo "Ahora: cd /home/ubuntu/isp-crm/backend && sudo -u ubuntu npx tsc -p tsconfig.json --noEmit && sudo -u ubuntu npm run build && sudo -u ubuntu pm2 restart isp-crm-api --update-env"
echo "Solo afecta facturas de prorrateo NUEVAS. Las ya creadas no se tocan."
