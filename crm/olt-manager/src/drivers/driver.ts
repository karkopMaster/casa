import type { Pendiente, OntFila, Potencia } from "../parsers";

export interface ConexionOlt { host: string; port: number; username: string; password: string }
export interface AutorizarParams { frame: number; slot: number; port: number; ontId: number; sn: string; lineProfile: string; srvProfile: string; descripcion?: string }
export interface UbicacionOnt { frame: number; slot: number; port: number; ontId: number }

/** Interfaz común: para sumar ZTE, FiberHome, VSOL, etc. basta con otra clase que la implemente. */
export interface DriverOlt {
  pendientes(): Promise<Pendiente[]>;
  listarOnts(frame: number, slot: number, port: number): Promise<OntFila[]>;
  potencia(u: UbicacionOnt): Promise<Potencia>;
  autorizar(p: AutorizarParams): Promise<void>;
  activar(u: UbicacionOnt): Promise<void>;
  desactivar(u: UbicacionOnt): Promise<void>;
  reiniciar(u: UbicacionOnt): Promise<void>;
  eliminar(u: UbicacionOnt): Promise<void>;
  /** Primer ont-id libre del puerto. */
  siguienteOntId(frame: number, slot: number, port: number): Promise<number>;
}
