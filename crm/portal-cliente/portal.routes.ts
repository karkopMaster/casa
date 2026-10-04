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

// ---------------------------------------------------------------------------------------------
// Mi WiFi: cambiar nombre y clave desde el portal (SmartOLT). Apagado por defecto: PORTAL_WIFI=1 lo enciende.
// - Solo la ONU del propio contrato del cliente. GET lee de la base (0 llamadas a SmartOLT).
// - POST: 1 llamada get_onu_details + 1 set_wifi_port_lan por antena. Máx. 1 cambio por minuto y 3 por día por cliente.
// - La clave nunca se escribe en logs.
// ---------------------------------------------------------------------------------------------
const wifiActivo = () => process.env.PORTAL_WIFI === "1";
const cambiosWifi = new Map<string, number[]>();

async function sesionPortal(req: any, res: any) {
  const s = secreto();
  if (!s) { res.status(503).json({ error: "El portal no está configurado." }); return null; }
  let payload: any;
  try { payload = jwt.verify(String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""), s, { audience: "portal" }); }
  catch { res.status(401).json({ error: "Sesión vencida." }); return null; }
  const ubic = await ubicarTenant(req);
  if (!ubic || ubic.slug !== payload.slug) { res.status(401).json({ error: "Sesión vencida." }); return null; }
  return { payload, ubic };
}

async function contratoWifi(clienteId: string) {
  const c: any = await (prisma as any).contrato.findFirst({
    where: { clienteId, estado: "HABILITADO", onuIdentificador: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { id: true, onuIdentificador: true, ssidWifi: true },
  });
  return c && String(c.onuIdentificador ?? "").trim() ? c : null;
}

async function configSmartOlt(tenantId: string) {
  const m = (prisma as any).configuracionOLT;
  const cfg: any = await obtenerConfigTenant(m, tenantId).catch(() => null) ?? (await m.findFirst().catch(() => null));
  if (!cfg?.smartoltUrl || !cfg?.smartoltApiKey) return null;
  const base = String(cfg.smartoltUrl).replace(/\/+$/, "").replace(/^(?!https?:\/\/)/, "https://");
  return { base, key: String(cfg.smartoltApiKey) };
}

async function smartolt(cfg: { base: string; key: string }, ruta: string, cuerpo?: Record<string, string>) {
  const r = await fetch(cfg.base + ruta, {
    method: cuerpo ? "POST" : "GET",
    headers: { "X-Token": cfg.key, ...(cuerpo ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: cuerpo ? new URLSearchParams(cuerpo).toString() : undefined,
    signal: AbortSignal.timeout(45000),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j?.status === false) throw new Error(String(j?.error || `SmartOLT ${r.status}`).slice(0, 200));
  return j;
}

router.get("/wifi", async (req, res) => {
  const ses = await sesionPortal(req, res);
  if (!ses) return;
  if (!wifiActivo()) return res.json({ habilitado: false });
  await tenantContext.run(ses.ubic.client, async () => {
    const c = await contratoWifi(String(ses.payload.sub));
    const cfg = c ? await configSmartOlt(ses.ubic.tenant.id) : null;
    res.json({ habilitado: !!(c && cfg), ssid: c?.ssidWifi ?? null });
  });
});

router.post("/wifi", async (req, res) => {
  const ses = await sesionPortal(req, res);
  if (!ses) return;
  if (!wifiActivo()) return res.status(404).json({ error: "Esta opción no está disponible." });
  const ssid = String(req.body?.ssid ?? "").trim();
  const clave = String(req.body?.clave ?? "");
  if (ssid.length < 1 || ssid.length > 32 || /[\u0000-\u001f\u007f]/.test(ssid)) return res.status(400).json({ error: "El nombre de la red debe tener entre 1 y 32 caracteres." });
  if (clave.length < 8 || clave.length > 63 || /[^\x20-\x7e]/.test(clave)) return res.status(400).json({ error: "La clave debe tener entre 8 y 63 caracteres, sin tildes ni ñ." });

  const llave = `${ses.ubic.slug}:${ses.payload.sub}`;
  const ahora = Date.now();
  const previos = (cambiosWifi.get(llave) ?? []).filter((t) => ahora - t < 24 * 3600 * 1000);
  if (previos.length && ahora - previos[previos.length - 1] < 60 * 1000) return res.status(429).json({ error: "Espera un minuto antes de intentarlo de nuevo." });
  if (previos.length >= 3) return res.status(429).json({ error: "Llegaste al máximo de 3 cambios por día. Intenta mañana o escríbenos." });

  await tenantContext.run(ses.ubic.client, async () => {
    const c = await contratoWifi(String(ses.payload.sub));
    const cfg = c ? await configSmartOlt(ses.ubic.tenant.id) : null;
    if (!c || !cfg) return res.status(404).json({ error: "Esta opción no está disponible para tu servicio." });
    cambiosWifi.set(llave, [...previos, ahora]);
    const onu = encodeURIComponent(String(c.onuIdentificador).trim());
    try {
      const det = await smartolt(cfg, `/api/onu/get_onu_details/${onu}`);
      const puertos: string[] = (det?.onu_details?.wifi_ports ?? []).map((p: any) => String(p?.port ?? "")).filter((p: string) => /^wifi_[0-9/]+$/.test(p)).slice(0, 2);
      if (!puertos.length) return res.status(409).json({ error: "Tu equipo no permite este cambio desde la app. Escríbenos y lo hacemos por ti." });
      for (const puerto of puertos) {
        await smartolt(cfg, `/api/onu/set_wifi_port_lan/${onu}`, { wifi_port: puerto, dhcp: "No control", ssid, password: clave, authentication_mode: "WPA2" });
      }
      await (prisma as any).contrato.update({ where: { id: c.id }, data: { ssidWifi: ssid, wifiPassword: clave } }).catch(() => null);
      console.log(`[portal-wifi] ${ses.ubic.slug} cliente=${ses.payload.sub} ONU=${decodeURIComponent(onu)} antenas=${puertos.length} OK`);
      res.json({ ok: true });
    } catch (e: any) {
      console.error(`[portal-wifi] ${ses.ubic.slug} cliente=${ses.payload.sub} FALLÓ: ${String(e?.message ?? e).slice(0, 160)}`);
      res.status(502).json({ error: "No pudimos cambiar tu WiFi ahora. Intenta en unos minutos o escríbenos." });
    }
  });
});

export default router;
