#!/usr/bin/env bash
# Comprueba, con un usuario instalador REAL, que solo puede lo permitido. No crea clientes (solo pide el enlace de registro).
# Uso: bash probar-instalador.sh https://tu-dominio usuario_o_correo     (te pedirá la clave sin mostrarla)
set -u
BASE="${1:?Uso: probar-instalador.sh https://dominio usuario}"; USU="${2:?falta el usuario}"
read -rsp "Clave del instalador: " CL; echo
RESP=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' --data "$(python3 -c 'import json,sys;print(json.dumps({"email":sys.argv[1],"username":sys.argv[1],"password":sys.argv[2]}))' "$USU" "$CL")"); unset CL
TOKEN=$(echo "$RESP" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("token") or d.get("accessToken") or "")' 2>/dev/null)
[ -n "$TOKEN" ] || { echo "No pude iniciar sesión (¿tiene 2FA o los datos son otros?). Respuesta sin token."; exit 1; }
t() { code=$(curl -s -o /dev/null -w "%{http_code}" -X "$1" "$BASE$2" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' ${3:+--data "$3"}); ok=NO; [ "$4" = permitido ] && [ "$code" != 403 ] && [ "$code" != 401 ] && ok=SI; [ "$4" = bloqueado ] && [ "$code" = 403 ] && ok=SI; printf "%-10s %-6s %-32s -> %s  [%s]\n" "$4" "$1" "$2" "$code" "$ok"; }
echo "--- debe PASAR ---"
t GET /api/auth/me "" permitido
t POST /api/clientes/link-registro "{}" permitido
echo "--- debe estar BLOQUEADO (403) ---"
for r in /api/clientes /api/clientes/exportar /api/facturas /api/contratos /api/dashboard /api/usuarios /api/empresa /api/morosos-mikrotik /api/contabilidad /api/auditoria /api/servidores /api/chat-whatsapp /api/planes /api/solicitudes; do t GET $r "" bloqueado; done
t PUT /api/clientes/x '{}' bloqueado
t DELETE /api/clientes/x "" bloqueado
t POST /api/facturas '{}' bloqueado
t POST /api/clientes/..%2ffacturas '{}' bloqueado
echo "Todo debe decir [SI]."
