/* tarjetas.js · Oculta la tarjeta "Suspendidos" del Dashboard (moroso y suspendido son lo mismo; queda "Morosos").
 * Se carga desde el HTML desplegado, como marca.js. No modifica el bundle. Para quitarlo: bash desinstalar-tarjetas.sh */
(function () {
  "use strict";
  var OCULTAR = ["SUSPENDIDOS"];

  function tarjetaDe(el) {
    // Sube desde la etiqueta hasta el hijo directo de la cuadrícula de tarjetas (contenedor con 4+ hijos).
    var n = el;
    for (var i = 0; i < 6 && n && n.parentElement; i++) {
      if (n.parentElement.children.length >= 4) return n;
      n = n.parentElement;
    }
    return null;
  }

  function aplicar() {
    var raiz = document.getElementById("root");
    if (!raiz) return;
    var els = raiz.querySelectorAll("div,span,p,h3,h4,small,label");
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (e.children.length > 0) continue;
      var t = (e.textContent || "").trim().toUpperCase();
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
