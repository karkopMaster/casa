#!/usr/bin/env bash
# EN EL VPS. Cambia el dominio del bloque "contabilidad" del Caddyfile (p. ej. a un dominio que no cubra un comodín on_demand).
# Por defecto SOLO COMPRUEBA. Para aplicar: añadir --aplicar
#   DE=contabilidad.conectpro.co A=contabilidad.redcien.co bash cambiar-dominio-caddy.sh [--aplicar]
set -euo pipefail
APLICAR=0; [ "${1:-}" = "--aplicar" ] && APLICAR=1
: "${DE:?Defina DE (dominio actual del bloque)}"; : "${A:?Defina A (dominio nuevo)}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"; BASE="${BASE:-/home/ubuntu}"
TS=$(date +%Y%m%d-%H%M%S); BK="$BASE/backups/pre-cambio-dominio-$TS"; TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
FALLOS=0; ok(){ echo "  [ok]    $*"; }; no(){ echo "  [FALLA] $*"; FALLOS=$((FALLOS+1)); }

[[ "$A" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] && ok "dominio nuevo $A" || no "dominio nuevo inválido"
grep -q "^$DE {" "$CADDYFILE" && ok "bloque actual '$DE' encontrado" || no "no encuentro el bloque '$DE {' en $CADDYFILE"
grep -qF "$A" "$CADDYFILE" && no "$A ya aparece en el Caddyfile" || ok "$A no está en el Caddyfile"
IPPUB=$(curl -s --max-time 5 https://api.ipify.org || true); IPDOM=$(getent ahostsv4 "$A" 2>/dev/null | awk '{print $1; exit}' || true)
if [ -z "$IPDOM" ]; then no "$A aún no resuelve: cree un registro DNS tipo A hacia ${IPPUB:-la IP del servidor}"
elif [ -n "$IPPUB" ] && [ "$IPDOM" != "$IPPUB" ] && [ "${FORZAR_DNS:-0}" != 1 ]; then no "$A apunta a $IPDOM pero este servidor es $IPPUB"
else ok "DNS: $A → $IPDOM"; fi
[ "$FALLOS" -gt 0 ] && { echo "== No se puede continuar ($FALLOS falla/s). No se cambió nada. =="; exit 1; }

awk -v de="$DE {" -v a="$A {" '$0==de{print a; next} 1' "$CADDYFILE" > "$TMP/nuevo"
caddy validate --config "$TMP/nuevo" --adapter caddyfile >/dev/null 2>&1 && ok "el Caddyfile nuevo es válido" || { echo "ABORTO: el Caddyfile nuevo no valida. No se cambió nada."; exit 1; }
caddy adapt --config "$TMP/nuevo" --adapter caddyfile 2>/dev/null > "$TMP/nuevo.json"
python3 - "$TMP/nuevo.json" "$A" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1])); dom = sys.argv[2]
pols = cfg.get("apps", {}).get("tls", {}).get("automation", {}).get("policies", [])
def match(subj, name):
    if subj == name: return True
    return subj.startswith("*.") and name.endswith(subj[1:]) and "." not in name[:-len(subj[1:])]
first = next((i for i, p in enumerate(pols) if not p.get("subjects") or any(match(s, dom) for s in p["subjects"])), None)
print("  Políticas de certificado (orden = prioridad):")
for i, p in enumerate(pols): print("   ", i, (p.get("subjects") or ["(todas)"])[:4], "…" if len(p.get("subjects") or []) > 4 else "", "ON_DEMAND" if p.get("on_demand") else "")
if first is None: print("  [ok]    ninguna política especial cubre", dom, "→ certificado normal por defecto")
elif pols[first].get("on_demand"): print("  [FALLA] la política", first, "(on_demand) cubre", dom, "y rechazará el certificado"); sys.exit(1)
else: print("  [ok]    la política", first, "que cubre", dom, "NO es on_demand")
PY
if [ $APLICAR = 0 ]; then echo; echo "== Comprobación terminada: no se cambió nada. Para aplicar, repita con --aplicar =="; exit 0; fi

mkdir -p "$BK"; cp -a "$CADDYFILE" "$BK/Caddyfile.original"
sudo tee "$CADDYFILE" < "$TMP/nuevo" >/dev/null
if sudo systemctl reload caddy; then ok "Caddy recargado (respaldo en $BK)"
else echo "Falló el reload: restaurando"; sudo tee "$CADDYFILE" < "$BK/Caddyfile.original" >/dev/null; sudo systemctl reload caddy || true; exit 1; fi
echo "Esperando el certificado (hasta 120 s)..."
for i in $(seq 1 60); do curl -fsS --max-time 5 "https://$A/api/status" 2>/dev/null && { echo; ok "https://$A responde"; exit 0; }; sleep 2; done
echo "[aviso] aún no responde. Registro: sudo journalctl -u caddy --since '3 minutes ago' --no-pager | grep -iE 'contabilidad|obtain|acme|error' | cut -c1-250"
echo "Volver al dominio anterior: sudo cp $BK/Caddyfile.original $CADDYFILE && sudo systemctl reload caddy"
