# RedCien – página de internet (Ciénaga, Magdalena)

`site/index.html`: página única (planes, servicio, formulario de solicitud, preguntas).

## Dependencias en el VPS (no están en el repo)
- `planes.json` en la raíz del sitio (lista de planes: nombre, mb, precio, etiqueta, incluye).
- Carpeta `img/` (logo-redcien.webp, favicon-redcien.png, hero-familia.jpg, momentos-*.jpg).
- API `POST /api/internet/solicitud` (recibe el formulario).

## Desplegar
En el VPS: `WEBROOT=/ruta/del/sitio BRANCH=<rama> ./deploy/deploy.sh`
Solo reemplaza `index.html` y deja una copia `.bak` con fecha.
