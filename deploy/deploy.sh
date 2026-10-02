#!/usr/bin/env bash
# Ejecutar EN EL VPS: descarga la última versión y publica el sitio.
# Uso: sudo ./deploy/deploy.sh   (WEBROOT por defecto /var/www/redcien)
set -euo pipefail
BRANCH="${BRANCH:-main}"
WEBROOT="${WEBROOT:-/var/www/redcien}"
cd "$(dirname "$0")/.."
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
mkdir -p "$WEBROOT"
rsync -a --delete site/ "$WEBROOT"/
echo "Publicado en $WEBROOT"
