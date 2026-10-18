// Subconjunto de la API de SmartOLT, con el mismo formato, para que ConectaPro solo cambie smartoltUrl y smartoltApiKey.
import { Router } from "express";
import { db } from "./db";
import { requiereApiKey } from "./auth";
import { accionOnu, getOnu, leerPotencia, type OnuRow } from "./olts";
import { cambiarWifi, idPorSerie, wifiDisponible } from "./genieacs";
import { clasificarSenal } from "./parsers";

export const smartolt = Router();
smartolt.use(requiereApiKey);

const detalle = (o: OnuRow) => ({
  unique_external_id: o.external_id, sn: o.sn, name: o.nombre, address: o.direccion, onu_type_name: o.tipo,
  olt_id: String(o.olt_id), board: String(o.slot), port: String(o.port), onu: String(o.ont_id),
  status: o.estado === "online" ? "Online" : o.estado === "offline" ? "Offline" : "Unknown",
  administrative_status: o.admin_estado, signal: clasificarSenal(o.rx_onu), signal_1310: o.rx_onu === null ? "" : String(o.rx_onu),
  mode: "Routing", tr069: o.tr069_id ? "Active" : "Inactive",
  wifi_ports: wifiDisponible() ? [{ port: "wifi_0/1", admin_state: "Enabled" }, { port: "wifi_0/5", admin_state: "Enabled" }] : [],
});

const noExiste = (res: any) => res.status(404).json({ status: false, error: "ONU not found" });

smartolt.get("/onu/get_onu_details/:id", (req, res) => {
  const o = getOnu(req.params.id);
  if (!o) return noExiste(res);
  res.json({ status: true, onu_details: detalle(o) });
});

smartolt.get("/onu/get_all_onus_details", (_req, res) => {
  const filas = db.prepare("SELECT * FROM onus").all() as OnuRow[];
  res.json({ status: true, onus: filas.map(detalle) });
});

smartolt.get("/onu/get_onu_status/:id", (req, res) => {
  const o = getOnu(req.params.id);
  if (!o) return noExiste(res);
  res.json({ status: true, onu_status: detalle(o).status });
});

smartolt.get("/onu/get_onu_signal/:id", async (req, res) => {
  try { const p = await leerPotencia(req.params.id); res.json({ status: true, onu_signal: p.senal, onu_signal_1310: String(p.rxOnu ?? "") }); }
  catch (e) { res.status(502).json({ status: false, error: (e as Error).message }); }
});

const accion = (ruta: string, a: "activar" | "desactivar" | "reiniciar") =>
  smartolt.post(ruta, async (req, res) => {
    if (!getOnu(req.params.id)) return noExiste(res);
    try { await accionOnu(req.params.id, a, "api"); res.json({ status: true, response: "Done" }); }
    catch (e) { res.status(502).json({ status: false, error: (e as Error).message }); }
  });
accion("/onu/enable/:id", "activar");
accion("/onu/disable/:id", "desactivar");
accion("/onu/reboot/:id", "reiniciar");

smartolt.post("/onu/delete/:id", async (req, res) => {
  if (!getOnu(req.params.id)) return noExiste(res);
  try { await accionOnu(req.params.id, "eliminar", "api"); res.json({ status: true, response: "Done" }); }
  catch (e) { res.status(502).json({ status: false, error: (e as Error).message }); }
});

smartolt.post("/onu/set_wifi_port_lan/:id", async (req, res) => {
  const o = getOnu(req.params.id);
  if (!o) return noExiste(res);
  if (!wifiDisponible()) return res.status(501).json({ status: false, error: "WiFi no disponible: falta configurar GENIEACS_URL (TR-069)" });
  const { wifi_port, ssid, password } = req.body ?? {};
  const antena = /^wifi_0\/5$/.test(String(wifi_port)) ? 5 : 1;
  try {
    const dev = await idPorSerie(o.sn);
    if (!dev) return res.status(409).json({ status: false, error: "La ONU no está registrada en el ACS (TR-069)" });
    await cambiarWifi(dev, antena, String(ssid), String(password));
    res.json({ status: true, response: "Done" });
  } catch (e) { res.status(502).json({ status: false, error: (e as Error).message }); }
});
