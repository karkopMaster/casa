import path from "path";

const env = (k: string, d = ""): string => process.env[k] ?? d;

export const config = {
  port: Number(env("PORT", "3100")),
  dataDir: env("DATA_DIR", path.join(process.cwd(), "data")),
  /** Clave (32+ caracteres) para cifrar las claves de las OLT en la base. */
  secretoCifrado: env("OLT_SECRET", ""),
  /** Secreto compartido con ConectaPro para el acceso SSO (JWT HS256). */
  ssoSecret: env("SSO_SECRET", ""),
  /** Origen de ConectaPro que puede incrustar el panel (CSP frame-ancestors / CORS). */
  conectaproOrigin: env("CONECTAPRO_ORIGIN", ""),
  cookieSegura: env("COOKIE_SECURE", "1") !== "0",
  genieacsUrl: env("GENIEACS_URL", ""),
  sondeoMinutos: Number(env("SONDEO_MINUTOS", "10")),
};

export function validarConfig() {
  const faltan: string[] = [];
  if (config.secretoCifrado.length < 32) faltan.push("OLT_SECRET (mínimo 32 caracteres)");
  if (config.ssoSecret.length < 32) faltan.push("SSO_SECRET (mínimo 32 caracteres)");
  if (faltan.length) throw new Error("Falta configurar en .env: " + faltan.join(", "));
}
