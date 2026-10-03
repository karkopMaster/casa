#!/usr/bin/env python3
"""Ejecutar EN EL VPS, dentro de /home/ubuntu/isp-crm:  python3 /ruta/aplicar.py
Copia los archivos nuevos y parchea 3 archivos existentes (hace copia .pre-marca de cada uno).
Se detiene SIN cambiar nada si algún texto esperado no se encuentra."""
import os, re, shutil, sys
AQUI = os.path.dirname(os.path.abspath(__file__))
R = os.getcwd()
def leer(p): return open(os.path.join(R, p), encoding="utf-8").read()
def escribir(p, s): open(os.path.join(R, p), "w", encoding="utf-8").write(s)

layout = leer("frontend/src/components/Layout.tsx")
marca_fija = re.compile(r'<div className="brand-mark">ISP</div>\s*<span>ISP CRM</span>')
if len(marca_fija.findall(layout)) < 1: sys.exit("ABORTO: Layout.tsx no tiene el bloque ISP/ISP CRM esperado")
index = leer("frontend/index.html")
if "</head>" not in index: sys.exit("ABORTO: index.html sin </head>")
back = leer("backend/src/index.ts")
if 'app.use("/api/public", publicRoutes);' not in back: sys.exit("ABORTO: index.ts sin app.use publicRoutes")
if 'import publicRoutes from "./routes/public.routes";' not in back: sys.exit("ABORTO: index.ts sin import publicRoutes")

for p in ["frontend/src/components/Layout.tsx", "frontend/index.html", "backend/src/index.ts"]:
    shutil.copy2(os.path.join(R, p), os.path.join(R, p + ".pre-marca"))
shutil.copy2(os.path.join(AQUI, "marca.routes.ts"), os.path.join(R, "backend/src/routes/marca.routes.ts"))
shutil.copy2(os.path.join(AQUI, "useMarca.ts"), os.path.join(R, "frontend/src/context/useMarca.ts"))
shutil.copy2(os.path.join(AQUI, "MarcaLogo.tsx"), os.path.join(R, "frontend/src/components/MarcaLogo.tsx"))

layout = marca_fija.sub("<MarcaLogo />", layout)
if "MarcaLogo\"" not in layout:
    layout = re.sub(r'^(import )', 'import MarcaLogo from "./MarcaLogo";\n\\1', layout, count=1, flags=re.M)
escribir("frontend/src/components/Layout.tsx", layout)

links = '''    <link rel="icon" type="image/png" sizes="32x32" href="/api/public/icono/32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="/api/public/icono/16.png" />
    <link rel="apple-touch-icon" href="/api/public/icono/180.png" />
    <link rel="manifest" href="/api/public/manifest.webmanifest" />
    <meta name="theme-color" content="#ffffff" />
'''
if "icono/32.png" not in index: index = index.replace("</head>", links + "  </head>", 1)
escribir("frontend/index.html", index)

if "marca.routes" not in back:
    back = back.replace('import publicRoutes from "./routes/public.routes";', 'import publicRoutes from "./routes/public.routes";\nimport marcaRoutes from "./routes/marca.routes";', 1)
    back = back.replace('app.use("/api/public", publicRoutes);', 'app.use("/api/public", marcaRoutes);\napp.use("/api/public", publicRoutes);', 1)
escribir("backend/src/index.ts", back)
print("Listo. Copias .pre-marca creadas. Siguiente: cd backend && npm i sharp && compilar; luego frontend.")
