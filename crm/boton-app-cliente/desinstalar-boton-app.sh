#!/usr/bin/env bash
set -euo pipefail
P=/home/ubuntu/isp-crm/backend/public
for f in "$P"/*.html; do sed -i '/boton-app\.js/d' "$f"; done
rm -f "$P/boton-app.js"; echo "boton-app.js quitado (el endpoint queda inactivo sin el botón)"
