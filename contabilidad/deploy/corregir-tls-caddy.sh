#!/usr/bin/env bash
# EN EL VPS. Corrige el certificado del bloque "contabilidad" cuando el Caddyfile tiene un comodín con "tls { on_demand }"
# (el comodín se "come" al subdominio y el CRM rechaza el certificado). Agrega al bloque:  tls { issuer acme }
# Por defecto SOLO COMPRUEBA (adapta el Caddyfile nuevo y verifica la política de certificado, sin cambiar nada).
#   DOMINIO=contabilidad.conectpro.co bash corregir-tls-caddy.sh            # comprobar
#   DOMINIO=contabilidad.conectpro.co bash corregir-tls-caddy.sh --aplicar  # aplicar
set -euo pipefail
APLICAR=0; [ "${1:-}" = "--aplicar" ] && APLICAR=1
: "${DOMINIO:?Defina DOMINIO}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
BASE="${BASE:-/home/ubuntu}"; TS=$(date +%Y%m%d-%H%M%S); BK="$BASE/backups/pre-tls-fix-$TS"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

grep -q "^$DOMINIO {" "$CADDYFILE" || { echo "ABORTO: no encuentro el bloque '$DOMINIO {' en $CADDYFILE"; exit 1; }
awk -v d="$DOMINIO {" '$0==d{f=1} f&&/issuer acme/{x=1} $0=="}"{f=0} END{exit !x}' "$CADDYFILE" && { echo "El bloque ya tiene 'issuer acme'. Nada que hacer."; exit 0; }

awk -v d="$DOMINIO {" '$0==d{print; print "\ttls {"; print "\t\tissuer acme"; print "\t}"; next} 1' "$CADDYFILE" > "$TMP/nuevo"
caddy validate --config "$TMP/nuevo" --adapter caddyfile >/dev/null 2>&1 && echo "[ok] el Caddyfile nuevo es válido" || { echo "ABORTO: el Caddyfile nuevo no valida (¿versión de Caddy sin 'issuer'?). No se cambió nada."; exit 1; }

# la política de certificado de este dominio debe existir, ser propia y NO ser on_demand
caddy adapt --config "$TMP/nuevo" --adapter caddyfile 2>/dev/null > "$TMP/nuevo.json"
python3 - "$TMP/nuevo.json" "$DOMINIO" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1])); dom = sys.argv[2]
pols = cfg.get("apps", {}).get("tls", {}).get("automation", {}).get("policies", [])
mine = [p for p in pols if dom in (p.get("subjects") or [])]
if not mine: print("[FALLA] no se creó una política de certificado propia para", dom); sys.exit(1)
if any(p.get("on_demand") for p in mine): print("[FALLA] la política de", dom, "sigue siendo on_demand"); sys.exit(1)
first = next(i for i, p in enumerate(pols) if dom in (p.get("subjects") or []))
wild = [i for i, p in enumerate(pols) if p.get("on_demand") and any(s.startswith("*.") and dom.endswith(s[1:]) for s in (p.get("subjects") or []))]
if wild and min(wild) < first: print("[FALLA] el comodín on_demand tiene prioridad sobre la política de", dom); sys.exit(1)
print("[ok] política de certificado propia para", dom, "(sin on_demand) y con prioridad sobre el comodín")
PY
if [ $APLICAR = 0 ]; then echo; echo "== Comprobación terminada: no se cambió nada. Para aplicar, repita con --aplicar =="; exit 0; fi

mkdir -p "$BK"; cp -a "$CADDYFILE" "$BK/Caddyfile.original"
sudo tee "$CADDYFILE" < "$TMP/nuevo" >/dev/null
if sudo systemctl reload caddy; then echo "[ok] Caddy recargado (respaldo en $BK)"
else echo "Falló el reload: restaurando"; sudo tee "$CADDYFILE" < "$BK/Caddyfile.original" >/dev/null; sudo systemctl reload caddy || true; exit 1; fi
echo "Esperando el certificado (hasta 90 s)..."
for i in $(seq 1 45); do curl -fsS --max-time 5 "https://$DOMINIO/api/status" 2>/dev/null && { echo; echo "[ok] https://$DOMINIO responde"; exit 0; }; sleep 2; done
echo "[aviso] aún no responde. Registro: sudo journalctl -u caddy --since '3 minutes ago' --no-pager | grep -iE 'contabilidad|obtain|acme|error' | cut -c1-250"
echo "Para dejar el Caddyfile como estaba: sudo cp $BK/Caddyfile.original $CADDYFILE && sudo systemctl reload caddy"
