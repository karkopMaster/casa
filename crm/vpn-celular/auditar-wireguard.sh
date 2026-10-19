#!/usr/bin/env bash
# SOLO LECTURA. En el VPS:  sudo bash auditar-wireguard.sh | tee /tmp/auditoria-wg.txt
# No cambia nada. No imprime llaves privadas, ni llaves preshared, ni las llaves públicas completas (solo 6 letras).
set -u
S(){ echo; echo "=== $* ==="; }
mask(){ sed -E 's/(PrivateKey|PresharedKey)[[:space:]]*=.*/\1 = (oculta)/I; s/(PublicKey[[:space:]]*=[[:space:]]*)(.{6})[^[:space:]]*/\1\2…/I'; }

S "Sistema y WireGuard"
echo "usuario: $(whoami)"; command -v wg >/dev/null && wg --version || echo "wg NO instalado"
S "Interfaces WireGuard activas (sin llaves)"
if command -v wg >/dev/null; then
  for i in $(wg show interfaces 2>/dev/null); do
    echo "--- $i"; ip -br addr show "$i" 2>/dev/null
    wg show "$i" listen-port | sed 's/^/puerto de escucha: /'
    wg show "$i" dump 2>/dev/null | awk 'NR>1{ printf "  peer %s…  endpoint=%s  allowed=%s  handshake=%s\n", substr($1,1,6), $3, $4, ($5==0?"nunca":strftime("%F %T",$5)) }'
  done
fi
S "Archivos /etc/wireguard (nombres y configuración sin llaves)"
ls -l /etc/wireguard 2>/dev/null | sed 's/^/  /'
for f in /etc/wireguard/*.conf; do [ -r "$f" ] || continue; echo "--- $f"; mask < "$f" | grep -vE '^\s*#|^\s*$' | head -40; done
S "Reenvío de paquetes (para pasar tráfico del celular hacia los routers)"
echo "ip_forward = $(cat /proc/sys/net/ipv4/ip_forward)"; sysctl net.ipv4.conf.all.forwarding 2>/dev/null
S "Puertos UDP en escucha"
(ss -lunp 2>/dev/null || netstat -lunp 2>/dev/null) | head -20
S "Cortafuegos: ufw (reglas de entrada y de reenvío)"
ufw status verbose 2>/dev/null | head -50 || echo "ufw sin permiso"
grep -E "DEFAULT_FORWARD_POLICY" /etc/default/ufw 2>/dev/null
S "iptables FORWARD y NAT (resumen)"
iptables -S FORWARD 2>/dev/null | head -30
echo "--- NAT:"; iptables -t nat -S 2>/dev/null | head -30
S "Rutas del servidor"
ip route | head -30
S "¿Responden los routers por el túnel? (1 ping a cada IP /32 permitida)"
if command -v wg >/dev/null; then
  for ip in $(wg show all allowed-ips 2>/dev/null | awk '{for(i=2;i<=NF;i++) print $i}' | grep -E '^[0-9.]+/32$' | cut -d/ -f1 | sort -u | head -12); do
    if ping -c1 -W1 "$ip" >/dev/null 2>&1; then echo "  $ip responde"; else echo "  $ip NO responde"; fi
  done
fi
S "¿Alcanzan los puertos de administración de MikroTik? (solo prueba de conexión)"
if command -v wg >/dev/null; then
  for ip in $(wg show all allowed-ips 2>/dev/null | awk '{for(i=2;i<=NF;i++) print $i}' | grep -E '^[0-9.]+/32$' | cut -d/ -f1 | sort -u | head -6); do
    for port in 8291 8728 22 443; do (exec 3<>/dev/tcp/$ip/$port) 2>/dev/null && echo "  $ip:$port abierto" ; done
  done
fi
S "Apps que ya hablan con los routers (nombres)"
ls -d /home/*/isp-crm /home/*/*mikrotik* 2>/dev/null
echo; echo "Listo. Revise el resultado antes de compartirlo (no incluye llaves)."
