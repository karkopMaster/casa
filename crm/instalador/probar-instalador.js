#!/usr/bin/env node
// Comprueba, con un usuario instalador REAL de tu base, que solo puede lo permitido.
// Corre en el VPS: crea un token temporal para ese usuario (como lo haría el inicio de sesión, sin captcha) y llama al servidor local.
// No muestra el token ni crea clientes (solo pide el enlace de registro, que ya existe o se crea una vez).
// Uso: cd /home/ubuntu/isp-crm/backend && node /tmp/casa/crm/instalador/probar-instalador.js correo_del_instalador
const R = "/home/ubuntu/isp-crm/backend";
process.chdir(R);
require(require.resolve("dotenv", { paths: [R] })).config({ path: R + "/.env" });
const { controlPrisma } = require(R + "/dist/lib/controlPrisma");
const { signToken } = require(R + "/dist/utils/jwt");
const BASE = process.env.PROBAR_BASE || "http://127.0.0.1:4000";
(async () => {
  const email = process.argv[2];
  if (!email) throw new Error("Uso: probar-instalador.js correo_del_instalador");
  const u = await controlPrisma.usuario.findUnique({ where: { email }, include: { tipoUsuario: true } });
  if (!u) throw new Error("No existe ese usuario");
  console.log(`Usuario: ${u.nombre} | rol: ${u.rol} | tipo de usuario: ${u.tipoUsuario ? u.tipoUsuario.nombre : "(ninguno)"} | activo: ${u.activo}`);
  if (!u.tipoUsuario || u.tipoUsuario.nombre.trim().toLowerCase() !== "instalador")
    throw new Error('Este usuario NO tiene el tipo de usuario "Instalador". Asígnaselo y vuelve a probar.');
  const token = signToken({ id: u.id, email: u.email, rol: u.rol, tokenVersion: u.tokenVersion, empresaTenantId: u.empresaTenantId });
  let fallos = 0;
  const t = async (metodo, ruta, cuerpo, esperado) => {
    const r = await fetch(BASE + ruta, { method: metodo, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    const ok = esperado === "pasa" ? r.status !== 403 && r.status !== 401 : r.status === 403;
    if (!ok) fallos++;
    console.log(`${ok ? "[SI]" : "[NO]"} ${esperado.padEnd(9)} ${metodo.padEnd(6)} ${ruta.padEnd(34)} -> ${r.status}`);
  };
  console.log("--- debe PASAR ---");
  await t("GET", "/api/auth/me", null, "pasa");
  await t("POST", "/api/clientes/link-registro", {}, "pasa");
  console.log("--- debe estar BLOQUEADO (403) ---");
  for (const r of ["/api/clientes", "/api/clientes/exportar", "/api/clientes/123", "/api/facturas", "/api/contratos", "/api/dashboard", "/api/usuarios", "/api/empresa", "/api/morosos-mikrotik", "/api/contabilidad", "/api/auditoria", "/api/servidores", "/api/chat-whatsapp", "/api/planes", "/api/solicitudes", "/api/tickets", "/api/pasarelas", "/api/sistema"])
    await t("GET", r, null, "bloqueado");
  await t("PUT", "/api/clientes/x", {}, "bloqueado");
  await t("DELETE", "/api/clientes/x", null, "bloqueado");
  await t("POST", "/api/facturas", {}, "bloqueado");
  await t("POST", "/api/auth/panel-sso", {}, "bloqueado");
  await t("POST", "/api/clientes/..%2ffacturas", {}, "bloqueado");
  console.log(fallos ? `\nHAY ${fallos} PROBLEMAS: NO lo uses con gente real hasta revisarlo.` : "\nTodo correcto: el instalador solo puede lo permitido.");
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error("Error:", e.message); process.exit(1); });
