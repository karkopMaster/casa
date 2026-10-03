#!/usr/bin/env python3
"""Solo si YA aplicaste aplicar.py (versión anterior): deja Morosos = Suspendidos = bloqueados en el router.
   cd /home/ubuntu/isp-crm/backend && sudo -u ubuntu python3 /tmp/casa/crm/dashboard-mikrotik/ajustar-morosos.py"""
import os, re, shutil, sys
f = os.path.join(os.getcwd(), "src/routes/dashboard.routes.ts")
if not os.path.exists(f): sys.exit("ABORTO: ejecútalo dentro de /home/ubuntu/isp-crm/backend")
s = open(f, encoding="utf-8").read()
if "morososFinal = suspendidosFinal;" in s: sys.exit("Ya ajustado.")
pat = re.compile(r"    // Morosos = con factura vencida[^\n]*\n    morososFinal = await prisma\.cliente\.count\(\{.*?\n    \}\);\n", re.S)
if len(pat.findall(s)) != 1: sys.exit("ABORTO: no encontré el bloque esperado (¿aplicaste la versión anterior?)")
shutil.copy2(f, f + ".pre-ajuste-morosos")
s = pat.sub("    // Moroso y suspendido son lo mismo: cliente bloqueado en el router\n    morososFinal = suspendidosFinal;\n", s, count=1)
open(f, "w", encoding="utf-8").write(s)
print("Ajustado. Copia: dashboard.routes.ts.pre-ajuste-morosos")
