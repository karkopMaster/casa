#!/usr/bin/env bash
# SOLO LECTURA. Ejecutar EN EL VPS:  bash auditar-vps.sh | tee /tmp/auditoria-vps.txt
# No instala, no reinicia, no escribe fuera de /tmp. No imprime contraseñas ni variables de entorno:
# de nginx/apache solo muestra server_name, listen, root y proxy_pass.
set -u
S(){ echo; echo "=== $* ==="; }
run(){ "$@" 2>&1 | head -${LINES_MAX:-60}; }

S "Sistema"
run bash -c 'cat /etc/os-release | grep -E "^(PRETTY_NAME|VERSION_ID)="; uname -r; uptime -p; whoami'
S "Recursos (¿hay espacio y memoria para otra app?)"
run bash -c 'free -h; echo; df -h / /home 2>/dev/null | sort -u; echo; nproc | sed "s/^/CPUs: /"'
S "Node.js (la app necesita >= 22.13 por node:sqlite)"
run bash -c 'command -v node && node -v || echo "node NO instalado"; command -v npm && npm -v; command -v nvm >/dev/null && echo "nvm presente"; ls -d ~/.nvm 2>/dev/null'
S "Versiones de Node que ya usan sus apps (no las toque)"
run bash -c 'shopt -s nullglob; for p in /home/*/*/package.json; do d=$(dirname "$p"); n=$(grep -m1 "\"engines\"" -A2 "$p" | tr -d " \n"); echo "$d $n"; done 2>/dev/null | head -20'
S "Puertos en escucha (elegiremos uno libre)"
run bash -c 'if command -v ss >/dev/null; then ss -ltnp 2>/dev/null | awk "NR==1 || /LISTEN/"; elif command -v netstat >/dev/null; then netstat -ltnp 2>/dev/null; else echo "ni ss ni netstat disponibles: no se puede listar"; fi'
S "¿Puerto 3010 libre? (propuesto para contabilidad)"
run bash -c 'if (exec 3<>/dev/tcp/127.0.0.1/3010) 2>/dev/null; then echo "OCUPADO: elegir otro puerto"; else echo "libre (nadie responde en 127.0.0.1:3010)"; fi'
S "pm2 (procesos ya en marcha)"
run bash -c 'command -v pm2 >/dev/null && pm2 jlist 2>/dev/null | python3 -c "import sys,json; [print(p[\"name\"], p[\"pm2_env\"][\"status\"], \"cwd=\"+p[\"pm2_env\"].get(\"pm_cwd\",\"\"), \"user=\"+str(p[\"pm2_env\"].get(\"username\",\"\"))) for p in json.load(sys.stdin)]" || echo "pm2 no encontrado para este usuario (probar: sudo -u ubuntu pm2 list)"'
S "Servicios systemd relevantes"
run bash -c 'systemctl list-units --type=service --state=running --no-legend 2>/dev/null | awk "{print \$1}" | grep -Ei "nginx|apache|httpd|mysql|maria|postgres|redis|mongo|docker|pm2|caddy|php" '
S "Servidor web: nginx"
run bash -c 'command -v nginx >/dev/null && { nginx -v 2>&1; echo "--- sitios habilitados:"; ls /etc/nginx/sites-enabled 2>/dev/null; echo "--- resumen de server blocks:"; grep -rhE "^\s*(server_name|listen|root|proxy_pass|include /etc/letsencrypt)" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | sed "s/^\s*//" | sort | uniq -c | sort -rn | head -40; } || echo "nginx no instalado"'
S "Servidor web: apache"
run bash -c 'command -v apache2 >/dev/null && { apache2 -v | head -1; ls /etc/apache2/sites-enabled; grep -rhE "^\s*(ServerName|ServerAlias|DocumentRoot|ProxyPass |<VirtualHost)" /etc/apache2/sites-enabled | sed "s/^\s*//" | head -30; } || echo "apache no instalado"'
S "Certificados SSL (vencimientos)"
run bash -c 'command -v certbot >/dev/null && (sudo -n certbot certificates 2>/dev/null | grep -E "Certificate Name|Domains|Expiry" || echo "certbot sin permiso (probar con sudo)") || echo "certbot no instalado"'
S "Bases de datos instaladas (no se conecta a ellas)"
run bash -c 'for b in mysql mariadb psql mongod redis-server sqlite3; do command -v $b >/dev/null && echo "$b: $($b --version 2>&1 | head -1)"; done'
S "Cortafuegos"
run bash -c '(sudo -n ufw status 2>/dev/null || echo "ufw: sin permiso o inactivo")'
S "Tareas programadas (solo nombres de comandos)"
run bash -c 'crontab -l 2>/dev/null | grep -v "^#" | cut -c1-120; ls /etc/cron.d 2>/dev/null'
S "Carpetas de aplicaciones en /home y /var/www"
run bash -c 'ls -d /home/*/*/ /var/www/*/ 2>/dev/null | head -30'
S "Copias de seguridad existentes"
run bash -c 'ls -d /home/*/backups* 2>/dev/null; du -sh /home/*/backups* 2>/dev/null | head'
S "Dominios/DNS: IP pública de este servidor"
run bash -c 'curl -s --max-time 5 https://api.ipify.org || echo "(sin salida a internet o curl)"; echo'
echo; echo "Listo. Revise que no haya datos sensibles antes de compartir este resultado."
