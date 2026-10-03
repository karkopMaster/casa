// frontend/src/context/useMarca.ts
// Marca (nombre y logo) de la empresa actual, según el dominio. Se pide una sola vez y se comparte.
import { useEffect, useState } from "react";

export type Marca = { nombre: string; logoUrl: string | null };

let actual: Marca | null = null;
let pendiente: Promise<void> | null = null;
const oyentes = new Set<(m: Marca | null) => void>();

function aplicar(m: Marca | null) {
  actual = m;
  if (m?.nombre) document.title = m.nombre;
  // Si la empresa cambia su logo, los íconos de la pestaña se actualizan con ?v=
  const v = m?.logoUrl ? `?v=${encodeURIComponent(m.logoUrl.split("/").pop() ?? "")}` : "";
  document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((l) => {
    const base = l.href.split("?")[0];
    if (base.includes("/api/public/icono/")) l.href = base + v;
  });
  oyentes.forEach((f) => f(m));
}

export function refrescarMarca() {
  pendiente = fetch("/api/public/empresa", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => aplicar(d && typeof d.nombre === "string" ? { nombre: d.nombre, logoUrl: d.logoUrl ?? null } : null))
    .catch(() => aplicar(null))
    .finally(() => {
      pendiente = null;
    });
}

export function useMarca(): Marca | null {
  const [m, setM] = useState<Marca | null>(actual);
  useEffect(() => {
    oyentes.add(setM);
    if (!actual && !pendiente) refrescarMarca();
    return () => {
      oyentes.delete(setM);
    };
  }, []);
  return m;
}
