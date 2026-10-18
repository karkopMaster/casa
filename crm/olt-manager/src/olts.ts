import { db, bitacora } from "./db";
import { descifrar } from "./crypto";
import { HuaweiDriver } from "./drivers/huawei";
import type { DriverOlt, UbicacionOnt } from "./drivers/driver";
import { clasificarSenal } from "./parsers";

export interface OltRow { id: number; nombre: string; marca: string; host: string; puerto: number; usuario: string; clave_cifrada: string }
export interface OnuRow {
  external_id: string; olt_id: number; frame: number; slot: number; port: number; ont_id: number; sn: string;
  nombre: string; direccion: string; tipo: string; estado: string; admin_estado: string;
  rx_onu: number | null; tx_onu: number | null; rx_olt: number | null; tr069_id: string | null; actualizado: string | null;
}

export function driverDe(olt: OltRow): DriverOlt {
  if (olt.marca !== "huawei") throw new Error(`Marca no soportada todavía: ${olt.marca}`);
  return new HuaweiDriver({ host: olt.host, port: olt.puerto, username: olt.usuario, password: descifrar(olt.clave_cifrada) });
}

export const getOlt = (id: number) => db.prepare("SELECT * FROM olts WHERE id=?").get(id) as OltRow | undefined;
export const getOnu = (externalId: string) => db.prepare("SELECT * FROM onus WHERE external_id=?").get(externalId) as OnuRow | undefined;
export const ubic = (o: OnuRow): UbicacionOnt => ({ frame: o.frame, slot: o.slot, port: o.port, ontId: o.ont_id });

// Una sola sesión SSH por OLT a la vez: las OLT aguantan pocas sesiones simultáneas.
const colas = new Map<number, Promise<unknown>>();
export function enCola<T>(oltId: number, tarea: () => Promise<T>): Promise<T> {
  const prev = colas.get(oltId) ?? Promise.resolve();
  const sig = prev.then(tarea, tarea);
  colas.set(oltId, sig.catch(() => undefined));
  return sig;
}

/** Lee de la OLT las ONU pendientes de autorizar y las guarda. */
export async function sondearPendientes(olt: OltRow) {
  const lista = await enCola(olt.id, () => driverDe(olt).pendientes());
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM pendientes WHERE olt_id=?").run(olt.id);
    const ins = db.prepare("INSERT INTO pendientes (olt_id, frame, slot, port, sn, equipo) VALUES (?,?,?,?,?,?)");
    for (const p of lista) ins.run(olt.id, p.frame, p.slot, p.port, p.sn, p.equipo);
  });
  tx();
  db.prepare("UPDATE olts SET ultimo_sondeo=datetime('now'), ultimo_error=NULL WHERE id=?").run(olt.id);
  return lista.length;
}

/** Actualiza estado (online/offline) de las ONU conocidas leyendo cada puerto PON usado. */
export async function sondearEstados(olt: OltRow) {
  const puertos = db.prepare("SELECT DISTINCT frame, slot, port FROM onus WHERE olt_id=?").all(olt.id) as { frame: number; slot: number; port: number }[];
  const upd = db.prepare("UPDATE onus SET estado=?, admin_estado=?, actualizado=datetime('now') WHERE olt_id=? AND frame=? AND slot=? AND port=? AND ont_id=?");
  for (const p of puertos) {
    const filas = await enCola(olt.id, () => driverDe(olt).listarOnts(p.frame, p.slot, p.port));
    for (const f of filas) upd.run(f.run.toLowerCase() === "online" ? "online" : "offline", f.control.toLowerCase() === "deactivated" ? "Disabled" : "Enabled", olt.id, f.frame, f.slot, f.port, f.ontId);
  }
}

export async function leerPotencia(externalId: string) {
  const onu = getOnu(externalId);
  if (!onu) throw new Error("ONU no encontrada");
  const olt = getOlt(onu.olt_id)!;
  const p = await enCola(olt.id, () => driverDe(olt).potencia(ubic(onu)));
  db.prepare("UPDATE onus SET rx_onu=?, tx_onu=?, rx_olt=?, actualizado=datetime('now') WHERE external_id=?").run(p.rxOnu, p.txOnu, p.rxOlt, externalId);
  return { ...p, senal: clasificarSenal(p.rxOnu) };
}

export async function autorizarOnu(a: {
  oltId: number; sn: string; externalId: string; nombre: string; direccion?: string; tipo?: string;
  lineProfile: string; srvProfile: string; frame?: number; slot?: number; port?: number; actor: string;
}) {
  const olt = getOlt(a.oltId);
  if (!olt) throw new Error("OLT no encontrada");
  if (getOnu(a.externalId)) throw new Error("Ya existe una ONU con ese ID externo");
  const sn = a.sn.toUpperCase();
  const pend = db.prepare("SELECT * FROM pendientes WHERE olt_id=? AND sn=?").get(olt.id, sn) as { frame: number; slot: number; port: number } | undefined;
  const frame = a.frame ?? pend?.frame, slot = a.slot ?? pend?.slot, port = a.port ?? pend?.port;
  if (frame === undefined || slot === undefined || port === undefined) throw new Error("No se sabe en qué puerto PON está la ONU: indícalo o espera a que aparezca en pendientes");

  const ontId = await enCola(olt.id, async () => {
    const d = driverDe(olt);
    const id = await d.siguienteOntId(frame, slot, port);
    await d.autorizar({ frame, slot, port, ontId: id, sn, lineProfile: a.lineProfile, srvProfile: a.srvProfile, descripcion: a.nombre });
    return id;
  });
  db.prepare(`INSERT INTO onus (external_id, olt_id, frame, slot, port, ont_id, sn, nombre, direccion, tipo, estado, actualizado)
              VALUES (?,?,?,?,?,?,?,?,?,?,'desconocido',datetime('now'))`)
    .run(a.externalId, olt.id, frame, slot, port, ontId, sn, a.nombre, a.direccion ?? "", a.tipo ?? "");
  db.prepare("DELETE FROM pendientes WHERE olt_id=? AND sn=?").run(olt.id, sn);
  bitacora(a.actor, "autorizar", `${olt.nombre} ${frame}/${slot}/${port} id=${ontId} sn=${sn} ext=${a.externalId}`);
  return getOnu(a.externalId)!;
}

type Accion = "activar" | "desactivar" | "reiniciar" | "eliminar";
export async function accionOnu(externalId: string, accion: Accion, actor: string) {
  const onu = getOnu(externalId);
  if (!onu) throw new Error("ONU no encontrada");
  const olt = getOlt(onu.olt_id)!;
  try {
    await enCola(olt.id, () => driverDe(olt)[accion](ubic(onu)));
  } catch (e) {
    bitacora(actor, accion, `${externalId}: ${(e as Error).message}`, false);
    throw e;
  }
  if (accion === "activar") db.prepare("UPDATE onus SET admin_estado='Enabled' WHERE external_id=?").run(externalId);
  if (accion === "desactivar") db.prepare("UPDATE onus SET admin_estado='Disabled' WHERE external_id=?").run(externalId);
  if (accion === "eliminar") db.prepare("DELETE FROM onus WHERE external_id=?").run(externalId);
  bitacora(actor, accion, `${olt.nombre} ${externalId}`);
}
