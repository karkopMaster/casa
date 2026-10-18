import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "./db";
import { config } from "./config";
import { sha256, verificarClave } from "./crypto";

export interface Actor { nombre: string }
declare module "express-serve-static-core" { interface Request { actor?: Actor } }

const COOKIE = "olt_sesion";

export function leerCookie(req: Request, nombre: string): string | undefined {
  const m = (req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith(nombre + "="));
  return m ? decodeURIComponent(m.slice(nombre.length + 1)) : undefined;
}

export function emitirSesion(res: Response, usuario: string) {
  const t = jwt.sign({ sub: usuario, aud: "panel" }, config.ssoSecret, { algorithm: "HS256", expiresIn: "12h" });
  // SameSite=None + Secure: el panel va incrustado (iframe) dentro de ConectaPro.
  const attrs = config.cookieSegura ? "SameSite=None; Secure" : "SameSite=Lax";
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(t)}; HttpOnly; Path=/; Max-Age=43200; ${attrs}`);
}

export function cerrarSesion(res: Response) {
  const attrs = config.cookieSegura ? "SameSite=None; Secure" : "SameSite=Lax";
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; ${attrs}`);
}

export function loginClave(usuario: string, clave: string): boolean {
  const u = db.prepare("SELECT clave_hash FROM usuarios WHERE usuario=?").get(usuario) as { clave_hash: string } | undefined;
  return !!u && verificarClave(clave, u.clave_hash);
}

/** Entrada desde ConectaPro: JWT corto firmado con SSO_SECRET (aud "olt-sso"). */
export function verificarSso(token: string): string {
  const p = jwt.verify(token, config.ssoSecret, { algorithms: ["HS256"], audience: "olt-sso" }) as jwt.JwtPayload;
  return String(p.sub ?? "conectapro");
}

export function requierePanel(req: Request, res: Response, next: NextFunction) {
  try {
    const t = leerCookie(req, COOKIE);
    if (!t) throw new Error("sin sesión");
    const p = jwt.verify(t, config.ssoSecret, { algorithms: ["HS256"], audience: "panel" }) as jwt.JwtPayload;
    req.actor = { nombre: String(p.sub) };
    next();
  } catch {
    res.status(401).json({ error: "Sesión vencida" });
  }
}

/** API compatible con SmartOLT: cabecera X-Token. */
export function requiereApiKey(req: Request, res: Response, next: NextFunction) {
  const t = String(req.headers["x-token"] ?? "");
  const ok = t && db.prepare("SELECT 1 FROM api_keys WHERE hash=?").get(sha256(t));
  if (!ok) return res.status(401).json({ status: false, error: "Invalid API key" });
  req.actor = { nombre: "api" };
  next();
}

// Freno básico a intentos de login por IP.
const intentos = new Map<string, number[]>();
export function frenoLogin(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip ?? "?";
  const ahora = Date.now();
  const l = (intentos.get(ip) ?? []).filter((t) => ahora - t < 15 * 60_000);
  if (l.length >= 10) return res.status(429).json({ error: "Demasiados intentos. Espera 15 minutos." });
  intentos.set(ip, [...l, ahora]);
  next();
}
