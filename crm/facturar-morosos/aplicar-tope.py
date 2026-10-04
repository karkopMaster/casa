#!/usr/bin/env python3
"""Facturar morosos con tope: en generarFacturasDeGrupo (billing.ts), si el interruptor
'contratos.facturarMorososConTope' está en true, un contrato se factura aunque tenga hasta
TOPE_FACTURAS_ABIERTAS (=1) factura(s) abierta(s) de meses anteriores. Con 2 o más, se salta.
Sin el interruptor todo funciona exactamente como antes. No cambia la regla de 'una factura por contrato por mes'."""
import shutil, sys
f = sys.argv[1]
s = open(f, encoding="utf-8").read()
if "TOPE_FACTURAS_ABIERTAS" in s: sys.exit("billing.ts ya tiene el tope de facturas abiertas.")
viejo = '''    if (flags["contratos.facturacionConAbiertas"] !== true) {
      const facturaAbierta = await prisma.factura.findFirst({
        where: { contratoId: contrato.id, estado: { in: ["PENDIENTE", "VENCIDA"] }, fechaEmision: { lt: desdeMes } },
      });
      if (facturaAbierta) continue;
    }'''
nuevo = '''    if (flags["contratos.facturacionConAbiertas"] !== true) {
      const tope = flags["contratos.facturarMorososConTope"] === true ? TOPE_FACTURAS_ABIERTAS : 0;
      const abiertas = await prisma.factura.count({
        where: { contratoId: contrato.id, estado: { in: ["PENDIENTE", "VENCIDA"] }, fechaEmision: { lt: desdeMes } },
      });
      if (abiertas > tope) continue;
    }'''
ancla = '''/**
 * Con `diaManual`, factura los contratos'''
const = '''/** Con 'contratos.facturarMorososConTope' encendido, se sigue facturando a quien tenga hasta esta cantidad de facturas abiertas anteriores. */
const TOPE_FACTURAS_ABIERTAS = 1;

'''
for t in (viejo, ancla):
    if s.count(t) != 1: sys.exit("ABORTO: no encontré (o aparece más de una vez) este texto en billing.ts:\n" + t[:120])
shutil.copy2(f, f + ".pre-tope")
s = s.replace(viejo, nuevo).replace(ancla, const + ancla)
open(f, "w", encoding="utf-8").write(s)
print("Listo. Copia de seguridad: " + f + ".pre-tope")
