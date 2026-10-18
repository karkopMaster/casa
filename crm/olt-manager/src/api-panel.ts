// API interna del panel web (cookie de sesión).
import { Router } from "express";
import { z } from "zod";
import { db } from "./db";
import { cifrar } from "./crypto";
import { requierePanel } from "./auth";
import { accionOnu, autorizarOnu, getOlt, leerPotencia, sondearEstados, sondearPendientes, type OnuRow, type OltRow } from "./olts";
import { clasificarSenal } from "./parsers";

export const panel = Router();
panel.use(requierePanel);

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const actor = (req: any) => req.actor?.nombre ?? "panel";
const pub = (o: OltRow & { ultimo_sondeo?: string; ultimo_error?: string }) => ({ id: o.id, nombre: o.nombre, marca: o.marca, host: o.host, puerto: o.puerto, usuario: o.usuario, ultimo_sondeo: o.ultimo_sondeo, ultimo_error: o.ultimo_error });

panel.get("/resumen", (_req, res) => {
  const c = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  res.json({
    olts: c("SELECT COUNT(*) n FROM olts"), onus: c("SELECT COUNT(*) n FROM onus"),
    online: c("SELECT COUNT(*) n FROM onus WHERE estado='online'"), offline: c("SELECT COUNT(*) n FROM onus WHERE estado='offline'"),
    deshabilitadas: c("SELECT COUNT(*) n FROM onus WHERE admin_estado='Disabled'"), pendientes: c("SELECT COUNT(*) n FROM pendientes"),
    senalCritica: c("SELECT COUNT(*) n FROM onus WHERE rx_onu IS NOT NULL AND rx_onu < -27"),
  });
});

// --- OLT ---
const oltBody = z.object({
  nombre: z.string().min(1).max(60), marca: z.enum(["huawei"]).default("huawei"),
  host: z.string().min(1).max(255), puerto: z.number().int().min(1).max(65535).default(22),
  usuario: z.string().min(1).max(60), clave: z.string().min(1).max(200),
});
panel.get("/olts", (_req, res) => res.json({ items: (db.prepare("SELECT * FROM olts ORDER BY nombre").all() as OltRow[]).map(pub) }));
panel.post("/olts", (req, res) => {
  const p = oltBody.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Datos inválidos: " + p.error.issues.map((i) => i.path.join(".")).join(", ") });
  try {
    const r = db.prepare("INSERT INTO olts (nombre, marca, host, puerto, usuario, clave_cifrada) VALUES (?,?,?,?,?,?)")
      .run(p.data.nombre, p.data.marca, p.data.host, p.data.puerto, p.data.usuario, cifrar(p.data.clave));
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) { res.status(409).json({ error: msg(e).includes("UNIQUE") ? "Ya existe una OLT con ese nombre" : msg(e) }); }
});
panel.delete("/olts/:id", (req, res) => { db.prepare("DELETE FROM olts WHERE id=?").run(Number(req.params.id)); res.json({ ok: true }); });
panel.post("/olts/:id/sondear", async (req, res) => {
  const olt = getOlt(Number(req.params.id));
  if (!olt) return res.status(404).json({ error: "OLT no encontrada" });
  try { const n = await sondearPendientes(olt); await sondearEstados(olt); res.json({ ok: true, pendientes: n }); }
  catch (e) { db.prepare("UPDATE olts SET ultimo_error=? WHERE id=?").run(msg(e).slice(0, 200), olt.id); res.status(502).json({ error: msg(e) }); }
});

// --- Perfiles Huawei (line/srv profile) ---
panel.get("/olts/:id/perfiles", (req, res) => res.json({ items: db.prepare("SELECT * FROM perfiles WHERE olt_id=?").all(Number(req.params.id)) }));
panel.post("/olts/:id/perfiles", (req, res) => {
  const p = z.object({ nombre: z.string().min(1).max(60), line_profile: z.string().regex(/^[\w.\- ]{1,64}$/), srv_profile: z.string().regex(/^[\w.\- ]{1,64}$/) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Datos inválidos" });
  db.prepare("INSERT INTO perfiles (olt_id, line_profile, srv_profile, nombre) VALUES (?,?,?,?)").run(Number(req.params.id), p.data.line_profile, p.data.srv_profile, p.data.nombre);
  res.status(201).json({ ok: true });
});

// --- Pendientes y ONU ---
panel.get("/pendientes", (_req, res) => res.json({ items: db.prepare("SELECT p.*, o.nombre olt FROM pendientes p JOIN olts o ON o.id=p.olt_id ORDER BY p.visto DESC").all() }));

panel.get("/onus", (req, res) => {
  const q = `%${String(req.query.q ?? "").trim()}%`;
  const filas = db.prepare(`SELECT n.*, o.nombre olt FROM onus n JOIN olts o ON o.id=n.olt_id
    WHERE n.external_id LIKE ? OR n.sn LIKE ? OR n.nombre LIKE ? OR n.direccion LIKE ? ORDER BY n.nombre LIMIT 500`).all(q, q, q, q) as (OnuRow & { olt: string })[];
  res.json({ items: filas.map((f) => ({ ...f, senal: clasificarSenal(f.rx_onu) })) });
});

const autorizarBody = z.object({
  oltId: z.number().int(), sn: z.string().regex(/^[0-9A-Fa-f]{16}$/), externalId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  nombre: z.string().min(1).max(80), direccion: z.string().max(200).optional(), tipo: z.string().max(60).optional(),
  lineProfile: z.string().regex(/^[\w.\- ]{1,64}$/), srvProfile: z.string().regex(/^[\w.\- ]{1,64}$/),
  frame: z.number().int().optional(), slot: z.number().int().optional(), port: z.number().int().optional(),
});
panel.post("/onus/autorizar", async (req, res) => {
  const p = autorizarBody.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Datos inválidos: " + p.error.issues.map((i) => i.path.join(".")).join(", ") });
  try { res.status(201).json(await autorizarOnu({ ...p.data, actor: actor(req) })); }
  catch (e) { res.status(502).json({ error: msg(e) }); }
});

panel.post("/onus/:id/senal", async (req, res) => {
  try { res.json(await leerPotencia(req.params.id)); } catch (e) { res.status(502).json({ error: msg(e) }); }
});
for (const a of ["activar", "desactivar", "reiniciar", "eliminar"] as const) {
  panel.post(`/onus/:id/${a}`, async (req, res) => {
    try { await accionOnu(req.params.id, a, actor(req)); res.json({ ok: true }); } catch (e) { res.status(502).json({ error: msg(e) }); }
  });
}
panel.patch("/onus/:id", (req, res) => {
  const p = z.object({ nombre: z.string().max(80).optional(), direccion: z.string().max(200).optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Datos inválidos" });
  db.prepare("UPDATE onus SET nombre=COALESCE(?,nombre), direccion=COALESCE(?,direccion) WHERE external_id=?").run(p.data.nombre ?? null, p.data.direccion ?? null, req.params.id);
  res.json({ ok: true });
});

panel.get("/bitacora", (_req, res) => res.json({ items: db.prepare("SELECT * FROM bitacora ORDER BY id DESC LIMIT 200").all() }));
