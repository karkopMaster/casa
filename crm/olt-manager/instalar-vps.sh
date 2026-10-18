#!/usr/bin/env bash
# EN EL VPS NUEVO (Ubuntu 22.04):  bash instalar-vps.sh olt.tudominio.com https://tu-conectapro.com
# Instala Docker, genera los secretos y levanta OLT Manager con HTTPS. No se pide ninguna clave por argumento.
set -euo pipefail
DOM="${1:?Uso: instalar-vps.sh <subdominio> <origen-de-conectapro>}"
ORIGEN="${2:?Falta el origen de ConectaPro, ej. https://app.redcien.com}"
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"

if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sudo sh; sudo usermod -aG docker "$USER" || true; fi
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s|^OLT_SECRET=.*|OLT_SECRET=$(openssl rand -hex 32)|; s|^SSO_SECRET=.*|SSO_SECRET=$(openssl rand -hex 32)|; s|^CONECTAPRO_ORIGIN=.*|CONECTAPRO_ORIGIN=$ORIGEN|" .env
  chmod 600 .env
fi
sed -i "s|olt.tudominio.com|$DOM|" Caddyfile
# Firewall: SSH, web. El puerto 3100 queda solo local.
sudo ufw allow OpenSSH >/dev/null 2>&1 || true; sudo ufw allow 80,443/tcp >/dev/null 2>&1 || true; sudo ufw --force enable >/dev/null 2>&1 || true
sudo docker compose up -d --build
echo
echo "Listo. Falta crear el usuario del panel y la API key:"
echo "  sudo docker compose run --rm --entrypoint node olt-manager dist/admin.js usuario admin '<clave_larga>'"
echo "  sudo docker compose run --rm --entrypoint node olt-manager dist/admin.js apikey conectapro"
echo "Guarda el SSO_SECRET de .env: ConectaPro lo necesita (variable OLT_SSO_SECRET)."
echo "Abre https://$DOM  (el registro DNS A de $DOM debe apuntar a esta IP)."
