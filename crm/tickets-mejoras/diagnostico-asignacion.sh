#!/usr/bin/env bash
# EN EL VPS: bash /tmp/casa/crm/tickets-mejoras/diagnostico-asignacion.sh
# Compara el tecnicoId de los últimos radicados con los ids de usuarios (solo lectura).
cd /home/ubuntu/isp-crm/backend
echo "== rutas de técnicos =="; grep -n "router\.\(get\|post\)" src/routes/tecnicos.routes.ts 2>/dev/null | head; grep -n "findMany\|prisma\.\(tecnico\|usuario\)" src/routes/tecnicos.routes.ts 2>/dev/null | head
cat > /tmp/diag-asig.js <<'JS'
require("/home/ubuntu/isp-crm/backend/node_modules/dotenv").config({ path: "/home/ubuntu/isp-crm/backend/.env" });
const { PrismaClient } = require("/home/ubuntu/isp-crm/backend/node_modules/@prisma/client");
(async () => {
  const p = new PrismaClient();
  try {
    const us = await p.usuario.findMany({ where: { rol: "TECNICO" }, select: { id: true, nombre: true, email: true } });
    console.log("\n== usuarios TECNICO ==", us);
    const ts = await p.ticket.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { numero: true, estado: true, tecnicoId: true } });
    console.log("\n== últimos 5 radicados ==", ts);
  } catch (e) { console.log("error:", e.message); }
  await p.$disconnect();
})();
JS
node /tmp/diag-asig.js
