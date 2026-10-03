#!/usr/bin/env bash
# EN EL VPS:  bash /tmp/casa/crm/app-descarga/instalar-app-descarga.sh
# Publica la página de descarga en /app/ (todos los dominios) y también dentro de la página de venta (para redcien.co/app/).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; P=/home/ubuntu/isp-crm/backend/public
for d in "$P/app" "$P/internet/app"; do mkdir -p "$d"; install -m 644 "$HERE/index.html" "$d/index.html"; done
chown -R ubuntu:ubuntu "$P/app" "$P/internet/app" 2>/dev/null || true
echo "Listo: /app/ publicado. No hace falta compilar ni reiniciar."
