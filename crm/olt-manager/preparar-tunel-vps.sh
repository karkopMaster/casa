#!/usr/bin/env bash
# EN EL VPS: crea el usuario 'tunel' que SOLO puede abrir túneles (sin shell, sin comandos).
#   bash preparar-tunel-vps.sh "<contenido de la llave pública que imprimió tunel-olt.sh>"
set -euo pipefail
PUB="${1:?Falta la llave pública (ssh-ed25519 AAAA...)}"
[[ "$PUB" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+ ]] || { echo "Eso no parece una llave pública ed25519"; exit 1; }
id tunel >/dev/null 2>&1 || sudo adduser --disabled-password --gecos "" --shell /usr/sbin/nologin tunel
sudo install -d -m 700 -o tunel -g tunel /home/tunel/.ssh
# restrict + port-forwarding: sin shell ni comandos; el sshd por defecto solo deja escuchar en 127.0.0.1 (GatewayPorts no).
echo "restrict,port-forwarding $PUB" | sudo tee /home/tunel/.ssh/authorized_keys >/dev/null
sudo chown tunel:tunel /home/tunel/.ssh/authorized_keys; sudo chmod 600 /home/tunel/.ssh/authorized_keys
echo "Listo. Ya puedes iniciar el túnel en tu red."
