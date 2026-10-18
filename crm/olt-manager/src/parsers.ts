// Parsers de la salida CLI de Huawei MA5600/MA5800. Toleran espacios y variaciones entre versiones de firmware.

export interface Pendiente { frame: number; slot: number; port: number; sn: string; equipo: string }
export interface OntFila { frame: number; slot: number; port: number; ontId: number; sn: string; control: string; run: string }
export interface Potencia { rxOnu: number | null; txOnu: number | null; rxOlt: number | null }

/** `display ont autofind all` → ONT sin autorizar. */
export function parsearAutofind(txt: string): Pendiente[] {
  const out: Pendiente[] = [];
  for (const bloque of txt.split(/-{10,}/)) {
    const fsp = bloque.match(/F\/S\/P\s*:\s*(\d+)\/(\d+)\/(\d+)/i);
    const sn = bloque.match(/Ont SN\s*:\s*([0-9A-Fa-f]{16})/i);
    if (!fsp || !sn) continue;
    const eq = bloque.match(/Ont EquipmentID\s*:\s*(\S*)/i);
    out.push({ frame: +fsp[1], slot: +fsp[2], port: +fsp[3], sn: sn[1].toUpperCase(), equipo: eq?.[1] ?? "" });
  }
  return out;
}

/** `display ont info <f/s/p> all` → tabla de ONT del puerto. */
export function parsearOntInfo(txt: string): OntFila[] {
  const out: OntFila[] = [];
  const re = /^\s*(\d+)\/\s*(\d+)\/\s*(\d+)\s+(\d+)\s+([0-9A-Fa-f]{16})\s+(\S+)\s+(\S+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(txt))) out.push({ frame: +m[1], slot: +m[2], port: +m[3], ontId: +m[4], sn: m[5].toUpperCase(), control: m[6], run: m[7] });
  return out;
}

const num = (m: RegExpMatchArray | null) => (m && !Number.isNaN(parseFloat(m[1])) ? parseFloat(m[1]) : null);

/** `display ont optical-info <port> <ontid>` → potencias en dBm. */
export function parsearPotencia(txt: string): Potencia {
  return {
    rxOnu: num(txt.match(/^\s*Rx optical power\(dBm\)\s*:\s*(-?[\d.]+)/im)),
    txOnu: num(txt.match(/^\s*Tx optical power\(dBm\)\s*:\s*(-?[\d.]+)/im)),
    rxOlt: num(txt.match(/OLT Rx ONT optical power\(dBm\)\s*:\s*(-?[\d.]+)/i)),
  };
}

/** Clasifica la señal como lo hace SmartOLT: Very good / Warning / Critical. */
export function clasificarSenal(rxOnu: number | null): "Very good" | "Warning" | "Critical" | "N/A" {
  if (rxOnu === null) return "N/A";
  if (rxOnu >= -25) return "Very good";
  if (rxOnu >= -27) return "Warning";
  return "Critical";
}
