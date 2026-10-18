#!/usr/bin/env bash
# EN EL VPS, dentro de crm/olt-manager. Dos formas de tener HTTPS sin comprar dominio:
#   bash dominio-gratis.sh duckdns <subdominio> <token> [ip_de_conectapro]   -> https://<subdominio>.duckdns.org  (FIJO, recomendado)
#     con ip_de_conectapro, la API /api/* (tipo SmartOLT) solo responde a esa IP.
#   bash dominio-gratis.sh cloudflared                    -> https://xxxx.trycloudflare.com    (CAMBIA al reiniciar)
# DuckDNS: crea cuenta gratis en https://www.duckdns.org (entra con Google/GitHub), crea un subdominio y copia el token.
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"
MODO="${1:?Uso: dominio-gratis.sh duckdns <subdominio> <token> | cloudflared}"

case "$MODO" in
duckdns)
  SUB="${2:?Falta el subdominio (sin .duckdns.org)}"; TOKEN="${3:?Falta el token de DuckDNS}"
  [[ "$SUB" =~ ^[a-z0-9-]{3,40}$ ]] || { echo "Subdominio inválido (solo minúsculas, números y guiones)"; exit 1; }
  [[ "$TOKEN" =~ ^[0-9a-fA-F-]{20,60}$ ]] || { echo "Token con formato raro"; exit 1; }
  R=$(curl -fsS "https://www.duckdns.org/update?domains=$SUB&token=$TOKEN&ip=")
  [ "$R" = "OK" ] || { echo "DuckDNS respondió '$R'. Revisa subdominio y token."; exit 1; }
  # Mantiene la IP al día (cada 5 min). El token queda solo legible por root.
  sudo install -m 600 /dev/null /etc/duckdns.env
  printf 'SUB=%s\nTOKEN=%s\n' "$SUB" "$TOKEN" | sudo tee /etc/duckdns.env >/dev/null
  sudo tee /etc/cron.d/duckdns >/dev/null <<'CRON'
*/5 * * * * root . /etc/duckdns.env && curl -fsS "https://www.duckdns.org/update?domains=$SUB&token=$TOKEN&ip=" >/dev/null 2>&1
CRON
  DOM="$SUB.duckdns.org"
  CP_IP="${4:-}"
  if [ -n "$CP_IP" ]; then
    [[ "$CP_IP" =~ ^[0-9.]+$ ]] || { echo "IP de ConectaPro inválida"; exit 1; }
    printf '%s {\n\t@apiajena {\n\t\tpath /api/*\n\t\tnot remote_ip %s\n\t}\n\trespond @apiajena 403\n\treverse_proxy 127.0.0.1:3100\n}\n' "$DOM" "$CP_IP" > Caddyfile
  else
    printf '%s {\n\treverse_proxy 127.0.0.1:3100\n}\n' "$DOM" > Caddyfile
  fi
  sudo docker compose up -d caddy && sudo docker compose restart caddy   # recarga el Caddyfile nuevo
  sed -i '/^# DOMINIO=/d' .env; echo "# DOMINIO=$DOM" >> .env
  echo "Listo: https://$DOM  (el certificado tarda ~1 minuto la primera vez)."
  echo "En ConectaPro usa OLT_MANAGER_URL=https://$DOM"
  ;;
cloudflared)
  if ! command -v cloudflared >/dev/null; then
    curl -fsSL -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
    sudo dpkg -i /tmp/cloudflared.deb
  fi
  sudo docker compose stop caddy 2>/dev/null || true
  sudo tee /etc/systemd/system/cloudflared-olt.service >/dev/null <<'UNIT'
[Unit]
Description=Tunel Cloudflare para OLT Manager
After=network-online.target
[Service]
ExecStart=/usr/bin/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:3100
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
  sudo systemctl daemon-reload; sudo systemctl enable --now cloudflared-olt
  for _ in $(seq 1 20); do
    U=$(sudo journalctl -u cloudflared-olt --no-pager 2>/dev/null | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1 || true)
    [ -n "$U" ] && break; sleep 2
  done
  echo "Dirección: ${U:-no apareció, mira: sudo journalctl -u cloudflared-olt}"
  echo "AVISO: esta dirección CAMBIA si se reinicia el servicio o el VPS; habrá que actualizar OLT_MANAGER_URL en ConectaPro y CONECTAPRO_ORIGIN no cambia."
  ;;
*) echo "Modo desconocido"; exit 1 ;;
esac
