#!/usr/bin/env bash
set -euo pipefail
P=/home/ubuntu/isp-crm/backend/public
for f in "$P"/*.html; do sed -i '/tarjetas\.js/d' "$f"; done
rm -f "$P/tarjetas.js"; echo "tarjetas.js quitado"
