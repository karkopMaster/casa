#!/usr/bin/env bash
# TÚNEL INVERSO hacia las OLT. Se ejecuta en un equipo DE TU RED (Linux, siempre encendido) que SÍ alcanza las OLT.
# Saca un túnel SSH hacia el VPS; el VPS entonces llega a cada OLT en 127.0.0.1:<puerto>.
#
#   bash tunel-olt.sh instalar <ip_vps> <ip_olt1:puerto_en_vps> [<ip_olt2:puerto_en_vps> ...]
# Ejemplo:  bash tunel-olt.sh instalar 158.69.205.211 192.168.88.10:2201 192.168.88.11:2202
# En el panel, la OLT se registra con host 127.0.0.1 y puerto 2201 (el de su túnel), usuario/clave reales de la OLT.
set -euo pipefail
[ "${1:-}" = instalar ] || { sed -n '2,8p' "$0"; exit 1; }
VPS="${2:?Falta la IP del VPS}"; shift 2
[ $# -ge 1 ] || { echo "Falta al menos una ip_olt:puerto"; exit 1; }
for m in "$@"; do [[ "$m" =~ ^[0-9.]+:[0-9]{4,5}$ ]] || { echo "Formato inválido: $m (usa 192.168.88.10:2201)"; exit 1; }; done

command -v autossh >/dev/null || sudo apt-get install -y autossh
KEY=/etc/olt-tunel/id_ed25519
sudo mkdir -p /etc/olt-tunel
[ -f "$KEY" ] || sudo ssh-keygen -q -t ed25519 -N "" -f "$KEY" -C "tunel-olt@$(hostname)"
R=""; for m in "$@"; do ip="${m%%:*}"; pt="${m##*:}"; R="$R -R 127.0.0.1:$pt:$ip:22"; done
sudo tee /etc/systemd/system/tunel-olt.service >/dev/null <<UNIT
[Unit]
Description=Tunel inverso hacia OLT Manager
After=network-online.target
[Service]
Environment=AUTOSSH_GATETIME=0
ExecStart=/usr/bin/autossh -M 0 -N -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new -i $KEY$R tunel@$VPS
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload; sudo systemctl enable tunel-olt >/dev/null
echo
echo "1) En el VPS corre:  bash preparar-tunel-vps.sh \"$(sudo cat $KEY.pub)\""
echo "2) Luego aquí:       sudo systemctl start tunel-olt && systemctl status tunel-olt --no-pager"
