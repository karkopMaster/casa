# OLT Manager – plataforma propia de gestión de OLT/ONU (reemplaza a SmartOLT)

Se conecta **directo por SSH** a tus OLT (hoy Huawei MA5600/MA5800). No usa SmartOLT.

Qué hace: alta de OLT, detección de ONU sin autorizar (autofind), autorización con perfil, listado con estado,
señal óptica (Rx/Tx), suspender/activar (mora), reiniciar, eliminar, bitácora, y sondeo automático cada 10 min.

## Cómo encaja con ConectaPro
1. **Sin tocar ConectaPro:** expone `/api/onu/...` con el mismo formato que SmartOLT (cabecera `X-Token`).
   En ConectaPro solo se cambia *smartoltUrl* y *smartoltApiKey* (Configuración OLT) y todo lo que ya usa
   (suspender/reactivar por mora, portal del cliente) pasa a hablar con esta plataforma.
2. **Página dentro del área OLT:** `conectapro/olt-manager.routes.ts` (backend) + `conectapro/OltManagerPagina.tsx` (frontend)
   abren el panel incrustado con acceso SSO (sin segunda contraseña).

## Instalar en el VPS nuevo
```
git clone <repo> && cd casa/crm/olt-manager    # o copiar la carpeta
bash instalar-vps.sh olt.tudominio.com https://tu-conectapro.com
sudo docker compose run --rm --entrypoint node olt-manager dist/admin.js usuario admin '<clave_larga_10+>'
sudo docker compose run --rm --entrypoint node olt-manager dist/admin.js apikey conectapro
```
DNS: registro A de `olt.tudominio.com` → IP del VPS. La red del VPS debe llegar por SSH a la IP de cada OLT
(VPN/túnel/IP pública con firewall que solo permita al VPS).

## Dominio gratis y túnel inverso
- **Dominio gratis fijo (recomendado):** cuenta en duckdns.org → `bash dominio-gratis.sh duckdns <subdominio> <token>`
  → `https://<subdominio>.duckdns.org` con HTTPS automático. (Alternativa sin cuenta: `bash dominio-gratis.sh cloudflared`, pero la dirección cambia al reiniciar.)
- **Túnel inverso hacia las OLT** (si el VPS no llega a ellas): en el VPS no hay que abrir nada; en un equipo de tu red:
  `bash tunel-olt.sh instalar 158.69.205.211 192.168.88.10:2201` → te da una llave → en el VPS `bash preparar-tunel-vps.sh "<llave>"`
  → `sudo systemctl start tunel-olt`. En el panel registra la OLT con host `127.0.0.1` y puerto `2201`.

## Migrar desde SmartOLT (opcional, una vez)
`SMARTOLT_URL=... SMARTOLT_KEY=... npm run importar-smartolt -- <id_olt_local> 0 --aplicar`
Conserva el *unique external ID*, así los contratos de ConectaPro no cambian.

## Pendiente / límites actuales
- Solo Huawei. Otras marcas = una clase nueva en `src/drivers/` que implemente `DriverOlt`.
- Los comandos Huawei se basan en el servicio ya usado en producción (`crm/olt-huawei`) más `display ont info`/`ont activate|deactivate|reset|delete`;
  **hay que probarlos contra tu OLT real** antes de usarlos con clientes.
- WiFi de la ONU requiere TR-069 (GenieACS aparte, `GENIEACS_URL`); sin él, ese endpoint responde 501.
- Base SQLite (suficiente para miles de ONU); migrable a Postgres si crece.
