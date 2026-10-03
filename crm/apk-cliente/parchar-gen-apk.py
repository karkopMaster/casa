#!/usr/bin/env python3
"""Añade a gen-apk.sh un 5.º parámetro opcional TIPO ("admin" por defecto o "cliente").
   - cliente: abre https://HOST/cliente/, usa el paquete co.redcien.cliente y guarda <slug>-cliente.apk
   No toca la línea de la firma (contraseña). Se detiene sin cambiar nada si algún texto esperado no está.
   Uso: python3 parchar-gen-apk.py /home/ubuntu/isp-crm/apkbase/gen-apk.sh"""
import shutil, sys
f = sys.argv[1]
s = open(f, encoding="utf-8").read()
if 'TIPO="${5:-admin}"' in s: sys.exit("gen-apk.sh ya tiene el parámetro TIPO.")
cambios = [
 ('SLUG="$1"; HOST="$2"; NOMBRE="$3"; LOGO="$4"', 'SLUG="$1"; HOST="$2"; NOMBRE="$3"; LOGO="$4"; TIPO="${5:-admin}"\n[[ "$TIPO" =~ ^(admin|cliente)$ ]] || exit 2'),
 ('python3 - "$NOMBRE" "$A/manifest.tpl.xml" "$W/AndroidManifest.xml" <<\'PY\'', 'python3 - "$NOMBRE" "$A/manifest.tpl.xml" "$W/AndroidManifest.xml" "$TIPO" <<\'PY\''),
 ("s=open(sys.argv[2]).read().replace('\"@@LABEL@@\"',quoteattr(n))",
  "s=open(sys.argv[2]).read().replace('\"@@LABEL@@\"',quoteattr(n))\nif sys.argv[4]=='cliente':\n    # otro identificador de app (se puede instalar junto a la de administración); la clase sigue en el paquete original\n    s=s.replace('package=\"co.redcien.admin\"','package=\"co.redcien.cliente\"').replace('android:name=\".MainActivity\"','android:name=\"co.redcien.admin.MainActivity\"')"),
 ("printf 'https://%s' \"$HOST\" > \"$W/app/assets/url.txt\"", "if [ \"$TIPO\" = cliente ]; then printf 'https://%s/cliente/' \"$HOST\" > \"$W/app/assets/url.txt\"; else printf 'https://%s' \"$HOST\" > \"$W/app/assets/url.txt\"; fi"),
 ('mv "$W/signed.apk" "$OUT/$SLUG.apk"', 'DEST="$SLUG"; [ "$TIPO" = cliente ] && DEST="$SLUG-cliente"\nmv "$W/signed.apk" "$OUT/$DEST.apk"'),
]
for viejo, _ in cambios:
    if s.count(viejo) != 1: sys.exit("ABORTO: no encontré (o aparece más de una vez) este texto en gen-apk.sh:\n" + viejo)
shutil.copy2(f, f + ".pre-cliente")
for viejo, nuevo in cambios: s = s.replace(viejo, nuevo, 1)
s = s.replace("# Uso: gen-apk.sh <slug> <host> <nombre> [ruta_logo]", "# Uso: gen-apk.sh <slug> <host> <nombre> [ruta_logo] [admin|cliente]")
open(f, "w", encoding="utf-8").write(s)
print("gen-apk.sh actualizado. Copia: gen-apk.sh.pre-cliente")
