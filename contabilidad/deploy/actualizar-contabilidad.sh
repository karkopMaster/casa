#!/usr/bin/env bash
# EN EL VPS. Actualiza el CÓDIGO de la app ya instalada. No toca datos (~/contabilidad-data), ni Caddy, ni otras apps de pm2.
# Por defecto SOLO COMPRUEBA. Para actualizar: añadir --aplicar
#   REF=<commit-o-rama> bash actualizar-contabilidad.sh [--aplicar]      (REF por defecto: la rama de trabajo)
set -euo pipefail
APLICAR=0; [ "${1:-}" = "--aplicar" ] && APLICAR=1
REF="${REF:-claude/wizardly-babbage-oh7s3a}"; BASE="${BASE:-/home/ubuntu}"
APP="$BASE/contabilidad"; ENVF="$BASE/contabilidad.env"; TS=$(date +%Y%m%d-%H%M%S); BK="$BASE/backups/pre-actualizar-contabilidad-$TS"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
FALLOS=0; ok(){ echo "  [ok]    $*"; }; no(){ echo "  [FALLA] $*"; FALLOS=$((FALLOS+1)); }

[ -f "$APP/src/server.js" ] && ok "app instalada en $APP" || no "no encuentro la app en $APP"
[ -f "$ENVF" ] && ok "archivo de entorno $ENVF" || no "no encuentro $ENVF"
pm2 jlist 2>/dev/null | grep -q '"name":"contabilidad"' && ok "proceso pm2 'contabilidad' existe" || no "no existe el proceso pm2 'contabilidad'"
if [ -n "${TARBALL_LOCAL:-}" ]; then cp "$TARBALL_LOCAL" "$TMP/src.tgz"; else curl -fsSL "https://github.com/karkopMaster/casa/archive/$REF.tar.gz" -o "$TMP/src.tgz" && ok "paquete $REF descargado" || no "no pude descargar $REF"; fi
[ "$FALLOS" -gt 0 ] && { echo "== No se puede continuar ($FALLOS falla/s). No se cambió nada. =="; exit 1; }
tar xzf "$TMP/src.tgz" -C "$TMP" --wildcards '*/contabilidad/*'
NUEVO=$(ls -d "$TMP"/*/contabilidad | head -1); [ -f "$NUEVO/src/server.js" ] && ok "el paquete trae la app" || { echo "ABORTO: paquete inválido"; exit 1; }
rm -rf "$NUEVO/data"
(cd "$NUEVO" && npm test >/dev/null 2>&1) && ok "pruebas automáticas del código nuevo superadas" || { echo "ABORTO: las pruebas del código nuevo fallan; no se actualiza."; exit 1; }
grep -q '^SETUP_TOKEN=' "$ENVF" && ok "ya existe código de instalación" || echo "  [info]  se agregará un código de instalación al entorno"
if [ $APLICAR = 0 ]; then echo; echo "== Comprobación terminada: no se cambió nada. Para actualizar, repita con --aplicar =="; exit 0; fi

BUILD="$TS-$(openssl rand -hex 4)"; echo "$BUILD" > "$NUEVO/build-id"
mkdir -p "$BK"; mv "$APP" "$BK/app-anterior"; cp -a "$NUEVO" "$APP"; cp -a "$ENVF" "$BK/contabilidad.env"
grep -q '^SETUP_TOKEN=' "$ENVF" || echo "SETUP_TOKEN=$(openssl rand -hex 8)" >> "$ENVF"
restaurar(){ echo "Restaurando la versión anterior..."; rm -rf "$APP"; mv "$BK/app-anterior" "$APP"; cp -a "$BK/contabilidad.env" "$ENVF"; (set -a; . "$ENVF"; set +a; pm2 restart contabilidad --update-env >/dev/null); }
set -a; . "$ENVF"; set +a
pm2 restart contabilidad --update-env >/dev/null          # solo este proceso; nunca "restart all"
for i in $(seq 1 20); do curl -fsS "http://127.0.0.1:${PORT:-3010}/api/status" 2>/dev/null | grep -q "\"build\":\"$BUILD\"" && break; sleep 1; done
# se exige que responda ESTA versión (no la anterior): si el reinicio falló en silencio, se revierte
if curl -fsS "http://127.0.0.1:${PORT:-3010}/api/status" 2>/dev/null | grep -q "\"build\":\"$BUILD\""; then ok "la app nueva responde (versión $BUILD)"; else echo "La versión nueva no está corriendo."; restaurar; exit 1; fi
echo; echo "== Actualizado. Respaldo del código anterior: $BK/app-anterior =="
echo "   Código de instalación (se pide solo al crear el primer administrador): $SETUP_TOKEN"
