// Usuarios de tipo "Instalador": solo pueden usar el registro de clientes. Todo lo demás se rechaza (403),
// sin importar el rol que tengan. Es una lista de permitidos: lo que no está aquí NO se puede hacer.
// El tipo se toma SIEMPRE de la base de datos (no del token), igual que el rol.

export const TIPO_INSTALADOR = "instalador";

export function esTipoInstalador(nombreTipo: string | null | undefined): boolean {
  return String(nombreTipo ?? "").trim().toLowerCase() === TIPO_INSTALADOR;
}

// [método, ruta exacta]
const PERMITIDAS: Array<[string, string]> = [
  ["GET", "/api/auth/me"],
  ["POST", "/api/clientes/link-registro"], // generar/obtener el enlace de registro de la empresa
  ["POST", "/api/clientes"], // registrar un cliente nuevo
];
// Prefijos completos permitidos (cualquier método): solo la sesión del propio usuario (cambiar clave, cerrar sesión, 2FA).
const PREFIJOS_PERMITIDOS = ["/api/auth/"];

export function rutaPermitidaInstalador(metodo: string, urlOriginal: string): boolean {
  let ruta: string;
  try {
    ruta = decodeURIComponent(urlOriginal.split("?")[0].split("#")[0]);
  } catch {
    return false;
  }
  if (ruta.includes("..") || ruta.includes("//") || ruta.includes("\\") || ruta.includes("\0")) return false;
  ruta = ruta.replace(/\/+$/, "").toLowerCase() || "/";
  const m = metodo.toUpperCase();
  if (PERMITIDAS.some(([pm, pr]) => pm === m && pr === ruta)) return true;
  // /api/auth/login y similares no llegan aquí (son públicas); /api/auth/* con sesión es para la cuenta propia.
  return PREFIJOS_PERMITIDOS.some((p) => ruta.startsWith(p));
}
