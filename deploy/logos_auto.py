#!/usr/bin/env python3
"""Ejecutar EN EL VPS. Busca el logo de cada ente en su página oficial (og:image o <img> con 'logo')
y lo guarda en <WEBROOT>/img/regulatorios/<nombre>.png (se convierte a PNG si hace falta).
Uso: WEBROOT=/ruta/internet python3 deploy/logos_auto.py
"""
import os, re, sys, urllib.request, urllib.parse, io, subprocess
W = os.environ.get("WEBROOT")
if not W: sys.exit("Define WEBROOT")
D = os.path.join(W, "img", "regulatorios"); os.makedirs(D, exist_ok=True)
SITES = {"crc": "https://www.crcom.gov.co/", "sic": "https://www.sic.gov.co/",
         "teprotejo": "https://teprotejo.org/", "fiscalia": "https://www.fiscalia.gov.co/"}
UA = {"User-Agent": "Mozilla/5.0"}
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=25).read()
def candidates(base, html):
    c = []
    for m in re.finditer(r'<meta[^>]+(?:og:image|twitter:image)[^>]*content=["\']([^"\']+)', html, re.I): c.append(m.group(1))
    for m in re.finditer(r'<img[^>]+src=["\']([^"\']*logo[^"\']*)', html, re.I): c.append(m.group(1))
    for m in re.finditer(r'<link[^>]+rel=["\'](?:apple-touch-icon|icon)["\'][^>]*href=["\']([^"\']+)', html, re.I): c.append(m.group(1))
    return [urllib.parse.urljoin(base, x) for x in c]
for name, url in SITES.items():
    ok = False
    try:
        html = get(url).decode("utf-8", "ignore")
        for u in candidates(url, html)[:8]:
            try:
                data = get(u)
                if len(data) < 800: continue
                out = os.path.join(D, name + ".png")
                if data[:8] == b"\x89PNG\r\n\x1a\n":
                    open(out, "wb").write(data)
                else:
                    tmp = os.path.join(D, name + ".src"); open(tmp, "wb").write(data)
                    r = subprocess.run(["convert", tmp, out], capture_output=True)
                    os.remove(tmp)
                    if r.returncode != 0: continue
                print("OK   ", name, "<-", u); ok = True; break
            except Exception as e:
                continue
    except Exception as e:
        print("ERROR", name, e)
    if not ok: print("FALLO", name, "(sube el archivo a mano)")
os.system("chown -R ubuntu:ubuntu '%s' 2>/dev/null; chmod -R a+rX '%s'" % (D, D))
os.system("ls -la '%s'" % D)
