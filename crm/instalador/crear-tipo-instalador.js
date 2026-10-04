// EN EL VPS:  node /tmp/casa/crm/instalador/crear-tipo-instalador.js                  -> lista los tipos de usuario que existen (solo lectura)
//             node /tmp/casa/crm/instalador/crear-tipo-instalador.js CORREO --aplicar -> crea el tipo "Instalador" (si falta) y se lo pone a ese usuario
// CORREO = el email del usuario (columna EMAIL del panel), ej. carlos@gmail.com
const B = "/home/ubuntu/isp-crm/backend";
require(B + "/node_modules/dotenv").config({ path: B + "/.env" });
const { controlPrisma } = require(B + "/dist/lib/controlPrisma.js");
(async () => {
  const [correo, flag] = process.argv.slice(2);
  const tipos = await controlPrisma.tipoUsuario.findMany();
  console.log("Tipos existentes:"); console.table(tipos);
  if (!correo) return console.log("Para asignar: agrega el correo del usuario y --aplicar");
  const u = await controlPrisma.usuario.findFirst({ where: { email: correo }, select: { id: true, nombre: true, email: true, rol: true, empresaTenantId: true } });
  if (!u) return console.log("No encontré el usuario", correo);
  if (u.rol !== "TECNICO") return console.log("Por seguridad solo asigno el tipo a usuarios con rol TECNICO. Este es:", u.rol);
  let tipo = tipos.find((t) => String(t.nombre).trim().toLowerCase() === "instalador");
  console.log(tipo ? "Ya existe el tipo Instalador." : "Se creará el tipo Instalador.", "Usuario:", u.email);
  if (flag !== "--aplicar") return console.log("(vista previa; agrega --aplicar)");
  if (!tipo) tipo = await controlPrisma.tipoUsuario.create({ data: { nombre: "Instalador" } });
  await controlPrisma.usuario.update({ where: { id: u.id }, data: { tipoUsuarioId: tipo.id, tokenVersion: { increment: 1 } } });
  console.log("Listo:", u.email, "ahora es Instalador. Debe cerrar sesión y volver a entrar.");
})().catch((e) => { console.log("error:", e.message); process.exit(1); }).finally(() => controlPrisma.$disconnect());
