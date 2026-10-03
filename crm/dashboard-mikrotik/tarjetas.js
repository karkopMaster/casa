/* tarjetas.js · Oculta la tarjeta "Suspendidos" del Dashboard (moroso y suspendido son lo mismo; queda "Morosos")
 * y hace que la tarjeta "Morosos" lleve a la pantalla de morosos al hacer clic.
 * Se carga desde el HTML desplegado, como marca.js. No modifica el bundle. Para quitarlo: bash desinstalar-tarjetas.sh */
(function () {
  "use strict";
  var OCULTAR = ["SUSPENDIDOS"];
  var CLIC = { "MOROSOS": "" }; // dirección fija (p. ej. "/servidores/morosos"); si queda vacía, se busca en el menú lateral un enlace "moroso"

  function rutaMorosos() {
    if (CLIC["MOROSOS"]) return CLIC["MOROSOS"];
    var as = document.querySelectorAll("a[href]");
    for (var i = 0; i < as.length; i++) {
      if (/moroso/i.test(as[i].textContent || "") && as[i].getAttribute("href")) return as[i].getAttribute("href");
    }
    return "";
  }
  function ir(ruta) {
    if (/^https?:\/\//i.test(ruta)) { location.href = ruta; return; }
    history.pushState({}, "", ruta);
    window.dispatchEvent(new PopStateEvent("popstate")); // react-router lo detecta sin recargar la página
  }

  function tarjetaDe(el) {
    // Sube desde la etiqueta hasta el hijo directo de la cuadrícula de tarjetas (contenedor con 4+ hijos).
    var n = el;
    for (var i = 0; i < 6 && n && n.parentElement; i++) {
      if (n.parentElement.children.length >= 4) return n;
      n = n.parentElement;
    }
    return null;
  }

  function enlazar(card) {
    if (card.getAttribute("data-clic") === "1") return;
    if (!rutaMorosos()) return; // sin dirección conocida no se muestra como enlace
    card.setAttribute("data-clic", "1");
    card.style.cursor = "pointer";
    card.setAttribute("role", "link");
    card.setAttribute("tabindex", "0");
    card.title = "Ver morosos";
    function abrir(ev) {
      var r = rutaMorosos();
      if (!r) return;
      if (ev) ev.preventDefault();
      ir(r);
    }
    card.addEventListener("click", abrir);
    card.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") abrir(ev); });
  }

  function aplicar() {
    var raiz = document.getElementById("root");
    if (!raiz) return;
    var els = raiz.querySelectorAll("div,span,p,h3,h4,small,label");
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (e.children.length > 0) continue;
      var t = (e.textContent || "").trim().toUpperCase();
      if (t === "MOROSOS") {
        var cm = tarjetaDe(e);
        if (cm) enlazar(cm);
        continue;
      }
      if (OCULTAR.indexOf(t) < 0) continue;
      var card = tarjetaDe(e);
      if (!card || card.getAttribute("data-oculta") === "1") continue;
      var grid = card.parentElement;
      card.style.display = "none";
      card.setAttribute("data-oculta", "1");
      grid.classList.add("tarjetas-sin-suspendidos");
    }
  }

  var css = document.createElement("style");
  css.textContent = "@media (min-width: 1100px){.tarjetas-sin-suspendidos{grid-template-columns:repeat(5,minmax(0,1fr))!important}}";
  document.head.appendChild(css);

  var t = null;
  function programar() { clearTimeout(t); t = setTimeout(aplicar, 120); }
  var raiz0 = document.getElementById("root");
  if (raiz0 && window.MutationObserver) new MutationObserver(programar).observe(raiz0, { childList: true, subtree: true });
  programar();
})();
