// backend/src/routes/marca.routes.ts
// Íconos y manifiesto por empresa, a partir de su logo (EmpresaConfig.logoUrl).
// La empresa se identifica por el subdominio, igual que /api/public/empresa y /favicon.
import { Router } from "express";
import path from "path";
import fs from "fs";
import { controlPrisma } from "../lib/controlPrisma";
import { getCachedTenantClient } from "../lib/tenantDb";

const router = Router();
const SLUG_PREDETERMINADO = "redcien";
const UPLOADS_DIR = path.join(__dirname, "../../public/uploads");
const TAMANOS = new Set([16, 32, 48, 96, 180, 192, 512]);
const TIPOS: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };

type Marca = { nombre: string; logoUrl: string | null };
const cacheMarca = new Map<string, { t: number; marca: Marca | null }>();

async function marcaDeSlug(slug: string): Promise<Marca | null> {
  const hit = cacheMarca.get(slug);
  if (hit && Date.now() - hit.t < 60_000) return hit.marca;
  let marca: Marca | null = null;
  try {
    const tenant = await controlPrisma.empresaTenant.findUnique({ where: { slug } });
    if (tenant?.databaseUrl) {
      const client = getCachedTenantClient(tenant.databaseUrl);
      const config = (await client.empresaConfig.findFirst({ where: { empresaTenantId: tenant.id } })) ?? (await client.empresaConfig.findFirst());
      marca = { nombre: config?.nombre ?? tenant.nombre, logoUrl: config?.logoUrl ?? null };
    }
  } catch {
    marca = null;
  }
  cacheMarca.set(slug, { t: Date.now(), marca });
  return marca;
}

async function marcaDeRequest(req: { hostname?: string }): Promise<Marca | null> {
  const slug = (req.hostname || "").split(".")[0]?.toLowerCase();
  return (slug && (await marcaDeSlug(slug))) || (await marcaDeSlug(SLUG_PREDETERMINADO));
}

function archivoLogo(marca: Marca | null): string | null {
  if (!marca?.logoUrl) return null;
  const f = path.join(UPLOADS_DIR, path.basename(marca.logoUrl));
  return fs.existsSync(f) ? f : null;
}

const cacheIconos = new Map<string, Buffer>();

/** Ícono cuadrado del logo de la empresa: /api/public/icono/32.png (tamaños 16, 32, 48, 96, 180, 192, 512). */
router.get("/icono/:size", async (req, res) => {
  const size = parseInt(String(req.params.size), 10);
  if (!TAMANOS.has(size)) return res.status(404).end();
  const marca = await marcaDeRequest(req);
  const archivo = archivoLogo(marca);
  if (!archivo) return res.status(404).end();
  const mtime = fs.statSync(archivo).mtimeMs;
  const clave = `${archivo}:${mtime}:${size}`;
  res.setHeader("Cache-Control", "public, max-age=3600");
  try {
    let png = cacheIconos.get(clave);
    if (!png) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sharp = require("sharp");
      // iOS no admite transparencia en apple-touch-icon (180): fondo blanco; el resto conserva transparencia.
      const fondo = size === 180 ? { r: 255, g: 255, b: 255, alpha: 1 } : { r: 0, g: 0, b: 0, alpha: 0 };
      const margen = Math.round(size * 0.06);
      png = (await sharp(archivo, { density: 300 })
        .resize(size - margen * 2, size - margen * 2, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .extend({ top: margen, bottom: margen, left: margen, right: margen, background: fondo })
        .flatten(size === 180 ? { background: fondo } : false)
        .png()
        .toBuffer()) as Buffer;
      if (cacheIconos.size > 300) cacheIconos.clear();
      cacheIconos.set(clave, png);
    }
    res.setHeader("Content-Type", "image/png");
    return res.send(png);
  } catch {
    // Sin sharp (o imagen ilegible): se entrega el logo original, como hacía /favicon.
    const tipo = TIPOS[path.extname(archivo).toLowerCase()];
    if (!tipo) return res.status(404).end();
    res.setHeader("Content-Type", tipo);
    return res.send(fs.readFileSync(archivo));
  }
});

/** Manifiesto (nombre e íconos de la app instalable) de la empresa. */
router.get("/manifest.webmanifest", async (req, res) => {
  const marca = await marcaDeRequest(req);
  const nombre = marca?.nombre || "ISP CRM";
  const v = marca?.logoUrl ? encodeURIComponent(path.basename(marca.logoUrl)) : "";
  const icons = archivoLogo(marca)
    ? [192, 512].map((s) => ({ src: `/api/public/icono/${s}.png?v=${v}`, sizes: `${s}x${s}`, type: "image/png", purpose: "any" }))
    : [];
  res.setHeader("Content-Type", "application/manifest+json");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({ name: nombre, short_name: nombre.slice(0, 12), start_url: "/", scope: "/", display: "standalone", background_color: "#ffffff", theme_color: "#ffffff", icons });
});

export default router;
