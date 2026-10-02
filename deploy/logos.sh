#!/usr/bin/env bash
# Ejecutar EN EL VPS. Descarga logos de los entes regulatorios a <WEBROOT>/img/regulatorios/.
# Los que no se puedan descargar se omiten (la página muestra la tarjeta sin logo).
# Uso: WEBROOT=/home/ubuntu/isp-crm/backend/public/internet ./deploy/logos.sh
set -u
: "${WEBROOT:?Define WEBROOT}"
D="$WEBROOT/img/regulatorios"; mkdir -p "$D"
get(){ # nombre url
  if curl -fsSL -m 25 -A "Mozilla/5.0" -o "$D/$1.tmp" "$2" && [ -s "$D/$1.tmp" ]; then
    mv "$D/$1.png" "$D/$1.png.bak" 2>/dev/null; mv "$D/$1.tmp" "$D/$1.png"; echo "OK    $1"
  else rm -f "$D/$1.tmp"; echo "FALLO $1  (sube a mano: $D/$1.png)"; fi
}
get mintic "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/Logo_Ministerio_de_Tecnologias_de_la_Informacion_y_Comunicaciones_Colombia.svg/250px-Logo_Ministerio_de_Tecnologias_de_la_Informacion_y_Comunicaciones_Colombia.svg.png"
get policia "https://upload.wikimedia.org/wikipedia/commons/b/bf/Escudo_Polic%C3%ADa_Nacional_de_Colombia.PNG"
get icbf "https://www.icbf.gov.co/sites/default/files/icbf-logo.png"
# CRC, SIC, Fiscalía y Te Protejo: descárgalos de sus sitios oficiales (clic derecho > guardar imagen)
# y cópialos como crc.png, sic.png, fiscalia.png y teprotejo.png en $D
chown -R ubuntu:ubuntu "$D" 2>/dev/null; chmod -R a+rX "$D"
ls -la "$D"
