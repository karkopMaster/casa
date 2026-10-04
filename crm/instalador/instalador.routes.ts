// Rutas para el INSTALADOR / TÉCNICO de campo: solo ve y modifica los tickets que tiene asignados (tecnicoId = su usuario).
// Devuelve únicamente lo necesario (sin precios ni datos de contrato). La propiedad del ticket se comprueba en CADA ruta.
import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { fileFilterAdjunto, extensionSegura } from "../utils/uploadAdjuntos";
import { tenantWhere } from "../middleware/tenant";

const router = Router();
router.use(requireAuth);

const UPLOADS_DIR = path.join(__dirname, "../../public/uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 }, fileFilter: fileFilterAdjunto });
function subirArchivo(req: any, res: any, next: any) {
  subida.single("archivo")(req, res, (err: unknown) => {
    if (err) return res.status(400).json({ error: err instanceof Error ? err.message : "Error al subir el archivo" });
    next();
  });
}

const ESTADOS = ["NUEVO", "ASIGNADO", "EN_RUTA", "EN_PROCESO", "SOLUCIONADO", "CERRADO"] as const;
const REQUIEREN_FOTOS = ["SOLUCIONADO", "CERRADO"];
const SLOTS = [1, 2, 3, 4, 5, 6, 7];

const fotosDe = (t: any): string[] => SLOTS.map((n) => t[`adjunto${n}Url`] as string | null).filter((u): u is string => !!u);

/** Lo que ve el instalador de un ticket: sin contrato, sin precios. */
function vista(t: any, conDetalle = false) {
  const base = {
    id: t.id,
    numero: t.numero,
    titulo: t.titulo,
    categoria: t.categoria,
    estado: t.estado,
    prioridad: t.prioridad,
    direccion: t.direccion || t.cliente?.direccion || "",
    barrio: t.barrio || "",
    telefono: t.telefono || t.cliente?.telefono || "",
    fechaCaso: t.fechaCaso,
    cliente: t.cliente ? { nombre: t.cliente.nombre, telefono: t.cliente.telefono ?? null, whatsapp: t.cliente.whatsapp ?? null } : null,
    fotos: fotosDe(t).length,
    firmado: !!t.firmaUrl,
  };
  return conDetalle ? { ...base, descripcion: t.descripcion, listaFotos: fotosDe(t), firmaUrl: t.firmaUrl ?? null } : base;
}

/** Id del usuario que llama (el token puede guardarlo como id, sub o userId). */
function uidDe(req: AuthedRequest): string {
  const u: any = req.user ?? {};
  return String(u.id ?? u.sub ?? u.userId ?? u.usuarioId ?? "__nadie__");
}

/** Busca el ticket SOLO si está asignado al usuario que llama. Si no, 404 (no se revela si existe). */
async function ticketPropio(req: AuthedRequest, res: any) {
  const ticket = await prisma.ticket.findFirst({
    where: { id: String(req.params.id), tecnicoId: uidDe(req), ...tenantWhere(req) },
    include: { cliente: true },
  });
  if (!ticket) { res.status(404).json({ error: "Instalación no encontrada" }); return null; }
  return ticket as any;
}

router.get("/ordenes", async (req: AuthedRequest, res) => {
  const verTodas = String(req.query.todas ?? "") === "1";
  const items = await prisma.ticket.findMany({
    where: { tecnicoId: uidDe(req), ...(verTodas ? {} : { estado: { notIn: ["CERRADO"] } }), ...tenantWhere(req) },
    include: { cliente: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({ items: (items as any[]).map((t) => vista(t)) });
});

router.get("/ordenes/:id", async (req: AuthedRequest, res) => {
  const t = await ticketPropio(req, res);
  if (t) res.json(vista(t, true));
});

const estadoSchema = z.object({ estado: z.enum(ESTADOS) });
router.patch("/ordenes/:id/estado", async (req: AuthedRequest, res) => {
  const parsed = estadoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Estado inválido" });
  const t = await ticketPropio(req, res);
  if (!t) return;
  const nuevo = parsed.data.estado;
  if (REQUIEREN_FOTOS.includes(nuevo) && fotosDe(t).length === 0) {
    return res.status(400).json({ error: "Sube al menos una foto de la instalación antes de marcarla como terminada." });
  }
  const data: any = { estado: nuevo };
  if (nuevo === "CERRADO") data.cerradoAt = new Date();
  const actualizado = await prisma.ticket.update({ where: { id: t.id }, data });
  res.json({ id: actualizado.id, estado: actualizado.estado });
});

/** Sube una foto al primer espacio libre (1-7). Nunca pisa adjuntos que ya existan. Solo imágenes. */
router.post("/ordenes/:id/fotos", subirArchivo, async (req: AuthedRequest, res) => {
  if (!req.file) return res.status(400).json({ error: "Falta la foto" });
  const t = await ticketPropio(req, res);
  if (!t) return;
  const slot = SLOTS.find((n) => !t[`adjunto${n}Url`]);
  if (!slot) return res.status(400).json({ error: "Ya hay 7 fotos en esta instalación (el máximo)." });
  const ext = extensionSegura(req.file.buffer);
  if (!ext || ext === ".pdf") return res.status(400).json({ error: "Solo se aceptan fotos (JPG, PNG, WEBP o GIF)." });
  const nombre = `radicado-${t.id}-adj${slot}-${crypto.randomBytes(6).toString("hex")}${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, nombre), req.file.buffer);
  const url = `/uploads/${nombre}`;
  await prisma.ticket.update({ where: { id: t.id }, data: { [`adjunto${slot}Url`]: url } as any });
  res.status(201).json({ url, slot, fotos: fotosDe(t).length + 1 });
});

/** Firma del cliente dibujada en el celular del instalador (imagen). */
router.post("/ordenes/:id/firma", subirArchivo, async (req: AuthedRequest, res) => {
  if (!req.file) return res.status(400).json({ error: "Falta la firma" });
  const t = await ticketPropio(req, res);
  if (!t) return;
  const ext = extensionSegura(req.file.buffer);
  if (!ext || ext === ".pdf") return res.status(400).json({ error: "La firma debe ser una imagen." });
  const nombre = `radicado-${t.id}-firma-${crypto.randomBytes(6).toString("hex")}${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, nombre), req.file.buffer);
  const url = `/uploads/${nombre}`;
  await prisma.ticket.update({ where: { id: t.id }, data: { firmaUrl: url, fechaFirma: new Date(), metodoFirma: "PRESENCIAL" } as any });
  res.status(201).json({ firmado: true, firmaUrl: url });
});

/** Enlace para que el cliente firme desde su propio celular. */
router.post("/ordenes/:id/enlace-firma", async (req: AuthedRequest, res) => {
  const t = await ticketPropio(req, res);
  if (!t) return;
  const token = crypto.randomBytes(20).toString("hex");
  await prisma.ticket.update({ where: { id: t.id }, data: { tokenFirma: token, metodoFirma: "LINK", firmaUrl: null, fechaFirma: null } as any });
  res.json({ url: `/firmar-radicado/${token}` });
});

export default router;
