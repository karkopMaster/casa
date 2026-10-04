#!/usr/bin/env bash
# Quita el script del panel (el endpoint DELETE puede quedar; restaura tickets.routes.ts.pre-eliminar si quieres quitarlo).
set -euo pipefail
P=/home/ubuntu/isp-crm/backend/public
for f in $(grep -l 'tickets-mejoras.js' "$P"/*.html); do sed -i '/tickets-mejoras.js/d' "$f"; echo "quitado de $f"; done
rm -f "$P/tickets-mejoras.js"
