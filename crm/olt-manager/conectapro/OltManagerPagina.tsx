// ConectaPro (frontend): página extra dentro del área OLT. Agrégala como ruta, p. ej. /olt/gestion, y un ítem en el menú de OLT.
// Ajusta `api` al cliente HTTP que ya usa el frontend (debe enviar el token de sesión).
import { useEffect, useState } from "react";

declare const api: { get: (url: string) => Promise<{ data: { url: string } }> };

export default function OltManagerPagina() {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.get("/api/olt-manager/enlace")
      .then((r) => setUrl(r.data.url))
      .catch((e) => setError(e?.response?.data?.error ?? "No se pudo abrir OLT Manager"));
  }, []);

  if (error) return <p style={{ padding: 16 }}>{error}</p>;
  if (!url) return <p style={{ padding: 16 }}>Abriendo OLT Manager…</p>;
  return <iframe title="OLT Manager" src={url} style={{ width: "100%", height: "calc(100vh - 120px)", border: 0 }} />;
}
