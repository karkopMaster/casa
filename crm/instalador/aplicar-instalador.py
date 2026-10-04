#!/usr/bin/env python3
"""Parcha backend/src/middleware/auth.ts para que los usuarios de tipo 'Instalador' solo accedan a las rutas permitidas.
Se detiene sin cambiar nada si el texto esperado no está exactamente una vez. Deja copia .pre-instalador."""
import shutil, sys
f = sys.argv[1]
s = open(f, encoding="utf-8").read()
if "esTipoInstalador" in s: sys.exit("auth.ts ya tiene la regla de Instalador.")
cambios = [
 ('import { resolveTenantClient, tenantContext } from "../lib/tenantDb";',
  'import { resolveTenantClient, tenantContext } from "../lib/tenantDb";\nimport { esTipoInstalador, rutaPermitidaInstalador } from "./instalador";'),
 ('select: { activo: true, tokenVersion: true, rol: true, empresaTenantId: true, empresaTenant: { select: { estado: true } } },',
  'select: { activo: true, tokenVersion: true, rol: true, empresaTenantId: true, empresaTenant: { select: { estado: true } }, tipoUsuario: { select: { nombre: true } } },'),
 ('    req.user = { ...payload, rol: usuario.rol, empresaTenantId: usuario.empresaTenantId };\n',
  '    req.user = { ...payload, rol: usuario.rol, empresaTenantId: usuario.empresaTenantId };\n\n'
  '    // Instalador: solo el registro de clientes. Lista de permitidos (todo lo demás, 403) y aplica sin importar el rol.\n'
  '    if (esTipoInstalador(usuario.tipoUsuario?.nombre) && !rutaPermitidaInstalador(req.method, req.originalUrl)) {\n'
  '      return res.status(403).json({ error: "No tienes permisos para esta acción" });\n'
  '    }\n'),
]
for viejo, _ in cambios:
    if s.count(viejo) != 1: sys.exit("ABORTO: no encontré (o aparece más de una vez) este texto en auth.ts:\n" + viejo)
shutil.copy2(f, f + ".pre-instalador")
for viejo, nuevo in cambios: s = s.replace(viejo, nuevo, 1)
open(f, "w", encoding="utf-8").write(s)
print("auth.ts actualizado. Copia: auth.ts.pre-instalador")
