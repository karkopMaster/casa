import crypto from "crypto";
import { config } from "./config";

const clave = () => crypto.scryptSync(config.secretoCifrado, "olt-manager", 32);

export function cifrar(texto: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", clave(), iv);
  const enc = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function descifrar(valor: string): string {
  const [iv, tag, enc] = valor.split(".").map((p) => Buffer.from(p, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", clave(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function hashClave(clavePlana: string): string {
  const sal = crypto.randomBytes(16);
  return `${sal.toString("hex")}:${crypto.scryptSync(clavePlana, sal, 64).toString("hex")}`;
}

export function verificarClave(clavePlana: string, guardada: string): boolean {
  const [sal, h] = guardada.split(":");
  if (!sal || !h) return false;
  const calc = crypto.scryptSync(clavePlana, Buffer.from(sal, "hex"), 64);
  const esperado = Buffer.from(h, "hex");
  return calc.length === esperado.length && crypto.timingSafeEqual(calc, esperado);
}
