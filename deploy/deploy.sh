#!/usr/bin/env bash
# Ejecutar EN EL VPS. Publica SOLO site/index.html; no borra nada del webroot
# (img/, planes.json y demás archivos viven allí y no están en el repo).
# Antes de copiar, guarda una copia del index.html actual.
# Uso: WEBROOT=/ruta/real/del/sitio ./deploy/deploy.sh
set -euo pipefail
: "${WEBROOT:?Define WEBROOT con la carpeta que sirve el sitio}"
BRANCH="${BRANCH:-main}"
cd "$(dirname "$0")/.."
git fetch origin "$BRANCH" && git checkout "$BRANCH" && git pull --ff-only origin "$BRANCH"
[ -f "$WEBROOT/index.html" ] && cp -a "$WEBROOT/index.html" "$WEBROOT/index.html.bak.$(date +%Y%m%d-%H%M%S)"
install -m 644 site/index.html "$WEBROOT/index.html"
echo "Publicado $WEBROOT/index.html (copia de seguridad guardada junto a él)"
