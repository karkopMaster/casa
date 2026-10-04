#!/usr/bin/env bash
# EN EL VPS:  bash /tmp/casa/crm/apk-cliente/instalar-shell-cliente.sh
# Instala el armazón limpio de la app del CLIENTE (sin barras de administrador) y hace que
# gen-apk.sh lo use cuando el tipo es "cliente". La app de administración no cambia.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
A=/home/ubuntu/isp-crm/apkbase; G="$A/gen-apk.sh"
grep -q 'TIPO="${5:-admin}"' "$G" || { echo "ABORTO: primero corre instalar-apk-cliente.sh"; exit 1; }
install -m 644 -o ubuntu -g ubuntu "$HERE/classes-cliente.dex" "$A/classes-cliente.dex"
if ! grep -q 'classes-cliente.dex' "$G"; then
  cp -a "$G" "$G.pre-shell-cliente"
  python3 - "$G" <<'PY'
import sys
f=sys.argv[1]; s=open(f,encoding="utf-8").read()
v='cp "$A/classes.dex" "$W/app/classes.dex"'
assert s.count(v)==1, "no encontré la línea que copia classes.dex"
n='if [ "$TIPO" = cliente ]; then cp "$A/classes-cliente.dex" "$W/app/classes.dex"; else cp "$A/classes.dex" "$W/app/classes.dex"; fi'
open(f,"w",encoding="utf-8").write(s.replace(v,n))
PY
fi
bash -n "$G"
echo "Listo. Regenera el APK del cliente (descárgalo de nuevo desde /app/) e instálalo."
echo "Deshacer: cp $G.pre-shell-cliente $G"
