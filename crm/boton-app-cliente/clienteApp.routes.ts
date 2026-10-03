// backend/src/routes/clienteApp.routes.ts
// Desde la ficha de un cliente: ver el enlace de descarga de la app y enviárselo por WhatsApp.
//   GET  /api/cliente-app/:id/info    -> { nombre, tieneWhatsapp, whatsappMascara, enlace }
//   POST /api/cliente-app/:id/enviar  -> envía el enlace por WhatsApp al cliente
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";
import { tenantWhere } from "../middleware/tenant";
import { enviarTextoOpenWA } from "../services/openwa";

const router = Router();
router.use(requireAuth);

const DOMINIO = ".148-113-203-154.sslip.io";
const ultimoEnvio = new Map<string, number>();

function enlaceApp(hostname: string): string {
  const h = (hostname || "").toLowerCase();
  const slug = h.endsWith(DOMINIO) ? h.slice(0, -DOMINIO.length) : h.replace(/^www\./, "").split(".")[0];
  return `https://${slug}${DOMINIO}/app/`;
}
const mascara = (t: string) => (t.length > 4 ? "•••• " + t.slice(-4) : "••••");

async function cargarCliente(req: AuthedRequest) {
  const id = String(req.params.id ?? "");
  if (!/^[A-Za-z0-9_-]{10,40}$/.test(id)) return null;
  return (prisma as any).cliente.findFirst({ where: { id, ...tenantWhere(req) }, select: { id: true, nombre: true, whatsapp: true, telefono: true } });
}

router.get("/:id/info", requireRole("ADMIN", "SOPORTE", "SUPER_ADMIN"), async (req: AuthedRequest, res) => {
  const cli = await cargarCliente(req);
  if (!cli) return res.status(404).json({ error: "Cliente no encontrado" });
  const tel = String(cli.whatsapp || cli.telefono || "").replace(/\D/g, "");
  res.json({ nombre: cli.nombre, tieneWhatsapp: tel.length >= 7, whatsappMascara: tel ? mascara(tel) : "", enlace: enlaceApp(req.hostname) });
});

router.post("/:id/enviar", requireRole("ADMIN", "SOPORTE", "SUPER_ADMIN"), async (req: AuthedRequest, res) => {
  const cli = await cargarCliente(req);
  if (!cli) return res.status(404).json({ error: "Cliente no encontrado" });
  const tel = String(cli.whatsapp || cli.telefono || "");
  if (tel.replace(/\D/g, "").length < 7) return res.status(400).json({ error: "El cliente no tiene WhatsApp registrado" });
  const ahora = Date.now();
  if (ahora - (ultimoEnvio.get(cli.id) ?? 0) < 60_000) return res.status(429).json({ error: "Ya se envió hace un momento. Espera un minuto." });
  ultimoEnvio.set(cli.id, ahora);
  if (ultimoEnvio.size > 5000) ultimoEnvio.clear();
  const cfg: any = await (prisma as any).empresaConfig
    .findFirst({ where: { ...tenantWhere(req) }, select: { nombre: true } })
    .then((c: any) => c ?? (prisma as any).empresaConfig.findFirst({ select: { nombre: true } }))
    .catch(() => null);
  const primer = String(cli.nombre ?? "").trim().split(/\s+/)[0];
  const nombreCliente = primer ? primer.charAt(0).toUpperCase() + primer.slice(1).toLowerCase() : "";
  const url = enlaceApp(req.hostname);
  const texto = `Hola${nombreCliente ? " " + nombreCliente : ""}, descarga la app de ${cfg?.nombre ?? "tu proveedor de internet"} para ver tu plan y tus facturas y pagar desde tu celular:\n${url}\nIngresas con tu número de documento y te enviamos un código por WhatsApp.`;
  try {
    await enviarTextoOpenWA(tel, texto);
    res.json({ ok: true });
  } catch (err) {
    ultimoEnvio.delete(cli.id);
    console.error("No se pudo enviar el enlace de la app:", (err as Error)?.message);
    res.status(502).json({ error: "No se pudo enviar el WhatsApp. Intenta de nuevo." });
  }
});

export default router;
