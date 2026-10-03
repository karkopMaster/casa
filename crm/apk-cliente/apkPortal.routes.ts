// backend/src/routes/apkPortal.routes.ts
// APK del CLIENTE FINAL de cada empresa: abre su portal (/cliente/), con su nombre y su logo como ícono.
// Misma mecánica que apkCliente.routes.ts (que genera el APK de administración), pero con tipo "cliente".
import { Router } from "express";
import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { controlPrisma } from "../lib/controlPrisma";
import { resolveTenantClient, runWithTenantClient } from "../lib/tenantDb";

const router = Router();
const DOMINIO = ".148-113-203-154.sslip.io";
const PUBLICO = path.join(__dirname, "../../public");
const CARPETA = path.join(PUBLICO, "apk");
const BASE = "/home/ubuntu/isp-crm/apkbase";
const GENERADOR = path.join(BASE, "gen-apk.sh");
const enCurso = new Map<string, Promise<void>>();

function generar(slug: string, host: string, nombre: string, logo: string) {
  return new Promise<void>((ok, fallo) => {
    execFile("bash", [GENERADOR, slug, host, nombre, logo, "cliente"], { timeout: 90000 }, (err) => (err ? fallo(err) : ok()));
  });
}

async function marcaDeLaEmpresa(empresaId: string) {
  let nombre = "";
  let logoUrl = "";
  try {
    const cliente = await resolveTenantClient(empresaId);
    if (cliente) {
      const cfg: any = await runWithTenantClient(cliente, () => (cliente as any).empresaConfig.findFirst({ select: { nombre: true, logoUrl: true } }));
      nombre = String(cfg?.nombre ?? "");
      logoUrl = String(cfg?.logoUrl ?? "");
    }
  } catch (err) {
    console.error("No se pudo leer la marca de la empresa:", err);
  }
  // El logo solo se toma de la carpeta de archivos subidos
  let logo = "";
  if (logoUrl) {
    const ruta = path.normalize(path.join(PUBLICO, logoUrl));
    if (ruta.startsWith(path.join(PUBLICO, "uploads") + path.sep) && fs.existsSync(ruta)) logo = ruta;
  }
  return { nombre, logo, logoUrl };
}

function mtime(archivo: string) {
  try {
    return String(fs.statSync(archivo).mtimeMs);
  } catch {
    return "0";
  }
}

router.get("/", async (req, res) => {
  const host = req.hostname.toLowerCase();
  const slug = host.endsWith(DOMINIO) ? host.slice(0, -DOMINIO.length) : "";
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) return res.status(404).send("Empresa no encontrada");
  try {
    const empresa = await controlPrisma.empresaTenant.findUnique({ where: { slug }, select: { id: true, nombre: true } });
    if (!empresa) return res.status(404).send("Empresa no encontrada");
    const marca = await marcaDeLaEmpresa(empresa.id);
    const nombre = marca.nombre || empresa.nombre || slug;
    // Se vuelve a generar si cambió el nombre, el logo o la base de la app
    const firma = crypto
      .createHash("sha1")
      .update(["cliente", nombre, marca.logoUrl, marca.logo ? mtime(marca.logo) : "", mtime(path.join(BASE, "classes.dex")), mtime(GENERADOR), mtime(path.join(BASE, "manifest.tpl.xml"))].join("|"))
      .digest("hex");
    const archivo = path.join(CARPETA, `${slug}-cliente.apk`);
    const archivoFirma = path.join(CARPETA, `${slug}-cliente.sig`);
    const vigente = fs.existsSync(archivo) && fs.existsSync(archivoFirma) && fs.readFileSync(archivoFirma, "utf8") === firma;
    if (!vigente) {
      let trabajo = enCurso.get(slug);
      if (!trabajo) {
        trabajo = generar(slug, host, nombre, marca.logo)
          .then(() => fs.writeFileSync(archivoFirma, firma))
          .finally(() => enCurso.delete(slug));
        enCurso.set(slug, trabajo);
      }
      await trabajo;
    }
    res.download(archivo, `${nombre.replace(/[^A-Za-z0-9._-]+/g, "-")}-Cliente.apk`);
  } catch (err) {
    console.error("Error al generar el APK del cliente:", err);
    res.status(500).send("No se pudo generar la app. Intenta de nuevo.");
  }
});

export default router;
