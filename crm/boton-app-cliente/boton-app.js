/* boton-app.js · En la ficha de un cliente (/clientes/<id>) muestra un botón flotante para enviarle por WhatsApp
 * el enlace de descarga de la app, o copiarlo. Se carga desde el HTML del panel (como marca.js). No modifica el bundle.
 * Quitar: bash desinstalar-boton-app.sh */
(function () {
  "use strict";
  var RUTA = /^\/clientes\/([A-Za-z0-9_-]{10,40})\/?$/;
  var caja = null, ultimo = "";

  // El panel guarda su sesión como un JWT en el almacenamiento del navegador; se busca sin depender del nombre de la clave.
  function token() {
    var JWT = /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/;
    var alm = [window.localStorage, window.sessionStorage];
    for (var a = 0; a < alm.length; a++) {
      try {
        for (var i = 0; i < alm[a].length; i++) {
          var k = alm[a].key(i), v = alm[a].getItem(k);
          if (k === "portal_token" || !v) continue;
          if (JWT.test(v)) return v;
          try { var o = JSON.parse(v); if (o && typeof o.token === "string" && JWT.test(o.token)) return o.token; } catch (e) {}
        }
      } catch (e) {}
    }
    return "";
  }
  function api(id, accion, metodo) {
    return fetch("/api/cliente-app/" + id + "/" + accion, { method: metodo, headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" } })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d._status = r.status; return d; }); });
  }
  function aviso(txt, bien) {
    var t = document.createElement("div");
    t.textContent = txt;
    t.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:84px;z-index:2147483647;background:" + (bien ? "#166534" : "#991b1b") + ";color:#fff;padding:10px 16px;border-radius:10px;font:14px system-ui,sans-serif;max-width:90vw;box-shadow:0 6px 20px rgba(0,0,0,.3)";
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3500);
  }
  function copiar(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(texto);
    var ta = document.createElement("textarea"); ta.value = texto; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {} ta.remove(); return Promise.resolve();
  }
  function boton(txt, color) {
    var b = document.createElement("button"); b.type = "button"; b.textContent = txt;
    b.style.cssText = "border:0;border-radius:999px;padding:11px 16px;font:600 14px system-ui,sans-serif;color:#fff;background:" + color + ";box-shadow:0 6px 18px rgba(0,0,0,.28);cursor:pointer";
    return b;
  }
  function mostrar(id) {
    if (caja) return;
    caja = document.createElement("div");
    caja.id = "boton-app-cliente";
    caja.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end";
    var bw = boton("Enviar app por WhatsApp", "#16a34a"), bc = boton("Copiar enlace de la app", "#334155");
    bw.addEventListener("click", function () {
      bw.disabled = true;
      api(id, "info", "GET").then(function (d) {
        if (d._status === 401) { bw.disabled = false; return aviso("Tu sesión venció. Vuelve a ingresar.", false); }
        if (!d.nombre) { bw.disabled = false; return aviso(d.error || "No se pudo leer el cliente.", false); }
        if (!d.tieneWhatsapp) { bw.disabled = false; return aviso("Este cliente no tiene WhatsApp registrado.", false); }
        if (!window.confirm("¿Enviar el enlace de la app a " + d.nombre + " por WhatsApp (" + d.whatsappMascara + ")?")) { bw.disabled = false; return; }
        return api(id, "enviar", "POST").then(function (r) {
          bw.disabled = false;
          aviso(r.ok ? "Enlace enviado por WhatsApp." : (r.error || "No se pudo enviar."), !!r.ok);
        });
      }).catch(function () { bw.disabled = false; aviso("Sin conexión con el servidor.", false); });
    });
    bc.addEventListener("click", function () {
      api(id, "info", "GET").then(function (d) {
        if (!d.enlace) return aviso(d.error || "No se pudo obtener el enlace.", false);
        copiar(d.enlace).then(function () { aviso("Enlace copiado: " + d.enlace, true); });
      }).catch(function () { aviso("Sin conexión con el servidor.", false); });
    });
    caja.appendChild(bc); caja.appendChild(bw); document.body.appendChild(caja);
  }
  function revisar() {
    var m = location.pathname.match(RUTA);
    if (m && m[1] !== "importar" && m[1] !== "exportar") { if (ultimo !== m[1] && caja) { caja.remove(); caja = null; } ultimo = m[1]; mostrar(m[1]); }
    else if (caja) { caja.remove(); caja = null; ultimo = ""; }
  }
  // La app cambia de pantalla sin recargar: se revisa la dirección con cada cambio de historial.
  ["pushState", "replaceState"].forEach(function (f) { var o = history[f]; history[f] = function () { var r = o.apply(this, arguments); setTimeout(revisar, 0); return r; }; });
  window.addEventListener("popstate", revisar);
  revisar();
})();
