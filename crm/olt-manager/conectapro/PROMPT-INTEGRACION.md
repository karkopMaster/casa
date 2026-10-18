# Prompt para pegar en la sesión de ConectaPro (la que tiene el backend y el frontend)

Pégalo tal cual en la sesión "Página web 148.113.203.154" (la que corre en tu PC / VPS de ConectaPro).

---
Necesito agregar una página nueva "Gestión OLT" dentro del área de OLT de ConectaPro. Es un servicio aparte (OLT Manager) que ya
corre en otro VPS y se muestra incrustado (iframe) con acceso SSO. Los archivos base están en el repo karkopMaster/casa, rama
claude/gallant-bardeen-b74ae4, carpeta crm/olt-manager/conectapro/:
  - olt-manager.routes.ts  → backend: GET /api/olt-manager/enlace devuelve una URL SSO de 60 s. Ajusta los nombres de rol y el import de requireAuth a los reales.
  - OltManagerPagina.tsx   → frontend: página con el iframe. Ajusta `api` al cliente HTTP real.
Haz esto, mostrando el diff antes de aplicar y con copia de seguridad como en lotes anteriores:
 1. Registrar la ruta en src/index.ts: app.use("/api/olt-manager", oltManagerRoutes).
 2. Agregar la página al router del frontend y un ítem "Gestión OLT" en el menú del área de OLT, solo visible para administradores.
 3. Variables en el .env del backend: OLT_MANAGER_URL=https://<dominio-del-olt-manager>  y  OLT_SSO_SECRET=<el SSO_SECRET del .env del VPS de OLT Manager>. No las escribas en el repo ni en logs.
 4. Compilar (tsc sin errores), build del frontend y reiniciar con pm2, como siempre.
 5. Aparte, en Configuración OLT de la empresa, cambiar smartoltUrl y smartoltApiKey por los del OLT Manager (la API es compatible), pero solo cuando yo lo confirme.
Antes de reiniciar nada, dime qué vas a cambiar.
---
