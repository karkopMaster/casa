/* tickets-mejoras.js · Mejoras a la pantalla de Tickets del panel (sin recompilar el panel):
 *  1) En el formulario "Crear Radicado" agrega "Asignar técnico (opcional)"; al crear el radicado lo asigna.
 *  2) En la lista de Tickets agrega un botón "Eliminar radicados" (borra con confirmación; solo ADMIN/SOPORTE).
 * Se carga desde el HTML del panel (como marca.js). Quitar: bash desinstalar-tickets-mejoras.sh */
(function () {
  "use strict";
  var RUTA = /^\/tickets(\/|$)/i;
  var tecnicos = null, tecCargando = false;

  function token() {
    var JWT = /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/, alm = [window.localStorage, window.sessionStorage];
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
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  function api(ruta, metodo, cuerpo) {
    var o = { method: metodo || "GET", headers: { Authorization: "Bearer " + token() } };
    if (cuerpo !== undefined) { o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(cuerpo); }
    return (realFetch || window.fetch)("/api" + ruta, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, d: d }; });
    });
  }
  function aviso(txt, bien) {
    var t = document.createElement("div");
    t.textContent = txt;
    t.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:84px;z-index:2147483647;background:" + (bien ? "#166534" : "#991b1b") + ";color:#fff;padding:10px 16px;border-radius:10px;font:600 14px system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.3);max-width:90vw;text-align:center";
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 4500);
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* ---------- 1) Asignar técnico al crear ---------- */
  function listaTecnicos() {
    if (tecnicos || tecCargando) return;
    tecCargando = true;
    api("/tecnicos").then(function (r) {
      var arr = Array.isArray(r.d) ? r.d : (r.d && (r.d.items || r.d.data)) || [];
      tecnicos = arr.map(function (t) { return { id: t.id || t.usuarioId, nombre: t.nombre || t.name || t.email || "" }; }).filter(function (t) { return t.id; });
      tecCargando = false; poner();
    }).catch(function () { tecCargando = false; });
  }
  function botonCrear() {
    var bs = document.querySelectorAll("button");
    for (var i = 0; i < bs.length; i++) if (/crear\s+radicado/i.test(bs[i].textContent || "")) return bs[i];
    return null;
  }
  function poner() {
    var b = botonCrear(), ya = document.getElementById("tm-tec");
    if (!b) { if (ya) ya.parentNode.remove(); return; }
    listaTecnicos();
    if (!tecnicos) return;
    var html = '<option value="">Sin asignar</option>' + tecnicos.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.nombre) + "</option>"; }).join("");
    if (ya) { if (ya.getAttribute("data-n") !== String(tecnicos.length)) { ya.innerHTML = html; ya.setAttribute("data-n", String(tecnicos.length)); } return; }
    var sel = document.createElement("select"); sel.id = "tm-tec"; sel.innerHTML = html; sel.setAttribute("data-n", String(tecnicos.length));
    var modelo = document.querySelector("select");
    sel.className = modelo ? modelo.className : "";
    sel.style.cssText = "width:100%;display:block;" + (modelo ? "" : "padding:10px;border:1px solid #cbd5e1;border-radius:8px;");
    var cont = document.createElement("div"); cont.style.cssText = "margin:12px 0 4px";
    var lab = document.createElement("div"); lab.textContent = "Asignar técnico (opcional)"; lab.style.cssText = "font:600 12px system-ui,sans-serif;color:#64748b;margin-bottom:4px";
    cont.appendChild(lab); cont.appendChild(sel);
    b.parentNode.insertBefore(cont, b);
  }
  function tecnicoElegido() { var s = document.getElementById("tm-tec"); return s ? s.value : ""; }

  function despuesDeCrear(texto, tec) {
    if (!tec) return;
    var id = ""; try { var j = JSON.parse(texto); id = j && j.id; } catch (e) {}
    if (!id) return;
    api("/tickets/" + encodeURIComponent(id) + "/asignar", "PATCH", { tecnicoId: tec }).then(function (r) {
      if (r.ok) aviso("Radicado creado y asignado al técnico.", true);
      else aviso("El radicado se creó, pero no se pudo asignar: " + ((r.d && typeof r.d.error === "string" && r.d.error) || "error"), false);
    }).catch(function () { aviso("El radicado se creó, pero no se pudo asignar (sin conexión).", false); });
  }
  function esCrear(metodo, url) {
    if (String(metodo).toUpperCase() !== "POST") return false;
    try { return new URL(url, location.origin).pathname.replace(/\/+$/, "") === "/api/tickets"; } catch (e) { return false; }
  }
  // Se observa la creación del radicado (axios usa XMLHttpRequest; otros usan fetch)
  try {
    var oOpen = XMLHttpRequest.prototype.open, oSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__tm = { m: m, u: u }; return oOpen.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () {
      var x = this, info = x.__tm;
      if (info && esCrear(info.m, info.u)) {
        var tec = tecnicoElegido();
        x.addEventListener("load", function () { if (x.status === 201 || x.status === 200) despuesDeCrear(x.responseText, tec); });
      }
      return oSend.apply(this, arguments);
    };
  } catch (e) {}
  if (window.fetch) {
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url) || "", metodo = (init && init.method) || (input && input.method) || "GET";
      var tec = esCrear(metodo, url) ? tecnicoElegido() : "";
      var p = realFetch(input, init);
      if (tec) p.then(function (r) { if (r.ok) r.clone().text().then(function (t) { despuesDeCrear(t, tec); }); }).catch(function () {});
      return p;
    };
  }

  /* ---------- 2) Eliminar radicados ---------- */
  var boton = null, panel = null, pag = 1, filtro = "";
  function estilosBtn(b, color) { b.style.cssText = "border:0;border-radius:999px;padding:11px 16px;font:600 14px system-ui,sans-serif;color:#fff;background:" + color + ";box-shadow:0 6px 18px rgba(0,0,0,.28);cursor:pointer"; }
  function mostrarBoton() {
    if (boton) return;
    boton = document.createElement("button"); boton.type = "button"; boton.id = "tm-eliminar"; boton.textContent = "🗑 Eliminar radicados";
    estilosBtn(boton, "#b91c1c"); boton.style.position = "fixed"; boton.style.right = "16px"; boton.style.bottom = "16px"; boton.style.zIndex = "2147483000";
    boton.addEventListener("click", abrirPanel); document.body.appendChild(boton);
  }
  function quitarBoton() { if (boton) { boton.remove(); boton = null; } if (panel) { panel.remove(); panel = null; } }
  function abrirPanel() {
    if (panel) return;
    panel = document.createElement("div");
    panel.style.cssText = "position:fixed;inset:0;z-index:2147483600;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px";
    panel.innerHTML = '<div style="background:#fff;border-radius:16px;max-width:760px;width:100%;max-height:88vh;display:flex;flex-direction:column;font:14px system-ui,sans-serif;color:#0f172a">' +
      '<div style="padding:16px 18px;border-bottom:1px solid #e2e8f0;display:flex;gap:10px;align-items:center"><b style="font-size:16px;flex:1">Eliminar radicados</b><button id="tm-x" style="border:0;background:none;font-size:22px;cursor:pointer">✕</button></div>' +
      '<div style="padding:12px 18px"><input id="tm-q" placeholder="Buscar por cliente, número o título…" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit"></div>' +
      '<div id="tm-lst" style="padding:0 18px;overflow:auto;flex:1;min-height:120px">Cargando…</div>' +
      '<div style="padding:12px 18px;border-top:1px solid #e2e8f0;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button id="tm-ant" style="padding:8px 12px">‹</button><span id="tm-pg"></span><button id="tm-sig" style="padding:8px 12px">›</button><span style="flex:1"></span><button id="tm-del" style="border:0;border-radius:8px;padding:10px 16px;color:#fff;background:#b91c1c;font:600 14px system-ui,sans-serif;cursor:pointer">Eliminar seleccionados</button></div></div>';
    document.body.appendChild(panel);
    pag = 1; filtro = "";
    panel.querySelector("#tm-x").onclick = function () { panel.remove(); panel = null; };
    panel.addEventListener("click", function (e) { if (e.target === panel) { panel.remove(); panel = null; } });
    panel.querySelector("#tm-q").oninput = function () { filtro = this.value.trim().toLowerCase(); pintar(); };
    panel.querySelector("#tm-ant").onclick = function () { if (pag > 1) { pag--; cargar(); } };
    panel.querySelector("#tm-sig").onclick = function () { pag++; cargar(); };
    panel.querySelector("#tm-del").onclick = eliminar;
    cargar();
  }
  var items = [];
  function cargar() {
    var lst = panel.querySelector("#tm-lst"); lst.textContent = "Cargando…";
    api("/tickets?pageSize=100&page=" + pag).then(function (r) {
      if (r.status === 401) { lst.textContent = "Tu sesión venció. Vuelve a ingresar."; return; }
      if (!r.ok) { lst.textContent = (r.d && r.d.error) || "No se pudo cargar la lista."; return; }
      items = r.d.items || [];
      var tot = r.d.total || items.length, pags = Math.max(1, Math.ceil(tot / 100));
      panel.querySelector("#tm-pg").textContent = "Página " + pag + " de " + pags + " · " + tot + " radicados";
      panel.querySelector("#tm-sig").disabled = pag >= pags; panel.querySelector("#tm-ant").disabled = pag <= 1;
      pintar();
    }).catch(function () { lst.textContent = "Sin conexión."; });
  }
  function pintar() {
    var lst = panel.querySelector("#tm-lst");
    var vis = items.filter(function (t) { var h = ("#" + t.numero + " " + (t.cliente ? t.cliente.nombre : "") + " " + t.titulo).toLowerCase(); return !filtro || h.indexOf(filtro) >= 0; });
    if (!vis.length) { lst.textContent = "No hay radicados."; return; }
    lst.innerHTML = vis.map(function (t) {
      return '<label style="display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px solid #f1f5f9;cursor:pointer"><input type="checkbox" class="tm-c" value="' + esc(t.id) + '" style="margin-top:3px"><span><b>#' + esc(t.numero) + "</b> · " + esc(t.cliente ? t.cliente.nombre : "") + '<br><span style="color:#64748b">' + esc(t.titulo) + " · " + esc(t.estado) + "</span></span></label>";
    }).join("");
  }
  function eliminar() {
    var ids = Array.prototype.map.call(panel.querySelectorAll(".tm-c:checked"), function (c) { return c.value; });
    if (!ids.length) { aviso("Marca al menos un radicado.", false); return; }
    if (!window.confirm("¿Eliminar " + ids.length + " radicado(s)? Se borran también sus comentarios, fotos y firma. No se puede deshacer.")) return;
    var btn = panel.querySelector("#tm-del"); btn.disabled = true; btn.textContent = "Eliminando…";
    var bien = 0, mal = 0, motivo = "";
    ids.reduce(function (p, id) {
      return p.then(function () {
        return api("/tickets/" + encodeURIComponent(id), "DELETE").then(function (r) {
          if (r.ok) bien++; else { mal++; motivo = (r.d && typeof r.d.error === "string" && r.d.error) || ("error " + r.status); }
        }).catch(function () { mal++; motivo = "sin conexión"; });
      });
    }, Promise.resolve()).then(function () {
      btn.disabled = false; btn.textContent = "Eliminar seleccionados";
      aviso(bien + " eliminado(s)" + (mal ? ", " + mal + " con error (" + motivo + ")" : ""), mal === 0);
      cargar();
    });
  }

  /* ---------- ciclo ---------- */
  var ultimaRuta = "";
  function ciclo() {
    var enTickets = RUTA.test(location.pathname);
    if (enTickets) { mostrarBoton(); poner(); } else { quitarBoton(); var s = document.getElementById("tm-tec"); if (s) s.parentNode.remove(); }
    ultimaRuta = location.pathname;
  }
  setInterval(ciclo, 700); ciclo();
})();
