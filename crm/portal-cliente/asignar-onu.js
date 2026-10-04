#!/usr/bin/env node
// Asigna el identificador de ONU (unique external ID de SmartOLT) a un contrato.
// Primero MUESTRA a quién pertenece esa ONU en SmartOLT (1 consulta). Solo guarda con --aplicar.
// Uso: cd /home/ubuntu/isp-crm/backend && node /tmp/casa/crm/portal-cliente/asignar-onu.js <nro_contrato> <external_id_de_la_ONU> [--aplicar] [slug]
const R = "/home/ubuntu/isp-crm/backend";
process.chdir(R);
require(require.resolve("dotenv", { paths: [R] })).config({ path: R + "/.env" });
const { prisma } = require(R + "/dist/lib/prisma");
const { controlPrisma } = require(R + "/dist/lib/controlPrisma");
const { tenantContext, getCachedTenantClient } = require(R + "/dist/lib/tenantDb");
const { obtenerConfigTenant } = require(R + "/dist/lib/tenantConfig");
const a = process.argv.slice(2);
const pos = a.filter((x) => !x.startsWith("--"));
const numero = Number(pos[0]); const onu = String(pos[1] || "").trim(); const slug = pos[2] || "redcien";
(async () => {
  if (!Number.isInteger(numero) || !/^[A-Za-z0-9_-]{1,64}$/.test(onu)) throw new Error("Uso: asignar-onu.js <nro_contrato> <external_id_ONU> [--aplicar]");
  const t = await controlPrisma.empresaTenant.findUnique({ where: { slug } });
  if (!t) throw new Error("No existe la empresa " + slug);
  await tenantContext.run(getCachedTenantClient(t.databaseUrl), async () => {
    const c = await prisma.contrato.findFirst({ where: { numero }, select: { id: true, numero: true, onuIdentificador: true, cliente: { select: { nombre: true, direccion: true } } } });
    if (!c) throw new Error("No existe el contrato #" + numero);
    const otro = await prisma.contrato.findFirst({ where: { onuIdentificador: onu, NOT: { id: c.id } }, select: { numero: true, cliente: { select: { nombre: true } } } });
    if (otro) throw new Error(`Esa ONU ya está asignada al contrato #${otro.numero} (${otro.cliente.nombre}). No se continúa.`);
    const cfg = await obtenerConfigTenant(prisma.configuracionOLT, t.id);
    if (!cfg?.smartoltUrl || !cfg?.smartoltApiKey) throw new Error("SmartOLT no está configurado");
    const base = String(cfg.smartoltUrl).replace(/\/+$/, "").replace(/^(?!https?:\/\/)/, "https://");
    const r = await fetch(`${base}/api/onu/get_onu_details/${encodeURIComponent(onu)}`, { headers: { "X-Token": cfg.smartoltApiKey } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.status === false) throw new Error("SmartOLT no reconoce esa ONU: " + (j.error || r.status));
    const d = j.onu_details || {};
    console.log(`Contrato #${c.numero}: ${c.cliente.nombre} — ${c.cliente.direccion ?? "(sin dirección)"}`);
    console.log(`ONU en SmartOLT: nombre="${d.name}" dirección="${d.address ?? ""}" SN=${d.sn} tipo=${d.onu_type_name} TR069=${d.tr069} modo=${d.mode} estado_admin=${d.administrative_status}`);
    console.log(`WiFi de la ONU (antenas): ${(d.wifi_ports || []).map((p) => p.port).join(", ") || "(ninguna reportada)"}`);
    console.log(`Valor actual en el contrato: ${c.onuIdentificador ?? "(vacío)"}`);
    if (!a.includes("--aplicar")) return console.log("\n¿El nombre/dirección de la ONU corresponde a este cliente? Si sí, repite el comando agregando --aplicar. (No se cambió nada.)");
    await prisma.contrato.update({ where: { id: c.id }, data: { onuIdentificador: onu } });
    console.log("\nGuardado. Ojo: desde ahora el CRM también suspende/reactiva ESTA ONU por mora para este contrato.");
  });
  process.exit(0);
})().catch((e) => { console.error("Error:", e.message); process.exit(1); });
