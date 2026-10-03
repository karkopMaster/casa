/* marca.js · Marca blanca por empresa: logo, nombre e ícono de la pestaña.
 * Se carga desde el HTML desplegado (como menu.js). No modifica el bundle de React.
 * - Páginas con enlace (/registro/:token, /asignaciones/..., /radicados/..., /pago/...): usa la empresa dueña del token.
 * - Resto (panel, login): usa la empresa del dominio (/api/public/empresa).
 * Para quitarlo: borra la línea <script src="/marca.js..."> del HTML. */
(function () {
  "use strict";
  var TOKEN = /^\/(registro|asignaciones|radicados|pago)\/([^\/?#]+)/;
  var PUBLICA = /^\/(login)?\/?$/; // el login también muestra el logo de la empresa del dominio

  function buscar(o, clave, p) {
    if (!o || typeof o !== "object" || (p || 0) > 4) return null;
    if (typeof o[clave] === "string" && o[clave]) return o[clave];
    for (var k in o) {
      if (Object.prototype.hasOwnProperty.call(o, k)) {
        var r = buscar(o[k], clave, (p || 0) + 1);
        if (r) return r;
      }
    }
    return null;
  }
  function get(u) {
    return fetch(u, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }
  function nombreDe(d) {
    if (!d) return "";
    if (typeof d.empresa === "string") return d.empresa;
    if (d.empresa && typeof d.empresa.nombre === "string") return d.empresa.nombre;
    return typeof d.nombre === "string" ? d.nombre : "";
  }

  var m = location.pathname.match(TOKEN);
  var tokenReq = m ? get("/api/public/" + m[1] + "/" + encodeURIComponent(m[2])) : Promise.resolve(null);

  Promise.all([get("/api/public/empresa"), tokenReq]).then(function (r) {
    // Con enlace: manda la empresa del token (aunque no tenga logo); sin enlace: la del dominio.
    var origen = m && r[1] ? r[1] : r[0];
    if (!origen) return;
    var logo = buscar(origen, "logoUrl") || buscar(origen, "logo");
    var nombre = nombreDe(origen);
    aplicar({ logo: logo, nombre: nombre, conToken: !!m });
  });

  function enlace(rel, href, extra) {
    var l = document.querySelector('link[rel="' + rel + '"]');
    if (!l) { l = document.createElement("link"); l.rel = rel; document.head.appendChild(l); }
    l.removeAttribute("sizes"); l.href = href;
    if (extra) l.type = extra;
  }

  function aplicar(M) {
    if (M.nombre && (!document.title || /^ISP CRM$/i.test(document.title.trim()))) document.title = M.nombre;
    if (M.logo) {
      var tipo = /\.svg(\?|$)/i.test(M.logo) ? "image/svg+xml" : /\.jpe?g(\?|$)/i.test(M.logo) ? "image/jpeg" : "image/png";
      enlace("icon", M.logo, tipo);
      enlace("apple-touch-icon", M.logo);
    }
    var css = document.createElement("style");
    css.textContent =
      "#marca-logo{display:flex;justify-content:center;padding:14px 16px 0}" +
      "#marca-logo img{max-height:72px;max-width:220px;object-fit:contain}" +
      ".sidebar-brand[data-marca]>:not(.marca-img){display:none!important}" +
      ".sidebar-brand .marca-img{max-height:38px;max-width:150px;object-fit:contain;display:block}";
    document.head.appendChild(css);
    if (!M.logo) return;

    var base = M.logo.split("/").pop().split("?")[0];
    function yaHayLogo() { return !!document.querySelector('img[src*="' + base + '"]:not(.marca-img)'); }

    function aplicarDom() {
      var root = document.getElementById("root");
      if (!root || !root.firstChild) return;
      // Menú lateral del panel: se reemplaza "ISP / ISP CRM" por el logo de la empresa.
      document.querySelectorAll(".sidebar-brand:not([data-marca])").forEach(function (el) {
        el.setAttribute("data-marca", "1");
        var img = document.createElement("img");
        img.className = "marca-img"; img.src = M.logo; img.alt = M.nombre || "Logo";
        el.appendChild(img);
      });
      // Páginas públicas y login: logo arriba si la página aún no muestra el de la empresa.
      var esPublica = M.conToken || PUBLICA.test(location.pathname);
      if (esPublica && !document.getElementById("marca-logo") && !yaHayLogo() && !document.querySelector(".sidebar-brand")) {
        var div = document.createElement("div");
        div.id = "marca-logo";
        var im = document.createElement("img");
        im.src = M.logo; im.alt = M.nombre || "Logo";
        div.appendChild(im);
        root.parentNode.insertBefore(div, root); // fuera de #root: React no lo borra
      }
    }

    var t = null;
    function programar() { clearTimeout(t); t = setTimeout(aplicarDom, 150); }
    var root0 = document.getElementById("root");
    if (root0 && window.MutationObserver) new MutationObserver(programar).observe(root0, { childList: true, subtree: true });
    programar();
  }
})();
