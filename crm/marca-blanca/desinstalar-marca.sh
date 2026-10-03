#!/usr/bin/env bash
# Quita marca.js de los HTML (no borra copias de seguridad).
set -euo pipefail
P=/home/ubuntu/isp-crm/backend/public
for f in "$P"/*.html; do sed -i '/marca\.js/d' "$f"; done
rm -f "$P/marca.js"; echo "marca.js quitado"
