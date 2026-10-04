#!/usr/bin/env python3
"""Agrega DELETE /api/tickets/:id a tickets.routes.ts (solo ADMIN, SOPORTE o SUPER_ADMIN).
Borra los comentarios del radicado, el radicado y sus archivos (adjuntos y firma). Si hay otros registros que lo usan, responde 409 y no borra nada.
Se detiene sin cambiar nada si el texto esperado no está exactamente una vez. Deja copia .pre-eliminar."""
import shutil, sys
f = sys.argv[1]
s = open(f, encoding="utf-8").read()
if 'router.delete("/:id"' in s: sys.exit("tickets.routes.ts ya tiene DELETE /:id.")
import re
m = re.search(r'import \{([^}]*)\} from "\.\./middleware/auth";', s)
if not m: sys.exit("ABORTO: no encontré el import de ../middleware/auth en tickets.routes.ts")
imp = m.group(0)
nombres = [x.strip() for x in m.group(1).split(",") if x.strip()]
if "prisma.ticket." not in s or "tenantWhere" not in s or "AuthedRequest" not in nombres: sys.exit("ABORTO: tickets.routes.ts no tiene la forma esperada (prisma, tenantWhere, AuthedRequest).")
fin = "export default router;"
for t in (fin,):
    if s.count(t) != 1: sys.exit("ABORTO: no encontré (o aparece más de una vez) este texto en tickets.routes.ts:\n" + t)
ruta = '''/** Eliminar un radicado (y sus comentarios y archivos). Solo ADMIN, SOPORTE o SUPER_ADMIN. */
router.delete("/:id", requireRole("ADMIN", "SOPORTE", "SUPER_ADMIN"), async (req: AuthedRequest, res) => {
  const ticket: any = await prisma.ticket.findFirst({ where: { id: req.params.id, ...tenantWhere(req) } });
  if (!ticket) return res.status(404).json({ error: "Radicado no encontrado" });
  try {
    await prisma.$transaction([
      prisma.ticketComentario.deleteMany({ where: { ticketId: ticket.id } }),
      prisma.ticket.delete({ where: { id: ticket.id } }),
    ]);
  } catch (err: any) {
    if (err?.code === "P2003") return res.status(409).json({ error: "No se puede eliminar: el radicado tiene registros asociados." });
    throw err;
  }
  const archivos: string[] = [1, 2, 3, 4, 5, 6, 7].map((n) => ticket[`adjunto${n}Url`] as string | null).concat([ticket.firmaUrl]).filter((u): u is string => !!u);
  for (const u of archivos) require("fs").unlink(require("path").join(process.cwd(), "public", "uploads", require("path").basename(u)), () => {});
  console.log(`Radicado #${ticket.numero} eliminado por ${req.user?.email ?? req.user?.id}`);
  res.json({ ok: true });
});

'''
shutil.copy2(f, f + ".pre-eliminar")
if "requireRole" not in nombres:
    s = s.replace(imp, imp.replace("{", "{ requireRole,", 1))
s = s.replace(fin, ruta + fin)
open(f, "w", encoding="utf-8").write(s)
print("tickets.routes.ts actualizado. Copia: tickets.routes.ts.pre-eliminar")
