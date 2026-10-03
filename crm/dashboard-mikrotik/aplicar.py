#!/usr/bin/env python3
"""Ejecutar EN EL VPS como ubuntu, dentro de /home/ubuntu/isp-crm/backend:
   sudo -u ubuntu python3 /tmp/casa/crm/dashboard-mikrotik/aplicar.py
Copia el servicio nuevo y parchea backend/src/routes/dashboard.routes.ts. Se detiene sin cambiar nada si no
encuentra los textos esperados. Guarda dashboard.routes.ts.pre-mikrotik como copia."""
import os, shutil, sys
AQUI = os.path.dirname(os.path.abspath(__file__))
R = os.getcwd()
f = os.path.join(R, "src/routes/dashboard.routes.ts")
if not os.path.exists(f): sys.exit("ABORTO: ejecútalo dentro de /home/ubuntu/isp-crm/backend")
s = open(f, encoding="utf-8").read()
if "dashboardMikrotik" in s: sys.exit("Ya aplicado.")

A_IMPORT = 'import { Router } from "express";'
A_PCT = "  const pctMesAnterior = facturadoAnterior > 0 ? Math.round((pagadoAnterior / facturadoAnterior) * 100) : 0;\n"
A_CLI = "    clientes: { total: clientesTotal, activos: clientesActivos, morosos: clientesMorosos, suspendidos: clientesSuspendidos },\n"
for a in (A_IMPORT, A_PCT, A_CLI):
    if s.count(a) != 1: sys.exit("ABORTO: no encontré (o hay más de una vez) esta línea:\n" + a)

BLOQUE = '''
  // Morosos/Suspendidos reales según los Mikrotik (solo lectura). Si algún router no responde, se usan los datos de la base de datos.
  const estadoRouter = await estadoRouters(where).catch(() => null);
  let morososFinal = clientesMorosos;
  let suspendidosFinal = clientesSuspendidos;
  let fuenteCortes: "mikrotik" | "base_de_datos" = "base_de_datos";
  if (estadoRouter && estadoRouter.completo) {
    suspendidosFinal = estadoRouter.cortadosClienteIds.length;
    // Morosos = con factura vencida que TODAVÍA no están cortados en el router
    morososFinal = await prisma.cliente.count({
      where: {
        ...where,
        facturas: { some: { estado: { in: ["PENDIENTE", "VENCIDA"] }, fechaVencimiento: { lt: new Date() } } },
        ...(estadoRouter.cortadosClienteIds.length > 0 ? { id: { notIn: estadoRouter.cortadosClienteIds } } : {}),
      },
    });
    fuenteCortes = "mikrotik";
  }
'''
NUEVO_CLI = '''    clientes: {
      total: clientesTotal,
      activos: clientesActivos,
      morosos: morososFinal,
      suspendidos: suspendidosFinal,
      fuente: fuenteCortes,
      bd: { morosos: clientesMorosos, suspendidos: clientesSuspendidos },
      routersSinRespuesta: estadoRouter?.sinRespuesta ?? 0,
      discrepancias: estadoRouter
        ? { cortadosConFacturaPagada: estadoRouter.cortadosPagados, deshabilitadosSinBloqueo: estadoRouter.deshabilitadosSinBloqueo }
        : null,
    },
'''
shutil.copy2(f, f + ".pre-mikrotik")
s = s.replace(A_IMPORT, A_IMPORT + '\nimport { estadoRouters } from "../services/dashboardMikrotik";', 1)
s = s.replace(A_PCT, A_PCT + BLOQUE, 1)
s = s.replace(A_CLI, NUEVO_CLI, 1)
open(f, "w", encoding="utf-8").write(s)
shutil.copy2(os.path.join(AQUI, "dashboardMikrotik.ts"), os.path.join(R, "src/services/dashboardMikrotik.ts"))
print("Aplicado. Copia: dashboard.routes.ts.pre-mikrotik. Siguiente: npx tsc -p tsconfig.json --noEmit")
