#!/usr/bin/env node
// SOLO LECTURA. Explica por qué "Mi WiFi" aparece o no para un cliente.
// Uso: cd /home/ubuntu/isp-crm/backend && node /tmp/casa/crm/portal-cliente/diagnostico-wifi.js <documento> [slug]
const fs = require("fs");
const R = "/home/ubuntu/isp-crm/backend";
process.chdir(R);
require(require.resolve("dotenv", { paths: [R] })).config({ path: R + "/.env" });
const { prisma } = require(R + "/dist/lib/prisma");
const { controlPrisma } = require(R + "/dist/lib/controlPrisma");
const { tenantContext, getCachedTenantClient } = require(R + "/dist/lib/tenantDb");
const { obtenerConfigTenant } = require(R + "/dist/lib/tenantConfig");
const ok = (b) => (b ? "✔" : "✘");
(async () => {
  const doc = String(process.argv[2] || "").replace(/[^0-9A-Za-z]/g, "");
  const slug = process.argv[3] || "redcien";
  if (!doc) throw new Error("Falta el documento del cliente");
  console.log(`${ok(process.env.PORTAL_WIFI === "1")} 1. PORTAL_WIFI=1 en el .env (valor leído: ${process.env.PORTAL_WIFI ?? "no existe"})`);
  let html = ""; try { html = fs.readFileSync(R + "/public/cliente/index.html", "utf8"); } catch {}
  console.log(`${ok(html.includes("Nombre y clave"))} 2. El portal publicado (public/cliente/index.html) trae el botón Mi WiFi`);
  let js = ""; try { js = fs.readFileSync(R + "/dist/routes/portal.routes.js", "utf8"); } catch {}
  console.log(`${ok(js.includes("portal-wifi"))} 3. El backend compilado (dist) trae la ruta /api/portal/wifi`);
  const t = await controlPrisma.empresaTenant.findUnique({ where: { slug } });
  if (!t) throw new Error("No existe la empresa " + slug);
  await tenantContext.run(getCachedTenantClient(t.databaseUrl), async () => {
    const cli = await prisma.cliente.findFirst({ where: { documento: doc }, select: { id: true, nombre: true } });
    if (!cli) return console.log(`✘ 4. No encontré un cliente con documento ${doc}`);
    console.log(`   Cliente: ${cli.nombre}`);
    const contratos = await prisma.contrato.findMany({ where: { clienteId: cli.id }, select: { numero: true, estado: true, onuIdentificador: true, ssidWifi: true } });
    if (!contratos.length) console.log("✘ 4. El cliente no tiene contratos");
    for (const c of contratos) console.log(`   Contrato #${c.numero}: estado=${c.estado} | ONU=${c.onuIdentificador ? "'" + c.onuIdentificador + "'" : "(vacía)"} | WiFi guardado=${c.ssidWifi ?? "(vacío)"}`);
    const bueno = contratos.find((c) => c.estado === "HABILITADO" && String(c.onuIdentificador ?? "").trim());
    console.log(`${ok(!!bueno)} 4. Tiene un contrato HABILITADO con identificador de ONU`);
    const cfg = await obtenerConfigTenant(prisma.configuracionOLT, t.id).catch(() => null);
    console.log(`${ok(!!(cfg && cfg.smartoltUrl && cfg.smartoltApiKey))} 5. SmartOLT configurado (URL y API key) — proveedor activo: ${cfg?.proveedorActivo ?? "ninguno"}`);
  });
  process.exit(0);
})().catch((e) => { console.error("Error:", e.message); process.exit(1); });
