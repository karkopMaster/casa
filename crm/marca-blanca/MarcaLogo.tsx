// frontend/src/components/MarcaLogo.tsx
// Logo y nombre de la empresa del usuario (reemplaza el "ISP / ISP CRM" fijo).
import { useMarca } from "../context/useMarca";

export default function MarcaLogo({ alto = 38, mostrarNombre = true }: { alto?: number; mostrarNombre?: boolean }) {
  const marca = useMarca();
  const nombre = marca?.nombre || "ISP CRM";
  if (marca?.logoUrl) {
    return (
      <>
        <img src={marca.logoUrl} alt={nombre} style={{ maxHeight: alto, maxWidth: 150, objectFit: "contain", display: "block" }} />
        {mostrarNombre && !/logo/i.test(marca.logoUrl) ? null : null}
      </>
    );
  }
  const iniciales = nombre.split(/\s+/).map((p) => p[0]).join("").slice(0, 3).toUpperCase() || "ISP";
  return (
    <>
      <div className="brand-mark">{iniciales}</div>
      {mostrarNombre && <span>{nombre}</span>}
    </>
  );
}
