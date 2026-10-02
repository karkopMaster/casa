# Redcien – sitio web

Página estática (`site/index.html`) con secciones: inicio, planes, cobertura y contacto.

## Pendientes
- Poner el número real de WhatsApp (`WA` en `site/index.html`) y los precios reales.
- Logo, colores y textos definitivos.

## Desplegar en el VPS
En el VPS (una sola vez): `git clone https://github.com/karkopMaster/casa && cd casa`,
y configurar el servidor web con `root /var/www/redcien;` y SSL.
Cada actualización: `sudo ./deploy/deploy.sh` (usa `BRANCH=...` si no es `main`).
