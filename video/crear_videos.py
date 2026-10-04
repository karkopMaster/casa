#!/usr/bin/env python3
"""Crea dos videos CON VOZ (español):
  1) cliente-como-usar-app.mp4  -> cómo usa la app el cliente (pantallas reales del portal, con datos de ejemplo)
  2) admin-como-usar-plataforma.mp4 -> cómo se usa la plataforma de administración (incluye lo nuevo)
Voz: Piper es_MX-claude-high (sherpa-onnx). Imágenes: Chromium headless. Montaje: ffmpeg.
Uso: python3 crear_videos.py [cliente|admin|todo]
Requiere: pip install sherpa-onnx numpy ; modelo en $MODELO_VOZ ; chromium; ffmpeg"""
import html, os, re, subprocess, sys, textwrap, wave
import numpy as np, sherpa_onnx

AQUI = os.path.dirname(os.path.abspath(__file__))
PORTAL = os.path.join(AQUI, "..", "portal-cliente", "index.html")
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
MODELO = os.environ.get("MODELO_VOZ", "/tmp/claude-0/t/vits-piper-es_MX-claude-high") + "/"
TMP = os.path.join(AQUI, "_tmp"); os.makedirs(TMP, exist_ok=True)
PAUSA = 0.9  # segundos de aire al final de cada diapositiva

# ---------- voz ----------
_tts = None
def tts():
    global _tts
    if _tts is None:
        cfg = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(vits=sherpa_onnx.OfflineTtsVitsModelConfig(
            model=MODELO + "es_MX-claude-high.onnx", tokens=MODELO + "tokens.txt", data_dir=MODELO + "espeak-ng-data", length_scale=1.05), num_threads=4))
        _tts = sherpa_onnx.OfflineTts(cfg)
    return _tts

PRON = [  # cómo se dice en voz (solo para el audio; en pantalla se escribe normal)
    (r"\bWiFi\b", "Wai Fai"), (r"\bwifi\b", "wai fai"), (r"\bRedCien\b", "Red Cien"), (r"\bSmartOLT\b", "SmartOLT"),
    (r"\bMikroTik\b|\bMikrotik\b", "Mikrotik"), (r"\bOLT\b", "O ele te"), (r"\bONU\b", "O nu"), (r"\bAPK\b", "a pe ká"),
    (r"\bPQR\b", "pe cu erre"), (r"\bCRM\b", "ce erre eme"), (r"\bPDF\b", "pe de efe"), (r"\bNequi\b", "Nékui"), (r"\bPPPoE\b", "pe pe pe o i"),
    (r"\bIP\b", "i pe"), (r"\bDIAN\b", "Dian"), (r"\bTR-?069\b", "te erre cero seis nueve"), (r"\bGHz\b", "gigahercios"),
]
def para_voz(t):
    for a, b in PRON: t = re.sub(a, b, t)
    return t.replace("$", " pesos ").replace("%", " por ciento")

def hablar(texto, ruta):
    a = tts().generate(para_voz(texto), sid=0, speed=1.0)
    s = np.clip(np.array(a.samples), -1, 1)
    s = np.concatenate([s, np.zeros(int(a.sample_rate * PAUSA))])
    with wave.open(ruta, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(a.sample_rate); w.writeframes((s * 32767).astype(np.int16).tobytes())
    return len(s) / a.sample_rate

# ---------- pantallas del portal ----------
def variantes_portal():
    src = open(PORTAL, encoding="utf-8").read().replace("Mi proveedor de internet", "RedCien")
    ahora = "new Date().toISOString()"; viejo = "new Date(Date.now()-30*864e5).toISOString()"
    # En el DEMO las promos usan {t,d,f,r}; se arma con ese formato
    s0 = src.replace('promos:[], wifi:', 'promos:[{t:"Feliz Halloween 🎃",d:"Esta semana tu amigo se conecta con nosotros y ambos ganan un descuento. ¡Pregúntanos!",f:"31/10/2026",r:@@R@@}], wifi:')
    def mk2(nombre, r, extra=""):
        s = s0.replace('@@R@@', r)
        if extra: s = s.replace("</body>", "<script>" + extra + "</script></body>")
        p = os.path.join(TMP, nombre); open(p, "w", encoding="utf-8").write(s); return p
    return {
        "normal": mk2("p_normal.html", viejo),
        "aviso": mk2("p_aviso.html", ahora),
        "codigo": mk2("p_codigo.html", viejo, 'login(2,"1193085115","");'),
    }

CSS = """*{box-sizing:border-box;margin:0}body{width:1280px;height:720px;background:linear-gradient(135deg,#0b3d2e,#146c43 60%,#1f9d62);color:#fff;font-family:'DejaVu Sans',Arial,sans-serif;overflow:hidden;position:relative}
.num{position:absolute;right:40px;top:28px;font-size:20px;color:#bfe9d2}.tel{position:absolute;left:110px;top:26px;width:340px;height:672px;border-radius:44px;background:#0a0a0a;padding:12px;box-shadow:0 20px 60px rgba(0,0,0,.45)}
.tel .pantalla{width:316px;height:648px;border-radius:32px;overflow:hidden;background:#fff;position:relative}
.tel iframe{border:0;width:395px;height:810px;transform:scale(.8);transform-origin:0 0;background:#fff}
.txt{position:absolute;left:530px;right:70px;top:70px}.txt .paso{font-size:22px;color:#bfe9d2;margin-bottom:10px}.txt h1{font-size:50px;line-height:1.15;margin-bottom:34px}
.txt li{list-style:none;font-size:27px;line-height:1.35;margin:0 0 18px;padding-left:40px;position:relative}.txt li:before{content:'';position:absolute;left:0;top:11px;width:15px;height:15px;border-radius:50%;background:#6ee7a8}
.sub{position:absolute;left:530px;right:60px;bottom:34px;font-size:19px;color:#d6f1e2;line-height:1.4;border-top:1px solid rgba(255,255,255,.25);padding-top:12px}"""
CSS_ADMIN = """*{box-sizing:border-box;margin:0}body{width:1280px;height:720px;background:linear-gradient(135deg,#0b1d38,#12315a 60%,#1b4b82);color:#fff;font-family:'DejaVu Sans',Arial,sans-serif;overflow:hidden;position:relative}
.bar{position:absolute;left:0;top:0;bottom:0;width:14px;background:#2f9bff}.num{position:absolute;right:48px;top:36px;font-size:22px;color:#9fc3ee}
.wrap{position:absolute;left:90px;right:90px;top:84px}.paso{font-size:22px;color:#9fc3ee;margin-bottom:8px}h1{font-size:52px;line-height:1.15;margin-bottom:30px}
li{list-style:none;font-size:29px;line-height:1.35;margin:0 0 18px;padding-left:44px;position:relative}li:before{content:'';position:absolute;left:0;top:13px;width:16px;height:16px;border-radius:50%;background:#2f9bff}
.sub{position:absolute;left:90px;right:90px;bottom:40px;font-size:20px;color:#cfe0f5;line-height:1.4;border-top:1px solid rgba(255,255,255,.2);padding-top:14px}"""

def foto(html_txt, destino):
    h = destino.replace(".png", ".html"); open(h, "w", encoding="utf-8").write(html_txt)
    bruto = destino.replace(".png", "_b.png")
    subprocess.run([CHROME, "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
                    "--virtual-time-budget=4000", f"--screenshot={bruto}", "--window-size=1280,830", f"file://{h}"], check=True, capture_output=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", bruto, "-vf", "crop=1280:720:0:0", destino], check=True)

def slide_cliente(i, n, v, ruta, titulo, puntos, narr):
    iframe = f"file://{v}#{ruta}" if ruta else f"file://{v}"
    lis = "".join(f"<li>{html.escape(p)}</li>" for p in puntos)
    return (f"<!doctype html><meta charset=utf-8><style>{CSS}</style><body><div class=num>{i}/{n}</div>"
            f"<div class=tel><div class=pantalla><iframe src='{iframe}'></iframe></div></div>"
            f"<div class=txt><div class=paso>Paso {i} de {n}</div><h1>{html.escape(titulo)}</h1><ul>{lis}</ul></div>"
            f"<div class=sub>{html.escape(narr)}</div></body>")

def slide_admin(i, n, titulo, puntos, narr):
    lis = "".join(f"<li>{html.escape(p)}</li>" for p in puntos)
    return (f"<!doctype html><meta charset=utf-8><style>{CSS_ADMIN}</style><body><div class=bar></div><div class=num>{i}/{n}</div>"
            f"<div class=wrap><div class=paso>Cómo se usa · {i} de {n}</div><h1>{html.escape(titulo)}</h1><ul>{lis}</ul></div><div class=sub>{html.escape(narr)}</div></body>")

# ---------- guiones ----------
# (variante, ruta, título, [puntos], narración)
CLIENTE = [
 ("normal", "login", "Descarga e ingresa", ["Descarga la app desde el enlace que te enviamos por WhatsApp", "Instálala y ábrela", "Escribe tu número de documento y toca Continuar"],
  "Bienvenido a la app de RedCien. Para empezar, descarga la aplicación desde el enlace que te enviamos por WhatsApp e instálala. Si el celular te lo pide, permite instalar aplicaciones de esta fuente. Al abrirla, escribe tu número de documento y toca continuar."),
 ("codigo", None, "Tu código por WhatsApp", ["Te llega un código de 6 números", "Escríbelo en la app", "Dura 5 minutos: no lo compartas"],
  "Enseguida te llegará un código de seis números por WhatsApp, al número que tenemos registrado. Escríbelo en la app. El código dura cinco minutos y es solo para ti, no lo compartas con nadie."),
 ("normal", "inicio", "Tu pantalla de inicio", ["Tu plan y su estado", "Si estás al día o tienes saldo pendiente", "Accesos rápidos a todo"],
  "Esta es tu pantalla de inicio. Arriba ves tu plan y si está activo. Más abajo, si estás al día o si tienes un saldo pendiente. Y en accesos rápidos tienes todo lo que necesitas, a un toque."),
 ("normal", "facturas", "Tus facturas", ["Historial de facturas", "Pagada o pendiente", "Valor y fecha de vencimiento"],
  "En facturas encuentras tu historial. Cada una muestra su valor, la fecha de vencimiento y si ya está pagada o sigue pendiente."),
 ("normal", "pagar", "Cómo pagar", ["Toca Realizar pago", "Elige el medio: Nequi, transferencia u otro", "Envía el comprobante por WhatsApp"],
  "Para pagar, toca realizar pago. Verás el valor y los medios de pago de la empresa, como Nequi o transferencia. Haz tu pago y envíanos el comprobante por WhatsApp, para que quede registrado enseguida."),
 ("normal", "velocidad", "Test de velocidad", ["Conéctate por WiFi cerca del router", "Cierra otras descargas", "Toca Iniciar prueba"],
  "Si crees que tu internet va lento, usa el test de velocidad. Conéctate por wifi cerca del router, cierra otras descargas y toca iniciar prueba."),
 ("normal", "soporte", "Soporte técnico", ["Primero: apaga el router 30 segundos", "Revisa los cables", "Si sigue igual, reporta la falla"],
  "Si te quedas sin internet, primero apaga el router treinta segundos y vuelve a encenderlo, y revisa que los cables estén bien conectados. Si sigue igual, toca reportar una falla y te atendemos. Aquí también ves nuestro horario de atención."),
 ("normal", "plan", "Tu plan", ["Nombre y velocidad de tu plan", "Estado del servicio", "Acceso a Mi WiFi"],
  "En mi plan ves el nombre de tu plan, tu velocidad y el estado de tu servicio."),
 ("normal", "wifi", "Cambia tu WiFi", ["Escribe el nombre nuevo de tu red", "Escribe una clave de 8 caracteres o más", "Confirma y guarda: los aparatos se reconectan"],
  "Si tu equipo lo permite, puedes cambiar el nombre y la clave de tu wifi desde aquí. Escribe el nombre nuevo, una clave de ocho caracteres o más, confirma que entiendes que tus dispositivos se desconectarán, y guarda. En uno o dos minutos verás la red nueva y conectas tus aparatos con la clave nueva. Puedes hacerlo hasta tres veces al día."),
 ("aviso", "inicio", "Avisos y promociones", ["Cuando publicamos un aviso, aparece al abrir la app", "La campana te avisa si hay algo nuevo", "Toca Entendido para cerrarlo"],
  "Cuando publicamos un aviso, por ejemplo una promoción o un saludo de feliz año, aparece al abrir la app. Toca entendido para cerrarlo. La campana de arriba tiene un punto cuando hay avisos que no has leído, y allí puedes verlos todos."),
 ("normal", "perfil", "Tu perfil y ayuda", ["Tus datos y tu contrato", "Cerrar sesión", "WhatsApp para cualquier duda"],
  "En perfil están tus datos y tu contrato, y puedes cerrar sesión. Y para cualquier duda, tienes el botón de whatsapp en el inicio. Gracias por usar la app de RedCien."),
]

ADMIN = [
 ("Qué vamos a ver", ["Cómo usar la plataforma día a día", "Con las novedades: app del cliente, avisos, WiFi, prorrateo y morosos"],
  "Bienvenido. En este video te explicamos cómo se usa la plataforma de administración, paso a paso, incluyendo las novedades: la app del cliente, los avisos, el cambio de wifi, el nuevo prorrateo y la facturación de morosos."),
 ("Al empezar el día: Dashboard", ["Inicia sesión y mira las tarjetas", "Morosos: clientes bloqueados en el Mikrotik, en tiempo real", "Un clic en Morosos abre la lista para revisarla"],
  "Cada día empieza en el dashboard. La tarjeta de morosos muestra los clientes que están bloqueados en el Mikrotik, en tiempo real. Haz clic sobre ella y se abre la pantalla de morosos para revisar quién sigue sin pagar."),
 ("Clientes y su enlace de registro", ["Abre la ficha del cliente", "Genera el enlace de registro y envíalo por WhatsApp", "El cliente llena sus datos y la página lleva tu logo"],
  "En clientes abres la ficha de cada uno. Para un cliente nuevo, genera el enlace de registro y envíaselo por whatsapp. Él mismo llena sus datos en una página que lleva el logo de tu empresa."),
 ("Contratos y asignar la ONU", ["Crea el contrato: plan, conexión y servidor", "Escribe el identificador de la ONU del cliente", "Con la ONU puesta, el corte por mora y el cambio de WiFi funcionan"],
  "Cada contrato define el plan, el tipo de conexión y el servidor. Importante: escribe el identificador de la ONU del cliente tal como está en SmartOLT. Con ese dato la plataforma puede suspender y reactivar por mora, y el cliente puede cambiar su wifi desde la app. Antes de asignarla, confirma que la ONU es de ese cliente."),
 ("Facturación y el prorrateo nuevo", ["Las facturas se generan por grupo de corte", "Si instalas a mitad de ciclo se cobra por días: mes de 30 días", "Ejemplo: plan de 60.000 instalado el día 15, 16 días, 32.000"],
  "Las facturas se generan por grupo de corte. Si instalas a mitad de ciclo, el primer cobro se prorratea con el mes comercial de treinta días: se cobran los días de consumo, desde el día de instalación hasta el treinta. Por ejemplo, un plan de sesenta mil, instalado el día quince, cobra dieciséis días: treinta y dos mil pesos."),
 ("Facturar a morosos, sin duplicar", ["Nunca hay dos facturas del mismo contrato en el mismo mes", "Con el interruptor de tope, se sigue facturando a quien debe una factura", "Con dos o más abiertas, deja de facturarse"],
  "La plataforma nunca crea dos facturas del mismo contrato en el mismo mes. Y si activas el interruptor de morosos con tope, se sigue facturando a quien debe solo una factura anterior. Cuando ya debe dos o más, deja de facturarse, para que la deuda no crezca sin control. Antes de activarlo, corre la simulación para ver a quién tocaría."),
 ("Cobranza y cortes", ["Corte automático todos los días a las 8:00", "Revisa la lista de morosos del router", "Quita de la lista a quien ya pagó"],
  "El sistema corta automáticamente cada día a las ocho de la mañana a quienes no pagaron. Tú puedes revisar la lista de morosos del router y sacar de ella a quien ya pagó."),
 ("La app del cliente", ["Los clientes ven plan, facturas y pagan desde el celular", "Entran con su documento y un código por WhatsApp", "Todo con el logo y los colores de tu empresa"],
  "Tus clientes tienen su propia app. Ven su plan, sus facturas, cómo pagar, y reportan fallas desde el celular. Entran con su documento y un código que les llega por whatsapp, y todo lleva el logo de tu empresa."),
 ("Enviar la app a un cliente", ["En la ficha del cliente, usa el botón de la app", "Se envía el enlace por WhatsApp o lo copias", "El cliente descarga e instala la app"],
  "Para enviarle la app a un cliente, entra a su ficha y usa el botón de la app: puedes enviar el enlace por whatsapp o copiarlo. El cliente lo abre, descarga la aplicación y la instala."),
 ("Avisos: Feliz año, Halloween y promociones", ["Crea un aviso con título y mensaje", "Déjalo activo con la fecha de hoy", "Al abrir la app, al cliente le sale una ventana con tu mensaje"],
  "Para saludar o promocionar, crea un aviso con un título y un mensaje, déjalo activo con la fecha de hoy, y listo. La próxima vez que el cliente abra la app, le saldrá una ventana con tu mensaje, y la campana le mostrará el aviso."),
 ("Cambio de WiFi desde la app", ["El cliente cambia el nombre y la clave de su red", "Máximo tres veces al día, y deja registro en la auditoría", "Solo con la ONU asignada y SmartOLT configurado"],
  "El cliente puede cambiar el nombre y la clave de su wifi desde la app, hasta tres veces al día. Cada cambio queda registrado en la auditoría, sin guardar la clave en el registro. Solo funciona si el contrato tiene la ONU asignada y SmartOLT está configurado."),
 ("Configuración de la empresa", ["Sube tu logo una vez", "Aparece en el panel, facturas, enlaces y la app del cliente", "Cada empresa ve su propia marca"],
  "En configuración de empresa subes tu logo una sola vez. Aparece en el panel, en las facturas, en los enlaces del cliente y en la app. Cada empresa ve su propia marca."),
 ("Buenas prácticas", ["Revisa morosos y pendientes al empezar el día", "Haz respaldos de la base de datos con frecuencia", "Prueba los cambios con un cliente de prueba primero"],
  "Para terminar: revisa cada día los morosos y los pendientes, haz respaldos con frecuencia y prueba los cambios importantes con un cliente de prueba antes de abrirlos a todos. Gracias por ver este video."),
]

# ---------- montaje ----------
def montar(nombre, filas):
    """filas: lista de (png, narracion)"""
    segs = []; srt = []; t = 0.0
    for k, (png, narr) in enumerate(filas, 1):
        wav = os.path.join(TMP, f"{nombre}_{k:02d}.wav"); d = hablar(narr, wav)
        seg = os.path.join(TMP, f"{nombre}_{k:02d}.mp4")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-framerate", "25", "-i", png, "-i", wav, "-t", f"{d:.2f}",
                        "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "1",
                        "-movflags", "+faststart", seg], check=True)
        segs.append(seg)
        def ts(x): h, m, s = int(x // 3600), int(x % 3600 // 60), x % 60; return f"{h:02d}:{m:02d}:{int(s):02d},{int(round((s % 1) * 1000)):03d}"
        srt.append(f"{k}\n{ts(t)} --> {ts(t + d - PAUSA)}\n" + "\n".join(textwrap.wrap(narr, 70)) + "\n"); t += d
    lista = os.path.join(TMP, f"{nombre}.txt"); open(lista, "w").write("".join(f"file '{s}'\n" for s in segs))
    out = os.path.join(AQUI, nombre + ".mp4")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lista, "-c", "copy", "-movflags", "+faststart", out], check=True)
    open(os.path.join(AQUI, nombre + ".srt"), "w", encoding="utf-8").write("\n".join(srt))
    open(os.path.join(AQUI, nombre + "-guion.md"), "w", encoding="utf-8").write(f"# Guion: {nombre}\n\n" + "\n\n".join(f"## {i}\n{n}" for i, (_, n) in enumerate(filas, 1)) + "\n")
    print("OK", out, f"{t:.0f} s")

def hacer_cliente():
    v = variantes_portal(); n = len(CLIENTE); filas = []
    for i, (var, ruta, titulo, pts, narr) in enumerate(CLIENTE, 1):
        png = os.path.join(TMP, f"c{i:02d}.png"); foto(slide_cliente(i, n, v[var], ruta, titulo, pts, narr), png); filas.append((png, narr))
    montar("cliente-como-usar-app", filas)

def hacer_admin():
    n = len(ADMIN); filas = []
    for i, (titulo, pts, narr) in enumerate(ADMIN, 1):
        png = os.path.join(TMP, f"a{i:02d}.png"); foto(slide_admin(i, n, titulo, pts, narr), png); filas.append((png, narr))
    montar("admin-como-usar-plataforma", filas)

if __name__ == "__main__":
    q = sys.argv[1] if len(sys.argv) > 1 else "todo"
    if q in ("cliente", "todo"): hacer_cliente()
    if q in ("admin", "todo"): hacer_admin()
