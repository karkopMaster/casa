#!/usr/bin/env bash
# EN EL VPS:  bash /tmp/casa/crm/instalador/instalar-pantalla.sh
# Publica la pantalla sencilla de instaladores en  https://<tu-dominio>/instalador/
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
D=/home/ubuntu/isp-crm/backend/public/instalador
mkdir -p "$D"; install -m 644 "$HERE/pantalla/index.html" "$D/index.html"
chown -R ubuntu:ubuntu "$D" 2>/dev/null || true
echo "Listo: /instalador/  (no hace falta compilar ni reiniciar)"
