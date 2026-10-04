// EN EL VPS: node /tmp/casa/crm/instalador/probar-ordenes.js carlos@gmail.com
// Genera un token temporal (solo en memoria) para ese usuario y llama a /api/instalador/ordenes del servidor local. No modifica nada.
const B = "/home/ubuntu/isp-crm/backend";
require(B + "/node_modules/dotenv").config({ path: B + "/.env" });
const jwt = require(B + "/node_modules/jsonwebtoken");
const { controlPrisma } = require(B + "/dist/lib/controlPrisma.js");
(async () => {
  const email = process.argv[2] || "carlos@gmail.com";
  const u = await controlPrisma.usuario.findFirst({ where: { email }, include: { tipoUsuario: true } });
  if (!u) return console.log("No existe", email);
  console.log("usuario:", { id: u.id, rol: u.rol, tipo: u.tipoUsuario && u.tipoUsuario.nombre, empresa: u.empresaTenantId, activo: u.activo });
  const tok = jwt.sign({ id: u.id, email: u.email, rol: u.rol, tokenVersion: u.tokenVersion, empresaTenantId: u.empresaTenantId }, process.env.JWT_SECRET, { expiresIn: "5m" });
  const puertos = [...new Set([process.env.PORT, 3000, 3001, 4000, 5000, 8080].filter(Boolean))];
  let base = "";
  for (const p of puertos) {
    try { const r = await fetch(`http://127.0.0.1:${p}/api/instalador/ordenes`, { headers: { Authorization: "Bearer " + tok } }); base = `http://127.0.0.1:${p}`; console.log("puerto", p, "->", r.status); break; } catch (e) { console.log("puerto", p, "no responde"); }
  }
  if (!base) return console.log("No encontré el puerto del servidor. Espera 10 s tras el reinicio y vuelve a correr, o dime el PORT del .env.");
  for (const ruta of ["/api/instalador/ordenes", "/api/instalador/ordenes?todas=1"]) {
    const r = await fetch(base + ruta, { headers: { Authorization: "Bearer " + tok } });
    console.log(ruta, r.status, (await r.text()).slice(0, 700));
  }
  await controlPrisma.$disconnect();
})().catch((e) => console.log("error:", e.message));
