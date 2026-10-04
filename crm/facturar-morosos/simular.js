#!/usr/bin/env node
// SOLO LECTURA. Muestra a quién se le facturaría este mes y por qué a otros no. No crea ni cambia nada.
// Uso (en el VPS):  cd /home/ubuntu/isp-crm/backend && node /tmp/casa/crm/facturar-morosos/simular.js [slug]
// Réplica de las reglas de generarFacturasDeGrupo() en src/services/billing.ts.
process.chdir("/home/ubuntu/isp-crm/backend");
require(require.resolve("dotenv", { paths: ["/home/ubuntu/isp-crm/backend"] })).config({ path: "/home/ubuntu/isp-crm/backend/.env" });
const B = "/home/ubuntu/isp-crm/backend/dist";
const { prisma } = require(B + "/lib/prisma");
const { controlPrisma } = require(B + "/lib/controlPrisma");
const { tenantContext, getCachedTenantClient } = require(B + "/lib/tenantDb");
const { obtenerConfigTenant } = require(B + "/lib/tenantConfig");

(async () => {
  const slug = process.argv[2] || "redcien";
  const t = await controlPrisma.empresaTenant.findUnique({ where: { slug } });
  if (!t) throw new Error("No existe la empresa " + slug);
  await tenantContext.run(getCachedTenantClient(t.databaseUrl), async () => {
    const cfg = await obtenerConfigTenant(prisma.empresaConfig, t.id);
    const flags = cfg?.configFlags || {};
    const factDes = flags["contratos.facturasDeshabilitados"] === true;
    const conAbiertas = flags["contratos.facturacionConAbiertas"] === true;
    console.log(`Empresa: ${t.slug} | facturar deshabilitados: ${factDes ? "SÍ" : "NO"} | facturar con facturas abiertas: ${conAbiertas ? "SÍ" : "NO"}`);
    const now = new Date(); const desdeMes = new Date(now.getFullYear(), now.getMonth(), 1);
    const contratos = await prisma.contrato.findMany({
      where: { facturacionAutomatica: true, estado: { in: ["HABILITADO", "DESHABILITADO"] } },
      select: { id: true, numero: true, estado: true, precioMensual: true, cliente: { select: { nombre: true } } },
    });
    const r = { facturaHoy: [], yaTiene: [], noSuspendido: [], noAbierta: [], facturaConCambio: [] };
    for (const c of contratos) {
      const ya = await prisma.factura.findFirst({ where: { contratoId: c.id, fechaEmision: { gte: desdeMes } }, select: { id: true } });
      if (ya) { r.yaTiene.push(c); continue; }
      const abierta = await prisma.factura.findFirst({ where: { contratoId: c.id, estado: { in: ["PENDIENTE", "VENCIDA"] }, fechaEmision: { lt: desdeMes } }, select: { id: true } });
      const bloqueaEstado = c.estado === "DESHABILITADO" && !factDes;
      const bloqueaAbierta = !!abierta && !conAbiertas;
      if (bloqueaEstado) r.noSuspendido.push(c);
      else if (bloqueaAbierta) r.noAbierta.push(c);
      else r.facturaHoy.push(c);
      // con ambos interruptores en SÍ
      if (bloqueaEstado || bloqueaAbierta) r.facturaConCambio.push(c);
    }
    const lin = (c) => `   #${c.numero} ${c.cliente.nombre} — $${Number(c.precioMensual).toLocaleString("es-CO")} (${c.estado})`;
    const mostrar = (titulo, arr) => { console.log(`\n${titulo}: ${arr.length}`); arr.slice(0, 40).forEach((c) => console.log(lin(c))); if (arr.length > 40) console.log(`   … y ${arr.length - 40} más`); };
    mostrar("YA tienen factura de este mes (NO se duplica nunca)", r.yaTiene);
    mostrar("Se facturarían con la configuración ACTUAL", r.facturaHoy);
    mostrar("NO se facturan hoy por estar DESHABILITADOS (suspendidos)", r.noSuspendido);
    mostrar("NO se facturan hoy por tener una factura abierta de meses anteriores", r.noAbierta);
    console.log(`\nSi activas los dos interruptores se agregarían ${r.facturaConCambio.length} contratos más, sin duplicar a los que ya tienen factura de este mes.`);
  });
  process.exit(0);
})().catch((e) => { console.error("Error:", e.message); process.exit(1); });
