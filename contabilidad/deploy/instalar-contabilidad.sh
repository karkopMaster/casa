#!/usr/bin/env bash
# EN EL VPS (usuario ubuntu). Por defecto SOLO SIMULA: revisa todo y dice qué haría, sin cambiar nada.
# Para instalar de verdad, el mismo comando con --aplicar al final.
#   DOMINIO=contabilidad.midominio.co bash instalar-contabilidad.sh            # simulación
#   DOMINIO=contabilidad.midominio.co bash instalar-contabilidad.sh --aplicar  # instala
# Lo que NO hace: no toca otras apps de pm2, ni mongod/docker, ni el cortafuegos, ni reinicia Caddy (solo "reload"),
# no usa "pm2 restart all", no abre puertos (la app escucha solo en 127.0.0.1 y Caddy la publica por 443).
set -euo pipefail

APLICAR=0; [ "${1:-}" = "--aplicar" ] && APLICAR=1
: "${DOMINIO:?Defina DOMINIO, ej: DOMINIO=contabilidad.midominio.co}"
PUERTO="${PUERTO:-3010}"
RAMA="${RAMA:-claude/wizardly-babbage-oh7s3a}"
BASE="${BASE:-/home/ubuntu}"
APP="$BASE/contabilidad"; DATOS="$BASE/contabilidad-data"; ENVF="$BASE/contabilidad.env"; COPIAS="$BASE/backups-contabilidad"
TS=$(date +%Y%m%d-%H%M%S); BK="$BASE/backups/pre-contabilidad-$TS"
FALLOS=0; AVISOS=0
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
ok(){ echo "  [ok]    $*"; }
av(){ echo "  [aviso] $*"; AVISOS=$((AVISOS+1)); }
no(){ echo "  [FALLA] $*"; FALLOS=$((FALLOS+1)); }
hacer(){ if [ $APLICAR = 1 ]; then "$@"; else echo "  (simulación) $*"; fi; }

echo "== Revisión previa (no cambia nada) =="
[[ "$DOMINIO" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] && ok "dominio $DOMINIO" || no "dominio inválido: $DOMINIO"
[ "$(id -u)" != 0 ] && ok "se ejecuta como $(whoami) (no root)" || av "se ejecuta como root: mejor como ubuntu"

# Node >= 22.13 con node:sqlite (se usa el Node del sistema, no se cambia ni se instala otro)
if command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'; then
  node --disable-warning=ExperimentalWarning -e "require('node:sqlite')" 2>/dev/null && ok "Node $(node -v) con node:sqlite" || no "este Node no trae node:sqlite"
else no "se necesita Node >= 22.13 (hay: $(node -v 2>/dev/null || echo ninguno))"; fi

# pm2
if command -v pm2 >/dev/null; then
  ok "pm2 disponible"
  pm2 jlist 2>/dev/null | grep -q '"name":"contabilidad"' && no "ya existe un proceso pm2 llamado contabilidad" || ok "nombre pm2 'contabilidad' libre"
else no "pm2 no está disponible para este usuario"; fi

# puerto
if (exec 3<>/dev/tcp/127.0.0.1/"$PUERTO") 2>/dev/null; then no "el puerto $PUERTO ya está en uso (use PUERTO=otro)"; else ok "puerto $PUERTO libre"; fi
if command -v ss >/dev/null && ss -ltn | grep -qE "[:.]$PUERTO\s"; then no "ss muestra el puerto $PUERTO en escucha"; fi

# carpetas
for d in "$APP" "$DATOS" "$ENVF"; do [ -e "$d" ] && no "ya existe $d (no se sobreescribe)" || ok "$d no existe"; done
DISP=$(df -Pk "$BASE" | awk 'NR==2{print $4}'); [ "$DISP" -gt 1048576 ] && ok "disco libre $((DISP/1024)) MB" || no "poco disco libre"
MEM=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0); [ "${MEM:-0}" -gt 300 ] && ok "memoria disponible ${MEM} MB" || av "memoria disponible baja (${MEM} MB)"

# Caddy
CADDYFILE="${CADDYFILE:-}"
if [ -z "$CADDYFILE" ]; then
  CADDYFILE=$(systemctl cat caddy 2>/dev/null | grep -oE -- '--config[= ]+[^ ]+' | head -1 | sed -E 's/--config[= ]+//' || true)
  [ -n "$CADDYFILE" ] || CADDYFILE=/etc/caddy/Caddyfile
fi
if [ -r "$CADDYFILE" ]; then
  ok "Caddyfile: $CADDYFILE"
  grep -qF "$DOMINIO" "$CADDYFILE" && no "$DOMINIO ya aparece en el Caddyfile" || ok "$DOMINIO no está en el Caddyfile"
  if command -v caddy >/dev/null; then caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1 && ok "el Caddyfile actual es válido" || av "no pude validar el Caddyfile actual (¿permisos?)"; else no "no encuentro el comando caddy"; fi
else no "no puedo leer el Caddyfile ($CADDYFILE). Indique la ruta: CADDYFILE=/ruta bash ..."; fi
command -v sudo >/dev/null && { sudo -n true 2>/dev/null && ok "sudo sin contraseña" || av "sudo pedirá contraseña al recargar Caddy"; } || no "sudo no disponible"

# Caddyfile candidato: se valida y se comprueba que el certificado del dominio no caiga en una política on_demand
if [ -r "$CADDYFILE" ] && command -v caddy >/dev/null && [ "$FALLOS" = 0 ]; then
BLOQUE="$TMP/bloque.txt"
cat > "$BLOQUE" <<CADDY

# >>> contabilidad (instalar-contabilidad.sh $TS)
$DOMINIO {
	encode gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		X-Frame-Options DENY
		Referrer-Policy same-origin
	}
	reverse_proxy 127.0.0.1:$PUERTO
}
# <<< contabilidad
CADDY
cat "$CADDYFILE" "$BLOQUE" > "$TMP/Caddyfile.nuevo"
  if caddy validate --config "$TMP/Caddyfile.nuevo" --adapter caddyfile >/dev/null 2>&1; then ok "el Caddyfile nuevo es válido"; else no "el Caddyfile nuevo no valida"; fi
  caddy adapt --config "$TMP/Caddyfile.nuevo" --adapter caddyfile 2>/dev/null > "$TMP/nuevo.json" || true
  python3 - "$TMP/nuevo.json" "$DOMINIO" <<'PY' && ok "certificado: el dominio no cae en una política on_demand" || no "el dominio caería en un certificado on_demand (comodín del CRM): use un dominio no cubierto por el comodín, p. ej. de otro dominio sin '*.' (ver cambiar-dominio-caddy.sh)"
import json, sys
cfg = json.load(open(sys.argv[1])); dom = sys.argv[2]
pols = cfg.get("apps", {}).get("tls", {}).get("automation", {}).get("policies", [])
def match(subj, name):
    return subj == name or (subj.startswith("*.") and name.endswith(subj[1:]) and "." not in name[:-len(subj[1:])])
first = next((i for i, p in enumerate(pols) if not p.get("subjects") or any(match(s, dom) for s in p["subjects"])), None)
sys.exit(1 if first is not None and pols[first].get("on_demand") else 0)
PY
fi

# DNS
IPPUB=$(curl -s --max-time 5 https://api.ipify.org || true)
IPDOM=$(getent ahostsv4 "$DOMINIO" 2>/dev/null | awk '{print $1; exit}' || true)
if [ -z "$IPDOM" ]; then no "$DOMINIO aún no resuelve: cree un registro DNS tipo A hacia ${IPPUB:-la IP de este servidor}"
elif [ -n "$IPPUB" ] && [ "$IPDOM" != "$IPPUB" ]; then no "$DOMINIO apunta a $IPDOM pero este servidor es $IPPUB (si usa Cloudflare con proxy, ponga FORZAR_DNS=1)"; [ "${FORZAR_DNS:-0}" = 1 ] && { FALLOS=$((FALLOS-1)); av "DNS no coincide, continúa por FORZAR_DNS=1"; }
else ok "DNS correcto: $DOMINIO → $IPDOM"; fi

echo
echo "== Plan =="
cat <<PLAN
  1. Copia de seguridad de lo que se va a tocar (Caddyfile, lista de pm2) en $BK
  2. Descarga de la rama $RAMA e instalación en $APP
  3. Datos en $DATOS y secretos en $ENVF (permisos 600)
  4. Un solo proceso nuevo en pm2: "contabilidad" en 127.0.0.1:$PUERTO (las demás apps no se tocan)
  5. Bloque nuevo al final del Caddyfile para $DOMINIO → 127.0.0.1:$PUERTO, validado ANTES de aplicar, con "systemctl reload caddy"
  6. Script para deshacer todo: $BK/volver-atras.sh
PLAN
if [ "$FALLOS" -gt 0 ]; then echo; echo "== NO SE PUEDE CONTINUAR: $FALLOS falla(s). Corrija y repita. =="; exit 1; fi
if [ $APLICAR = 0 ]; then echo; echo "== Simulación terminada sin cambios ($AVISOS aviso(s)). Para instalar, repita con --aplicar =="; exit 0; fi

echo; echo "== Instalando =="
mkdir -p "$BK"; cp -a "$CADDYFILE" "$BK/Caddyfile.original"
pm2 jlist 2>/dev/null | python3 -c 'import sys,json; [print(p["name"],p["pm2_env"]["status"]) for p in json.load(sys.stdin)]' > "$BK/pm2-antes.txt" || true
ok "respaldo en $BK"

if [ -n "${TARBALL_LOCAL:-}" ]; then cp "$TARBALL_LOCAL" "$TMP/src.tgz"
else curl -fsSL "https://github.com/karkopMaster/casa/archive/refs/heads/$RAMA.tar.gz" -o "$TMP/src.tgz"; fi
tar xzf "$TMP/src.tgz" -C "$TMP" --wildcards '*/contabilidad/*'
SRC=$(ls -d "$TMP"/*/contabilidad | head -1); [ -f "$SRC/src/server.js" ] || { echo "ABORTO: el paquete no trae contabilidad/src/server.js"; exit 1; }
cp -a "$SRC" "$APP"; rm -rf "$APP/data"
mkdir -p "$DATOS"; chmod 700 "$DATOS"
( umask 077; cat > "$ENVF" <<ENV
PORT=$PUERTO
HOST=127.0.0.1
TRUST_PROXY=1
DB_FILE=$DATOS/contabilidad.db
SECRET_KEY=$(openssl rand -hex 32)
SETUP_TOKEN=$(openssl rand -hex 8)
ENV
)
ok "app instalada en $APP"
(cd "$APP" && npm test >/dev/null 2>&1) && ok "pruebas automáticas superadas en este servidor" || av "las pruebas no pasaron en este servidor (revise: cd $APP && npm test)"

set -a; . "$ENVF"; set +a
pm2 start "$APP/src/server.js" --name contabilidad --cwd "$APP" --node-args="--disable-warning=ExperimentalWarning" >/dev/null
for i in $(seq 1 20); do curl -fsS "http://127.0.0.1:$PUERTO/api/status" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://127.0.0.1:$PUERTO/api/status" >/dev/null && ok "la app responde en 127.0.0.1:$PUERTO" || { echo "ABORTO: la app no responde. Vea: pm2 logs contabilidad. Para deshacer: bash $BK/volver-atras.sh"; exit 1; }

cat > "$BK/volver-atras.sh" <<VOLVER
#!/usr/bin/env bash
# Deshace la instalación de contabilidad. NO borra los datos ($DATOS) ni las copias ($COPIAS).
set -euo pipefail
CF="$CADDYFILE"
if grep -q '>>> contabilidad' "\$CF"; then
  sudo cp -a "\$CF" "\$CF.pre-volver-atras"
  sudo sed -i '/# >>> contabilidad/,/# <<< contabilidad/d' "\$CF"
  caddy validate --config "\$CF" --adapter caddyfile >/dev/null && sudo systemctl reload caddy || { echo "Caddyfile inválido: restaurando"; sudo cp -a "\$CF.pre-volver-atras" "\$CF"; exit 1; }
fi
pm2 delete contabilidad 2>/dev/null || true
crontab -l 2>/dev/null | grep -v 'contabilidad-respaldo' | crontab - 2>/dev/null || true
echo "Listo. Quedan sin borrar: $APP, $DATOS, $ENVF y $COPIAS (bórrelos a mano si ya no los necesita)."
VOLVER
chmod +x "$BK/volver-atras.sh"

sudo tee "$CADDYFILE" < "$TMP/Caddyfile.nuevo" >/dev/null
if sudo systemctl reload caddy; then ok "Caddy recargado"
else echo "Falló el reload: restaurando el Caddyfile original"; sudo tee "$CADDYFILE" < "$BK/Caddyfile.original" >/dev/null; sudo systemctl reload caddy || true; exit 1; fi

echo "  esperando el certificado HTTPS (hasta 60 s)..."
HTTPS=0; for i in $(seq 1 30); do curl -fsS --max-time 5 "https://$DOMINIO/api/status" >/dev/null 2>&1 && { HTTPS=1; break; }; sleep 2; done
[ $HTTPS = 1 ] && ok "https://$DOMINIO responde" || av "todavía no responde por https (Caddy sigue gestionando el certificado: sudo journalctl -u caddy -n 30)"

# opcionales, solo si hay terminal
if [ -t 0 ]; then
  read -r -p "¿Guardar la lista de pm2 para que contabilidad arranque tras un reinicio del servidor? (incluye las apps que hoy están en pm2) [s/N] " R
  [ "${R:-n}" = s ] && pm2 save >/dev/null && ok "pm2 save hecho"
  read -r -p "¿Programar copia diaria de la base a las 3:30 (conserva 30 días) en $COPIAS? [s/N] " R
  if [ "${R:-n}" = s ]; then
    ( crontab -l 2>/dev/null; echo "30 3 * * * set -a; . $ENVF; set +a; $(command -v node) --disable-warning=ExperimentalWarning $APP/src/backup.js $COPIAS 30 >/dev/null 2>&1 # contabilidad-respaldo" ) | crontab - && ok "copia diaria programada"
  fi
else av "sin terminal: ejecute 'pm2 save' a mano y programe la copia diaria (ver README)"; fi

echo; echo "== Listo: https://$DOMINIO =="
echo "   Código de instalación (solo se pide al crear el primer administrador; guárdelo): $(grep ^SETUP_TOKEN= "$ENVF" | cut -d= -f2)"
echo "   Deshacer: bash $BK/volver-atras.sh"
