// EN EL VPS: node /tmp/casa/crm/instalador/probar-registro.js carlos@gmail.com
// Prueba con un token temporal del instalador: listas de municipios/barrios, validación del registro de cliente (envía un cuerpo vacío a propósito: NO crea nada)
// y el estado de la firma/fotos del radicado (si el archivo existe y se sirve). Solo lectura.
const B = "/home/ubuntu/isp-crm/backend", fs = require("fs");
require(B + "/node_modules/dotenv").config({ path: B + "/.env" });
const jwt = require(B + "/node_modules/jsonwebtoken");
const { controlPrisma } = require(B + "/dist/lib/controlPrisma.js");
(async () => {
  const u = await controlPrisma.usuario.findFirst({ where: { email: process.argv[2] || "carlos@gmail.com" } });
  if (!u) return console.log("No existe el usuario");
  const tok = jwt.sign({ id: u.id, email: u.email, rol: u.rol, tokenVersion: u.tokenVersion, empresaTenantId: u.empresaTenantId }, process.env.JWT_SECRET, { expiresIn: "5m" });
  const base = `http://127.0.0.1:${process.env.PORT || 4000}`;
  const h = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
  const ver = async (n, ruta, o) => { const r = await fetch(base + ruta, { headers: h, ...o }); const t = await r.text(); console.log(`\n${n}: ${r.status}\n  ${t.slice(0, 300)}`); try { return JSON.parse(t); } catch { return null; } };
  await ver("municipios", "/api/municipios");
  await ver("barrios", "/api/barrios");
  await ver("registro (cuerpo vacío: debe dar 400, no crea nada)", "/api/clientes", { method: "POST", body: "{}" });
  const l = await ver("ordenes", "/api/instalador/ordenes?todas=1");
  for (const o of (l && l.items) || []) {
    const d = await ver("detalle #" + o.numero, "/api/instalador/ordenes/" + o.id);
    for (const url of [d && d.firmaUrl, ...((d && d.listaFotos) || [])].filter(Boolean)) {
      const f = B + "/public" + url.split("?")[0];
      const r = await fetch(base + url).catch(() => null);
      console.log("  archivo", url, "en disco:", fs.existsSync(f), "| servido:", r && r.status);
    }
  }
  await controlPrisma.$disconnect();
})().catch((e) => console.log("error:", e.message));
