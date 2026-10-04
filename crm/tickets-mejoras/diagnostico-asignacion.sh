#!/usr/bin/env bash
# EN EL VPS: bash /tmp/casa/crm/tickets-mejoras/diagnostico-asignacion.sh   (solo lectura)
cat > /tmp/diag-asig.js <<'JS'
const B = "/home/ubuntu/isp-crm/backend";
require(B + "/node_modules/dotenv").config({ path: B + "/.env" });
const { controlPrisma } = require(B + "/dist/lib/controlPrisma.js");
const { resolveTenantClient } = require(B + "/dist/lib/tenantDb.js");
(async () => {
  const carlos = await controlPrisma.usuario.findFirst({ where: { email: "carlos@gmail.com" }, select: { id: true, empresaTenantId: true } });
  console.log("carlos:", carlos);
  const t = await resolveTenantClient(carlos.empresaTenantId);
  if (!t) return console.log("No hay base para la empresa de carlos");
  const tk = await t.ticket.findMany({ orderBy: { createdAt: "desc" }, take: 8 });
  console.table(tk.map((x) => ({ numero: x.numero, estado: x.estado, tecnicoId: x.tecnicoId, empresaTenantId: x.empresaTenantId, esDeCarlos: x.tecnicoId === carlos.id })));
  const suyos = await t.ticket.count({ where: { tecnicoId: carlos.id, empresaTenantId: carlos.empresaTenantId } });
  console.log("Radicados que el instalador debería ver (tecnicoId + empresa de carlos):", suyos);
  await controlPrisma.$disconnect();
})().catch((e) => console.log("error:", e.message));
JS
node /tmp/diag-asig.js
