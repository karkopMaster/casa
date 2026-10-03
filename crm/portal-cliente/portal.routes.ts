// backend/src/routes/portal.routes.ts
// Portal del cliente final (app móvil): ingreso con documento + código por WhatsApp, y consulta de su cuenta.
// - La empresa se identifica por el dominio (igual que /api/public/empresa).
// - Los tokens del portal usan su propio secreto (PORTAL_JWT_SECRET) y audiencia "portal": no sirven en el panel.
// - Solo lectura: no modifica facturas, pagos ni contratos.
import { Router } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma";
import { controlPrisma } from "../lib/controlPrisma";
import { tenantContext, getCachedTenantClient } from "../lib/tenantDb";
import { obtenerConfigTenant } from "../lib/tenantConfig";
import { enviarTextoOpenWA } from "../services/openwa";

const router = Router();
const SLUG_PREDETERMINADO = "redcien";
const CODIGO_MIN = 5;
const MAX_INTENTOS = 5;
const SESION_DIAS = 30;

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const limiteIp = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos, intenta de nuevo en unos minutos." },
});

function secreto(): string | null {
  return process.env.PORTAL_JWT_SECRET || null;
}
const normDoc = (d: unknown) => String(d ?? "").replace(/[^0-9A-Za-z]/g, "").slice(0, 20);

async function ubicarTenant(req: { hostname?: string }) {
  const host = (req.hostname || "").toLowerCase().replace(/^www\./, "");
  const slug = host.split(".")[0];
  for (const s of [slug, SLUG_PREDETERMINADO]) {
    if (!s) continue;
    const t: any = await controlPrisma.empresaTenant.findUnique({ where: { slug: s } });
    if (t?.databaseUrl) return { tenant: t, slug: s, client: getCachedTenantClient(t.databaseUrl) };
  }
  return null;
}

async function buscarCliente(tenantId: string, doc: string, crudo: string) {
  const cands = Array.from(new Set([doc, crudo.trim()])).filter(Boolean);
  return (prisma as any).cliente.findFirst({
    where: { documento: { in: cands }, OR: [{ empresaTenantId: tenantId }, { empresaTenantId: null }] },
    select: { id: true, nombre: true, whatsapp: true, telefono: true },
  });
}

// ---- Códigos de un solo uso (en memoria; duran 5 min, así que un reinicio solo obliga a pedir otro) ----
type Codigo = { hash: string; exp: number; intentos: number };
const codigos = new Map<string, Codigo>();
const pedidos = new Map<string, number[]>();
const hashCodigo = (c: string) => crypto.createHash("sha256").update(c).digest("hex");

function limpiar() {
  const ahora = Date.now();
  if (codigos.size > 5000) for (const [k, v] of codigos) if (v.exp < ahora) codigos.delete(k);
  if (pedidos.size > 5000) pedidos.clear();
}

/** 1) El cliente escribe su documento. La respuesta es siempre igual, exista o no, para no revelar quién es cliente. */
router.post("/solicitar-codigo", limiteIp, async (req, res) => {
  const doc = normDoc(req.body?.documento);
  res.json({ ok: true, mensaje: "Si el documento está registrado, te enviamos un código por WhatsApp." });
  if (doc.length < 5) return;
  try {
    limpiar();
    const ubic = await ubicarTenant(req);
    if (!ubic) return;
    const clave = `${ubic.slug}:${doc}`;
    const ahora = Date.now();
    const recientes = (pedidos.get(clave) ?? []).filter((t) => ahora - t < 15 * 60 * 1000);
    if (recientes.length >= 3) return; // máximo 3 códigos cada 15 minutos por documento
    pedidos.set(clave, [...recientes, ahora]);
    await tenantContext.run(ubic.client, async () => {
      const cli = await buscarCliente(ubic.tenant.id, doc, String(req.body?.documento ?? ""));
      const tel = cli?.whatsapp || cli?.telefono;
      if (!cli || !tel) return;
      const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
      codigos.set(clave, { hash: hashCodigo(codigo), exp: ahora + CODIGO_MIN * 60 * 1000, intentos: 0 });
      const cfg: any = await obtenerConfigTenant((prisma as any).empresaConfig, ubic.tenant.id).catch(() => null);
      await enviarTextoOpenWA(String(tel), `Tu código para ingresar a ${cfg?.nombre ?? ubic.tenant.nombre}: ${codigo}\nVence en ${CODIGO_MIN} minutos. No lo compartas con nadie.`);
    });
  } catch (err) {
    console.error("Portal: no se pudo enviar el código:", (err as Error)?.message);
  }
});

/** 2) El cliente escribe el código y recibe su sesión. */
router.post("/verificar", limiteIp, async (req, res) => {
  const s = secreto();
  if (!s) return res.status(503).json({ error: "El portal no está configurado." });
  const doc = normDoc(req.body?.documento);
  const codigo = String(req.body?.codigo ?? "").replace(/\D/g, "").slice(0, 6);
  const malo = () => res.status(401).json({ error: "Código incorrecto o vencido." });
  if (doc.length < 5 || codigo.length !== 6) return malo();
  const ubic = await ubicarTenant(req);
  if (!ubic) return malo();
  const clave = `${ubic.slug}:${doc}`;
  const reg = codigos.get(clave);
  if (!reg || reg.exp < Date.now() || reg.intentos >= MAX_INTENTOS) return malo();
  reg.intentos++;
  const a = Buffer.from(hashCodigo(codigo));
  const b = Buffer.from(reg.hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return malo();
  codigos.delete(clave);
  const cli: any = await tenantContext.run(ubic.client, () => buscarCliente(ubic.tenant.id, doc, String(req.body?.documento ?? "")));
  if (!cli) return malo();
  const token = jwt.sign({ sub: cli.id, slug: ubic.slug, aud: "portal" }, s, { expiresIn: `${SESION_DIAS}d` });
  res.json({ token });
});

const ETIQUETA_SERVICIO: Record<string, string> = { HABILITADO: "Activo", DESHABILITADO: "Suspendido", RETIRADO: "Retirado" };

/** 3) Datos de la cuenta del cliente que inició sesión. */
router.get("/cuenta", async (req, res) => {
  const s = secreto();
  if (!s) return res.status(503).json({ error: "El portal no está configurado." });
  const auth = String(req.headers.authorization ?? "");
  let payload: any;
  try {
    payload = jwt.verify(auth.replace(/^Bearer\s+/i, ""), s, { audience: "portal" });
  } catch {
    return res.status(401).json({ error: "Sesión vencida." });
  }
  const ubic = await ubicarTenant(req);
  if (!ubic || ubic.slug !== payload.slug) return res.status(401).json({ error: "Sesión vencida." });

  await tenantContext.run(ubic.client, async () => {
    const cli: any = await (prisma as any).cliente.findFirst({
      where: { id: String(payload.sub) },
      select: {
        id: true, nombre: true, documento: true, direccion: true, plan: { select: { nombre: true, velocidadBajada: true, velocidadSubida: true } },
        contratos: { orderBy: { createdAt: "asc" }, select: { numero: true, estado: true, direccionInstalacion: true, precioMensual: true, plan: { select: { nombre: true, velocidadBajada: true, velocidadSubida: true } } } },
        facturas: {
          orderBy: { fechaVencimiento: "desc" }, take: 12,
          select: { numero: true, monto: true, moraAplicada: true, estado: true, fechaEmision: true, fechaVencimiento: true, pagos: { select: { monto: true } } },
        },
      },
    });
    if (!cli) return res.status(401).json({ error: "Sesión vencida." });
    const cfg: any = await obtenerConfigTenant((prisma as any).empresaConfig, ubic.tenant.id).catch(() => null);
    const medios: any[] = await (prisma as any).medioPagoDigital.findMany({ where: { activo: true }, orderBy: { createdAt: "asc" } }).catch(() => []);
    // Avisos activos del CRM = promociones y noticias del portal. PORTAL_AVISOS=0 los desactiva.
    const avisos: any[] =
      process.env.PORTAL_AVISOS === "0"
        ? []
        : await (prisma as any).aviso
            .findMany({ where: { activo: true }, orderBy: { fechaPublicacion: "desc" }, take: 10, select: { titulo: true, mensaje: true, fechaPublicacion: true } })
            .catch(() => []);

    const contrato = cli.contratos.find((c: any) => c.estado === "HABILITADO") ?? cli.contratos[0] ?? null;
    const plan = contrato?.plan ?? cli.plan ?? null;
    const facturas = cli.facturas.map((f: any) => {
      const abonado = (f.pagos ?? []).reduce((t: number, p: any) => t + Number(p.monto ?? 0), 0);
      const total = Number(f.monto) + Number(f.moraAplicada ?? 0);
      const abierta = f.estado === "PENDIENTE" || f.estado === "VENCIDA";
      return { numero: f.numero, emision: f.fechaEmision, vence: f.fechaVencimiento, estado: f.estado, total, saldo: abierta ? Math.max(total - abonado, 0) : 0 };
    });
    const saldo = facturas.reduce((t: number, f: any) => t + f.saldo, 0);
    res.json({
      empresa: { nombre: cfg?.nombre ?? ubic.tenant.nombre, logoUrl: cfg?.logoUrl ?? null, whatsapp: cfg?.whatsapp ?? cfg?.telefonoSoporte ?? null },
      cliente: { nombre: cli.nombre, documento: cli.documento, direccion: contrato?.direccionInstalacion ?? cli.direccion ?? "" },
      contrato: contrato ? { numero: contrato.numero, estado: ETIQUETA_SERVICIO[contrato.estado] ?? String(contrato.estado) } : null,
      plan: plan ? { nombre: plan.nombre, bajada: plan.velocidadBajada, subida: plan.velocidadSubida } : null,
      saldo,
      facturas: facturas.filter((f: any) => f.estado !== "ANULADA"),
      medios: medios.map((m) => ({ n: String(m.etiqueta?.trim() || "Llave"), v: String(m.llave ?? "") })),
      avisos: avisos.map((a) => ({ titulo: String(a.titulo ?? ""), mensaje: String(a.mensaje ?? ""), fecha: a.fechaPublicacion })),
    });
  });
});

export default router;
