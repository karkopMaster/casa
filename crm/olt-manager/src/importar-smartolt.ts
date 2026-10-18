// Migra las ONU desde SmartOLT conservando el "unique external ID" (el que ConectaPro guarda en cada contrato).
//   SMARTOLT_URL=https://xxx.smartolt.com SMARTOLT_KEY=... npx tsx src/importar-smartolt.ts <id_olt_local> [frame=0] [--aplicar]
// Sin --aplicar solo muestra cuántas importaría. Crea la OLT antes en el panel.
import { db } from "./db";
import { getOlt } from "./olts";

const pos = process.argv.slice(2).filter((x) => !x.startsWith("--"));
const aplicar = process.argv.includes("--aplicar");
const oltId = Number(pos[0]); const frame = Number(pos[1] ?? 0);
(async () => {
  const base = (process.env.SMARTOLT_URL ?? "").replace(/\/+$/, ""), key = process.env.SMARTOLT_KEY ?? "";
  if (!base || !key || !getOlt(oltId)) throw new Error("Define SMARTOLT_URL, SMARTOLT_KEY y un <id_olt_local> existente");
  const r = await fetch(`${base}/api/onu/get_all_onus_details`, { headers: { "X-Token": key } });
  const j: any = await r.json();
  if (!r.ok || j.status === false) throw new Error("SmartOLT: " + (j.error ?? r.status));
  const lista: any[] = j.onus ?? [];
  console.log(`SmartOLT devolvió ${lista.length} ONU.`);
  if (!aplicar) return console.log("No se guardó nada. Repite con --aplicar.");
  const ins = db.prepare(`INSERT OR IGNORE INTO onus (external_id, olt_id, frame, slot, port, ont_id, sn, nombre, direccion, tipo, estado, admin_estado)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  let n = 0;
  for (const o of lista) {
    const ext = String(o.unique_external_id ?? "").trim();
    if (!ext) continue;
    n += ins.run(ext, oltId, frame, Number(o.board), Number(o.port), Number(o.onu), String(o.sn).toUpperCase(), o.name ?? "", o.address ?? "", o.onu_type_name ?? "",
      String(o.status).toLowerCase() === "online" ? "online" : "offline", o.administrative_status === "Disabled" ? "Disabled" : "Enabled").changes;
  }
  console.log(`Importadas ${n} ONU (las demás ya existían o no tenían external ID).`);
})().catch((e) => { console.error("Error:", e.message); process.exit(1); });
