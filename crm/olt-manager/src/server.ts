import express from "express";
import path from "path";
import { config, validarConfig } from "./config";
import { db } from "./db";
import { cerrarSesion, emitirSesion, frenoLogin, loginClave, verificarSso } from "./auth";
import { panel } from "./api-panel";
import { smartolt } from "./api-smartolt";
import { getOlt, sondearEstados, sondearPendientes, type OltRow } from "./olts";

validarConfig();
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

// Solo ConectaPro puede incrustar el panel.
app.use((_req, res, next) => {
  res.setHeader("Content-Security-Policy", `frame-ancestors 'self' ${config.conectaproOrigin}`.trim());
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

app.get("/salud", (_req, res) => res.json({ ok: true }));

app.post("/auth/login", frenoLogin, (req, res) => {
  const { usuario, clave } = req.body ?? {};
  if (!loginClave(String(usuario ?? ""), String(clave ?? ""))) return res.status(401).json({ error: "Usuario o clave incorrectos" });
  emitirSesion(res, String(usuario));
  res.json({ ok: true });
});
app.post("/auth/salir", (_req, res) => { cerrarSesion(res); res.json({ ok: true }); });

// Entrada única desde ConectaPro: /sso?token=<jwt corto>
app.get("/sso", frenoLogin, (req, res) => {
  try { emitirSesion(res, verificarSso(String(req.query.token ?? ""))); res.redirect("/"); }
  catch { res.status(401).send("Enlace vencido. Vuelve a abrir desde ConectaPro."); }
});

app.use("/api", smartolt);          // compatible con SmartOLT (X-Token)
app.use("/panel-api", panel);        // API del panel (cookie)
app.use(express.static(path.join(__dirname, "../public")));

app.listen(config.port, process.env.HOST || "0.0.0.0", () => console.log(`olt-manager en :${config.port}`));

// Sondeo periódico de pendientes y estados.
let corriendo = false;
async function ciclo() {
  if (corriendo) return;
  corriendo = true;
  for (const o of db.prepare("SELECT id FROM olts").all() as { id: number }[]) {
    const olt = getOlt(o.id) as OltRow;
    try { await sondearPendientes(olt); await sondearEstados(olt); }
    catch (e) { db.prepare("UPDATE olts SET ultimo_error=? WHERE id=?").run((e as Error).message.slice(0, 200), olt.id); }
  }
  corriendo = false;
}
setInterval(ciclo, Math.max(1, config.sondeoMinutos) * 60_000).unref();
