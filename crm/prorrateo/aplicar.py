#!/usr/bin/env python3
"""Corrige calcularMontoProrrateado en backend/src/services/billing.ts.
Regla: mes comercial de 30 días; se cobran los días de consumo desde la fecha de instalación hasta el día 30
(el día de instalación SÍ cuenta). Instalar el 15 con plan de 60.000 -> 16 días -> 32.000.
Se detiene sin tocar nada si el texto esperado no está exactamente una vez."""
import shutil, sys
f = sys.argv[1]
s = open(f, encoding="utf-8").read()
if "DIAS_MES_COMERCIAL" in s: sys.exit("billing.ts ya tiene la regla de 30 días comerciales.")
viejo = '''export function calcularMontoProrrateado(precioMensual: number, fechaInicio: Date, fechaCorte: Date): number {
  const MS_POR_DIA = 24 * 60 * 60 * 1000;
  const dias = Math.max(1, Math.round((fechaCorte.getTime() - fechaInicio.getTime()) / MS_POR_DIA));
  return Math.round((precioMensual * Math.min(dias, 30)) / 30);
}'''
nuevo = '''const DIAS_MES_COMERCIAL = 30;
const CUENTA_DIA_INSTALACION = true; // true: instalar el 15 cobra del 15 al 30 (16 días); false: del 16 al 30 (15 días)

/**
 * Prorrateo del primer mes con mes comercial de 30 días: se cobran los días de consumo desde la fecha de
 * instalación hasta el día 30. La fecha de corte/vencimiento de la factura no cambia el valor (solo cuándo se paga).
 * `_fechaCorte` se conserva por compatibilidad con quienes llaman a esta función.
 */
export function calcularMontoProrrateado(precioMensual: number, fechaInicio: Date, _fechaCorte?: Date): number {
  const dia = Math.min(Math.max(fechaInicio.getDate(), 1), DIAS_MES_COMERCIAL);
  const dias = Math.min(DIAS_MES_COMERCIAL, Math.max(1, DIAS_MES_COMERCIAL - dia + (CUENTA_DIA_INSTALACION ? 1 : 0)));
  return Math.round((precioMensual * dias) / DIAS_MES_COMERCIAL);
}'''
if s.count(viejo) != 1: sys.exit("ABORTO: no encontré calcularMontoProrrateado tal como se esperaba (o aparece más de una vez).")
shutil.copy2(f, f + ".pre-prorrateo")
open(f, "w", encoding="utf-8").write(s.replace(viejo, nuevo))
print("Listo. Copia de seguridad: " + f + ".pre-prorrateo")
