#!/usr/bin/env bash
# Ejecutar EN EL VPS. Publica index.html, blog/, legal/, sitemap.xml y robots.txt.
# No borra nada del webroot (img/, planes.json, logo.jpg, etc. se conservan).
# Antes de reemplazar un archivo existente guarda una copia .bak.<fecha>.
# Uso: WEBROOT=/ruta/real/del/sitio ./deploy/deploy.sh
set -euo pipefail
: "${WEBROOT:?Define WEBROOT con la carpeta que sirve el sitio}"
BRANCH="${BRANCH:-main}"
cd "$(dirname "$0")/.."
git fetch origin "$BRANCH" && git checkout "$BRANCH" && git pull --ff-only origin "$BRANCH"
TS=$(date +%Y%m%d-%H%M%S)
put(){ # origen destino
  [ -f "$2" ] && cp -a "$2" "$2.bak.$TS"
  install -m 644 "$1" "$2"
}
PEND=$(grep -l 'class="pend"' site/legal/*.html 2>/dev/null || true)
if [ -n "$PEND" ]; then
  echo "AVISO: estos documentos legales aún tienen campos [PENDIENTE] visibles al público:"; echo "$PEND"
  echo "Completa los datos antes de publicar (Ctrl+C para cancelar, 5 s)..."; sleep 5
fi
mkdir -p "$WEBROOT/blog" "$WEBROOT/legal"
put site/index.html "$WEBROOT/index.html"
put site/sitemap.xml "$WEBROOT/sitemap.xml"
put site/robots.txt "$WEBROOT/robots.txt"
for f in site/blog/*.html; do put "$f" "$WEBROOT/blog/$(basename "$f")"; done
for f in site/legal/*.html; do put "$f" "$WEBROOT/legal/$(basename "$f")"; done
chown -R ubuntu:ubuntu "$WEBROOT/legal" "$WEBROOT/blog" "$WEBROOT/index.html" "$WEBROOT/sitemap.xml" "$WEBROOT/robots.txt" 2>/dev/null || true
echo "Publicado en $WEBROOT (copias de seguridad: *.bak.$TS)"
