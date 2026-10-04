// EN EL VPS:  node /tmp/casa/crm/instalador/asignar-empresa.js                      -> lista usuarios y su empresa (solo lectura)
//             node /tmp/casa/crm/instalador/asignar-empresa.js INSTALADOR@mail ADMIN@mail          -> vista previa
//             node /tmp/casa/crm/instalador/asignar-empresa.js INSTALADOR@mail ADMIN@mail --aplicar -> copia la empresa del ADMIN al instalador
const B = "/home/ubuntu/isp-crm/backend";
require(B + "/node_modules/dotenv").config({ path: B + "/.env" });
const { controlPrisma } = require(B + "/dist/lib/controlPrisma.js");
(async () => {
  const [a, b, flag] = process.argv.slice(2);
  const sel = { id: true, nombre: true, email: true, rol: true, empresaTenantId: true };
  if (!a) {
    console.table(await controlPrisma.usuario.findMany({ select: sel, orderBy: { createdAt: "desc" }, take: 30 }));
    console.log("Los usuarios con empresaTenantId vacío (null) NO pueden ver datos de ninguna empresa.");
  } else {
    const ins = await controlPrisma.usuario.findFirst({ where: { email: a }, select: sel });
    const adm = await controlPrisma.usuario.findFirst({ where: { email: b }, select: sel });
    if (!ins || !adm) { console.log("No encontré uno de los correos.", { ins, adm }); }
    else if (!adm.empresaTenantId) console.log("Ese ADMIN tampoco tiene empresa:", adm);
    else {
      console.log(`${ins.email}: empresa ${ins.empresaTenantId} -> ${adm.empresaTenantId}`);
      if (flag === "--aplicar") {
        await controlPrisma.usuario.update({ where: { id: ins.id }, data: { empresaTenantId: adm.empresaTenantId, tokenVersion: { increment: 1 } } });
        console.log("Listo. El instalador debe cerrar sesión y volver a entrar.");
      } else console.log("(vista previa; agrega --aplicar)");
    }
  }
  await controlPrisma.$disconnect();
})().catch((e) => { console.log("error:", e.message); process.exit(1); });
