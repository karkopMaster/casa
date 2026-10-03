// backend/src/services/dashboardMikrotik.ts
// Estado REAL de los cortes según los Mikrotik (solo lectura): sirve para que las tarjetas
// "Morosos" y "Suspendidos" del Dashboard reflejen lo que el router tiene bloqueado.
// - Caché corta por servidor (no abre una conexión al router en cada recarga).
// - Tiempo máximo de espera por router; si falla, el Dashboard usa los datos de la base de datos.
import { prisma } from "../lib/prisma";
import { leerListaMorosos } from "./mikrotik";

type Entrada = { ip: string };

const TTL_MS = 45_000;
const ESPERA_MS = 6_000;
const cache = new Map<string, { t: number; datos: Entrada[] | null }>();
const enCurso = new Map<string, Promise<Entrada[] | null>>();

function conTiempo<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("tiempo agotado")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

function leerConCache(id: string): Promise<Entrada[] | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.t < TTL_MS) return Promise.resolve(hit.datos);
  const previa = enCurso.get(id);
  if (previa) return previa;
  const p = conTiempo(leerListaMorosos(id), ESPERA_MS)
    .then((datos) => {
      cache.set(id, { t: Date.now(), datos });
      return datos as Entrada[];
    })
    .catch(() => {
      cache.set(id, { t: Date.now(), datos: null }); // el fallo también se recuerda unos segundos
      return null;
    })
    .finally(() => {
      enCurso.delete(id);
    });
  enCurso.set(id, p);
  return p;
}

export type EstadoRouters = {
  completo: boolean; // true si TODOS los routers activos respondieron
  sinRespuesta: number;
  cortadosClienteIds: string[]; // clientes con algún contrato bloqueado en el router
  cortadosPagados: number; // bloqueados en el router cuya última factura está pagada
  deshabilitadosSinBloqueo: number; // deshabilitados en el CRM que el router NO bloquea
};

/** `where` es el filtro de empresa (tenantWhere). Devuelve null si no hay Mikrotik activos. */
export async function estadoRouters(where: any): Promise<EstadoRouters | null> {
  const servidores = await prisma.mikrotikServidor.findMany({
    where: { ...where, activo: true },
    select: { id: true, tipoCorte: true },
  });
  if (servidores.length === 0) return null;

  const lecturas: { s: any; lista: Entrada[] | null }[] = await Promise.all(
    (servidores as any[]).map(async (s) => ({ s, lista: await leerConCache(s.id) }))
  );
  const clientes = new Set<string>();
  let sinRespuesta = 0;
  let cortadosPagados = 0;
  let deshabilitadosSinBloqueo = 0;

  for (const { s, lista } of lecturas) {
    if (!lista) {
      sinRespuesta++;
      continue;
    }
    const esPppoe = s.tipoCorte === "PPPOE";
    const ids = lista.map((e: Entrada) => e.ip);
    const enRouter = new Set(ids);

    if (ids.length > 0) {
      const contratos = await prisma.contrato.findMany({
        where: { ...where, ...(esPppoe ? { pppoeUsuario: { in: ids } } : { ip: { in: ids } }) },
        select: {
          cliente: { select: { id: true } },
          facturas: { orderBy: { fechaEmision: "desc" }, take: 1, select: { estado: true } },
        },
      });
      for (const c of contratos as any[]) {
        if (c.cliente?.id) clientes.add(c.cliente.id);
        if (c.facturas?.[0]?.estado === "PAGADA") cortadosPagados++;
      }
    }

    const deshabilitados = await prisma.contrato.findMany({
      where: {
        ...where,
        estado: "DESHABILITADO",
        ...(esPppoe ? { pppoeUsuario: { not: null } } : { ip: { not: null } }),
        servidor: { mikrotikServidorId: s.id },
      },
      select: { ip: true, pppoeUsuario: true },
    });
    deshabilitadosSinBloqueo += (deshabilitados as any[]).filter((c) => !enRouter.has(String(esPppoe ? c.pppoeUsuario : c.ip))).length;
  }

  return {
    completo: sinRespuesta === 0,
    sinRespuesta,
    cortadosClienteIds: [...clientes],
    cortadosPagados,
    deshabilitadosSinBloqueo,
  };
}
