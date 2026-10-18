// WiFi de la ONU: por OMCI no se puede; hace falta TR-069. SmartOLT trae su propio ACS; aquí se usa GenieACS (libre) aparte.
// Opcional: sin GENIEACS_URL el endpoint set_wifi_port_lan responde que no está disponible.
import { config } from "./config";

export const wifiDisponible = () => !!config.genieacsUrl;

async function nbi(ruta: string, init?: RequestInit) {
  const r = await fetch(config.genieacsUrl.replace(/\/+$/, "") + ruta, { ...init, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`GenieACS ${r.status}`);
  return r;
}

/** Busca el dispositivo por número de serie (VirtualParameters/DeviceID.SerialNumber). */
export async function idPorSerie(sn: string): Promise<string | null> {
  const q = encodeURIComponent(JSON.stringify({ "DeviceID.SerialNumber": sn }));
  const lista = (await (await nbi(`/devices/?query=${q}&projection=_id`)).json()) as { _id: string }[];
  return lista[0]?._id ?? null;
}

/** Cambia SSID y clave WPA2 de la antena 1 (2.4 GHz) o 5 (5 GHz). Modelo de datos TR-098 (InternetGatewayDevice). */
export async function cambiarWifi(deviceId: string, antena: number, ssid: string, clave: string) {
  const base = `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${antena}`;
  const cuerpo = {
    name: "setParameterValues",
    parameterValues: [[`${base}.SSID`, ssid, "xsd:string"], [`${base}.PreSharedKey.1.KeyPassphrase`, clave, "xsd:string"]],
  };
  await nbi(`/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`, { method: "POST", body: JSON.stringify(cuerpo) });
}
