#!/usr/bin/env python3
"""Genera el video guía de la plataforma: diapositivas HTML -> PNG (Chromium) -> MP4 (ffmpeg), con subtítulos .srt y guion."""
import html, os, subprocess, sys, textwrap
OUT = os.path.dirname(os.path.abspath(__file__))
FR = os.path.join(OUT, "frames"); os.makedirs(FR, exist_ok=True)
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
DUR, TRANS = 8.0, 0.7

# (título, subtítulo, [puntos], narración)
S = [
 ("Guía rápida de la plataforma", "Clientes, contratos, facturación y red en un solo lugar",
  ["Panel para administrar un proveedor de internet", "Funciona desde el navegador, en el computador o el celular"],
  "Bienvenido. En este video vemos las funciones principales de la plataforma: clientes, contratos, facturación, cobranza, red y atención."),
 ("1. Inicio y Dashboard", "Lo primero que ves al entrar",
  ["Tarjetas: clientes, activos, morosos, tickets y técnicos en campo", "Morosos se calcula con lo que está bloqueado en el Mikrotik", "Un clic en Morosos abre la pantalla de morosos", "Pendientes del día: cobranza, facturas por enviar, routers sin conexión"],
  "Al iniciar sesión llegas al Dashboard, con las cifras clave. La tarjeta de morosos muestra los clientes bloqueados en el Mikrotik, y al hacer clic te lleva a la pantalla de morosos."),
 ("2. Clientes", "La ficha de cada cliente",
  ["Estados: activo, suspendido o retirado", "Datos, contratos, facturas e historial en un solo lugar", "Enlace de registro: el cliente llena sus propios datos", "El enlace se envía por WhatsApp y lleva el logo de tu empresa"],
  "En Clientes está la ficha completa: datos, contratos y facturas. Puedes enviar un enlace de registro para que el propio cliente llene su información."),
 ("3. Contratos", "El servicio contratado por el cliente",
  ["Plan, velocidad y tipo de conexión: IP o PPPoE", "Servidor Mikrotik al que pertenece", "Firma digital del contrato con enlace para el cliente", "Habilitado, deshabilitado o retirado"],
  "Cada contrato define el plan, el tipo de conexión y el servidor. El contrato se puede firmar de forma digital desde un enlace que recibe el cliente."),
 ("4. Facturación", "Facturas, pagos y ajustes",
  ["Facturación por grupos de corte, con numeración y prefijos", "Pagos, promesas de pago y notas crédito", "Factura en PDF con el logo y el fondo de tu empresa", "Auditoría de facturas y de DIAN"],
  "En Facturas se generan y se consultan las facturas, se registran los pagos y las promesas de pago, y se emiten notas crédito."),
 ("5. Cobranza y cortes", "Del vencimiento al corte, de forma ordenada",
  ["Corte automático todos los días a las 8:00", "Lista de morosos en el Mikrotik, revisada contra la base de datos", "Sacar del listado a quien ya pagó", "Avisos y recordatorios al cliente por WhatsApp"],
  "El sistema corta automáticamente cada día a las ocho de la mañana a quienes no pagaron, y se puede revisar y corregir la lista de morosos del router."),
 ("6. Red", "Mikrotik y OLT",
  ["Servidores Mikrotik y OLT registrados", "Sincronización automática cada hora", "Consumo y diagnóstico de cada cliente", "Aviso en el panel si un router pierde la conexión"],
  "En Servidores administras los Mikrotik y las OLT. La plataforma sincroniza con los routers cada hora y avisa si alguno deja de responder."),
 ("7. Atención al cliente", "Tickets, técnicos y solicitudes",
  ["Tickets con técnico asignado y seguimiento", "Ruta del técnico en campo", "Solicitudes que llegan desde la página web", "Claves de WiFi de los clientes"],
  "Atención reúne los tickets, la ruta del técnico y las solicitudes que llegan desde la página web."),
 ("8. CRM y mensajes", "Cartera, etiquetas y comunicación",
  ["Cartera e informe de cobranza", "Etiquetas automáticas para segmentar", "Avisos masivos con plantillas", "Chat de WhatsApp y mensajes rápidos"],
  "El CRM ayuda a gestionar la cartera, segmentar clientes con etiquetas y enviar avisos con plantillas por WhatsApp."),
 ("9. Contabilidad y administración", "El respaldo financiero del negocio",
  ["Contabilidad y plan de cuentas", "Compras, proveedores e inventario", "Bancos y medios de pago", "Nómina y empleados"],
  "La parte administrativa incluye contabilidad, compras, proveedores, inventario, bancos y nómina."),
 ("10. Auditoría", "Para revisar que todo cuadre",
  ["Auditoría de facturas y de DIAN", "Morosos: el cruce entre el Mikrotik y el sistema", "IPs autorizadas", "Registro de lo que se hace en la plataforma"],
  "Auditoría sirve para verificar que los datos coincidan, por ejemplo entre los morosos del router y las facturas."),
 ("11. Configuración de la empresa", "Tu marca en toda la plataforma",
  ["Datos de la empresa, prefijos y formato de factura", "Logo: aparece en el panel, en las facturas y en los enlaces del cliente", "Imagen de fondo para las páginas públicas", "Medios de pago digitales y mensajería"],
  "En Configuración de empresa defines tus datos, el logo y el fondo, que aparecen en el panel, en las facturas y en los enlaces que recibe el cliente."),
 ("12. Enlaces para el cliente", "Páginas públicas, sin que el cliente tenga usuario",
  ["Registro de datos", "Firma de contrato", "Pago y consulta de saldo", "Firma de radicados"],
  "Los clientes no necesitan usuario: reciben un enlace para registrarse, firmar el contrato, consultar su saldo o firmar un radicado."),
 ("Buenas prácticas", "Para sacarle el mejor provecho",
  ["Revisa los morosos y los pendientes al empezar el día", "Mantén al día la sincronización con los Mikrotik", "Haz respaldos de la base de datos con frecuencia", "Consulta cualquier duda con tu soporte"],
  "Para terminar: revisa cada día los pendientes y los morosos, mantén la red sincronizada y haz respaldos con frecuencia. Gracias por ver este video."),
]

CSS = """*{box-sizing:border-box;margin:0}body{width:1280px;height:720px;background:linear-gradient(135deg,#0b1d38,#12315a 60%,#1b4b82);color:#fff;font-family:'DejaVu Sans',Arial,sans-serif;overflow:hidden;position:relative}
.bar{position:absolute;left:0;top:0;bottom:0;width:14px;background:#2f9bff}.num{position:absolute;right:48px;top:36px;font-size:22px;color:#9fc3ee}
.wrap{position:absolute;left:90px;right:90px;top:90px}h1{font-size:54px;line-height:1.15;margin-bottom:10px}h2{font-size:26px;font-weight:400;color:#9fc3ee;margin-bottom:44px}
ul{list-style:none}li{font-size:30px;line-height:1.35;margin:0 0 20px;padding-left:44px;position:relative}li:before{content:'';position:absolute;left:0;top:13px;width:16px;height:16px;border-radius:50%;background:#2f9bff}
.sub{position:absolute;left:90px;right:90px;bottom:46px;font-size:22px;color:#cfe0f5;line-height:1.4;border-top:1px solid rgba(255,255,255,.2);padding-top:16px}"""
def pagina(i, t, st, pts, narr):
    lis = "".join(f"<li>{html.escape(p)}</li>" for p in pts)
    return f"<!doctype html><meta charset=utf-8><style>{CSS}</style><body><div class=bar></div><div class=num>{i+1}/{len(S)}</div><div class=wrap><h1>{html.escape(t)}</h1><h2>{html.escape(st)}</h2><ul>{lis}</ul></div><div class=sub>{html.escape(narr)}</div></body>"

png = []
for i, (t, st, pts, narr) in enumerate(S):
    h = os.path.join(FR, f"s{i:02d}.html"); p = os.path.join(FR, f"s{i:02d}.png")
    open(h, "w", encoding="utf-8").write(pagina(i, t, st, pts, narr))
    subprocess.run([CHROME, "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", f"--screenshot={p}", "--window-size=1280,830", f"file://{h}"], check=True, capture_output=True)
    c = p.replace(".png", "_c.png")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", p, "-vf", "crop=1280:720:0:0", c], check=True)  # el navegador deja barras: se recorta a 1280x720
    png.append(c)

# MP4 con transiciones suaves (xfade)
n = len(png)
cmd = ["ffmpeg", "-y", "-loglevel", "error"]
for p in png: cmd += ["-loop", "1", "-t", str(DUR + TRANS), "-i", p]
fc, prev = [], "[0:v]"
for k in range(1, n):
    out = f"[v{k}]"
    fc.append(f"{prev}[{k}:v]xfade=transition=fade:duration={TRANS}:offset={k*DUR - TRANS + 0:.2f}{out}")
    prev = out
fc.append(f"{prev}format=yuv420p[vf]")
mp4 = os.path.join(OUT, "guia-plataforma.mp4")
cmd += ["-filter_complex", ";".join(fc), "-map", "[vf]", "-r", "25", "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-movflags", "+faststart", mp4]
subprocess.run(cmd, check=True)

# Subtítulos y guion
def ts(s):
    h, m, sec = int(s // 3600), int(s % 3600 // 60), s % 60
    return f"{h:02d}:{m:02d}:{int(sec):02d},{int(round((sec % 1) * 1000)):03d}"
srt = []
for i, (_, _, _, narr) in enumerate(S):
    a, b = i * DUR, (i + 1) * DUR - 0.2
    srt.append(f"{i+1}\n{ts(a)} --> {ts(b)}\n" + "\n".join(textwrap.wrap(narr, 70)) + "\n")
open(os.path.join(OUT, "guia-plataforma.srt"), "w", encoding="utf-8").write("\n".join(srt))
open(os.path.join(OUT, "guion.md"), "w", encoding="utf-8").write("# Guion de narración\n\n" + "\n\n".join(f"## {i+1}. {t}\n{narr}" for i, (t, _, _, narr) in enumerate(S)) + "\n")
print("OK", mp4, f"{n} diapositivas, {n*DUR:.0f} s")
