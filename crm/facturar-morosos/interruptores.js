#!/usr/bin/env node
// Enciende o apaga los interruptores de facturación para morosos. Por defecto solo MUESTRA; con --aplicar cambia.
//   node interruptores.js [slug] --si          (facturar suspendidos y con facturas abiertas)  -> pide --aplicar
//   node interruptores.js [slug] --no          (volver a como estaba)                         -> pide --aplicar
process.chdir("/home/ubuntu/isp-crm/backend");
require(require.resolve("dotenv", { paths: ["/home/ubuntu/isp-crm/backend"] })).config({ path: "/home/ubuntu/isp-crm/backend/.env" });
const B = "/home/ubuntu/isp-crm/backend/dist";
const { prisma } = require(B + "/lib/prisma");
const { controlPrisma } = require(B + "/lib/controlPrisma");
const { tenantContext, getCachedTenantClient } = require(B + "/lib/tenantDb");
const { obtenerConfigTenant } = require(B + "/lib/tenantConfig");
const arg = process.argv.slice(2);
const slug = arg.find((a) => !a.startsWith("--")) || "redcien";
const valor = arg.includes("--si") ? true : arg.includes("--no") ? false : null;
(async () => {
  if (valor === null) throw new Error("Indica --si o --no");
  const t = await controlPrisma.empresaTenant.findUnique({ where: { slug } });
  if (!t) throw new Error("No existe la empresa " + slug);
  await tenantContext.run(getCachedTenantClient(t.databaseUrl), async () => {
    const cfg = await obtenerConfigTenant(prisma.empresaConfig, t.id);
    if (!cfg?.id) throw new Error("No encontré la configuración de la empresa");
    const flags = { ...(cfg.configFlags || {}) };
    console.log("Antes:", { facturasDeshabilitados: flags["contratos.facturasDeshabilitados"], facturacionConAbiertas: flags["contratos.facturacionConAbiertas"] });
    flags["contratos.facturasDeshabilitados"] = valor;
    flags["contratos.facturacionConAbiertas"] = valor;
    console.log("Después:", { facturasDeshabilitados: valor, facturacionConAbiertas: valor });
    if (!arg.includes("--aplicar")) return console.log("\n(No se cambió nada. Agrega --aplicar para guardar.)");
    await prisma.empresaConfig.update({ where: { id: cfg.id }, data: { configFlags: flags } });
    console.log("\nGuardado. Aplica desde la próxima corrida de facturación (no hace falta reiniciar).");
  });
  process.exit(0);
})().catch((e) => { console.error("Error:", e.message); process.exit(1); });
