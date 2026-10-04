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
  const port = process.env.PORT || 3000;
  for (const ruta of ["/api/instalador/ordenes", "/api/instalador/ordenes?todas=1"]) {
    const r = await fetch(`http://127.0.0.1:${port}${ruta}`, { headers: { Authorization: "Bearer " + tok } });
    console.log(ruta, r.status, (await r.text()).slice(0, 600));
  }
  await controlPrisma.$disconnect();
})().catch((e) => console.log("error:", e.message));
