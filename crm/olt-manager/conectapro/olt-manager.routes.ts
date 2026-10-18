// ConectaPro (backend): entrega al navegador un enlace SSO de corta vida hacia OLT Manager.
// Se monta en index.ts:  app.use("/api/olt-manager", oltManagerRoutes);
// Variables en el .env del backend:  OLT_MANAGER_URL=https://olt.tudominio.com   OLT_SSO_SECRET=<SSO_SECRET del VPS de OLT>
import { Router } from "express";
import jwt from "jsonwebtoken";
import { requireAuth, AuthedRequest } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

// Solo administradores / quien gestione la OLT. Ajusta los nombres de rol a los de tu sistema.
const ROLES_OLT = new Set(["ADMIN", "SUPERADMIN", "ADMINISTRADOR"]);

router.get("/enlace", (req: AuthedRequest, res) => {
  const base = String(process.env.OLT_MANAGER_URL ?? "").replace(/\/+$/, "");
  const secreto = process.env.OLT_SSO_SECRET ?? "";
  if (!base || secreto.length < 32) return res.status(503).json({ error: "OLT Manager no está configurado." });
  const u: any = req.user ?? {};
  if (!ROLES_OLT.has(String(u.rol ?? u.role ?? "").toUpperCase())) return res.status(403).json({ error: "Sin permiso." });
  const token = jwt.sign({ sub: String(u.email ?? u.id ?? u.sub ?? "conectapro") }, secreto, { algorithm: "HS256", audience: "olt-sso", expiresIn: "60s" });
  res.json({ url: `${base}/sso?token=${encodeURIComponent(token)}` });
});

export default router;
