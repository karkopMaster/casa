'use strict';
/* ---------- MODO FÁCIL: pantallas simples, letra y botones grandes, un paso a la vez ---------- */
const FS_LEVELS = [18, 22, 26, 30];
// Un color por acción (se reconoce el botón también por su color). Todos con texto blanco y contraste ≥ 4,5:1.
const SCREEN_COLOR = { vender: 'verde', cobrar: 'azul', comprar: 'naranja', pagar: 'morado', gasto: 'rojo', clientes: 'turquesa', productos: 'ambar', alertas: 'rosa', resumen: 'gris' };
const METHOD_COLOR = { efectivo: 'verde', nequi: 'fucsia', banco: 'azul', tarjeta: 'naranja' };
let FS = 1;
try { const v = parseInt(localStorage.getItem('fs'), 10); if (v >= 0 && v < FS_LEVELS.length) FS = v; } catch (_) {}
const applyFs = () => { document.documentElement.style.fontSize = FS_LEVELS[FS] + 'px'; try { localStorage.setItem('fs', FS); } catch (_) {} };
const fMode = () => { let m = null; try { m = localStorage.getItem('modo'); } catch (_) {} return m || (S.cfg.ui_default === 'completo' ? 'completo' : 'facil'); };
const setMode = (m) => { try { localStorage.setItem('modo', m); } catch (_) {} document.documentElement.style.fontSize = ''; document.body.classList.toggle('facil', m === 'facil'); location.hash = ''; render(); };
const fHome = () => { location.hash = '#f/inicio'; };
const spanishDays = (n) => (n === 0 ? 'hoy' : n === 1 ? '1 día' : n + ' días');
const daysBetween = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

function payMethods() {
  const acc = S.cfg.pay_accounts || [], has = (c) => acc.some((a) => a.code === c);
  const out = [];
  if (S.cfg.acc_caja && has(S.cfg.acc_caja)) out.push({ key: 'efectivo', icon: '💵', label: 'EFECTIVO', code: S.cfg.acc_caja });
  const nq = acc.find((a) => a.code === '111010' || /billetera|nequi|daviplata/i.test(a.name)); if (nq) out.push({ key: 'nequi', icon: '📱', label: 'NEQUI / DAVIPLATA', code: nq.code });
  if (S.cfg.acc_bancos && has(S.cfg.acc_bancos)) out.push({ key: 'banco', icon: '🏦', label: 'BANCO / TRANSFERENCIA', code: S.cfg.acc_bancos });
  const df = acc.find((a) => a.code === '111015' || /dat[aá]fono|tarjeta/i.test(a.name)); if (df) out.push({ key: 'tarjeta', icon: '💳', label: 'TARJETA / DATÁFONO', code: df.code });
  return out;
}
const methodButtons = (extra = '') => `<div class="fgrid">${payMethods().map((m) => `<button class="fbig c-${METHOD_COLOR[m.key]}" data-m="${m.key}"><span class="fi">${m.icon}</span>${m.label}</button>`).join('')}${extra}</div>`;

/* ----- estructura común ----- */
function fShell(title, body, { back = true, hideTitle = false } = {}) {
  const app = $('#app');
  const scr = (location.hash.slice(1).split('/')[1]) || 'inicio';
  app.innerHTML = `<div class="fx" data-c="${SCREEN_COLOR[scr] || ''}"><div class="ftop">${back ? '<button class="fback" id="fb">⬅ VOLVER</button>' : `<div class="fbrand">${esc(S.cfg.company_name || '')}</div>`}
    <div class="ftools"><button class="fsmall" id="fminus" aria-label="Letra más pequeña">A−</button><button class="fsmall" id="fplus" aria-label="Letra más grande">A+</button></div></div>
    ${S.cfg.is_demo === '1' ? `<div class="fdemo">🧪 DEMOSTRACIÓN · datos ficticios · se borra el ${esc(S.cfg.demo_expires || '')}</div>` : ''}
    ${hideTitle ? '' : `<h1 class="ftitle">${esc(title)}</h1>`}<div id="fbody">${body}</div></div>`;
  if (back) $('#fb').onclick = () => { if (history.length > 1 && location.hash !== '#f/inicio') fHome(); else fHome(); };
  $('#fminus').onclick = () => { FS = Math.max(0, FS - 1); applyFs(); };
  $('#fplus').onclick = () => { FS = Math.min(FS_LEVELS.length - 1, FS + 1); applyFs(); };
  window.scrollTo(0, 0);
  return $('#fbody');
}
const fOk = (title, lines, buttons) => { // pantalla de éxito
  const el = fShell('', `<div class="fok"><div class="fcheck">✔</div><h1>${esc(title)}</h1>${lines.map((l) => `<p>${l}</p>`).join('')}<div class="fgrid">${buttons.map((b, i) => `<button class="fbig ${b.cls || ''}" data-b="${i}">${b.label}</button>`).join('')}</div></div>`, { back: false, hideTitle: true });
  $$('[data-b]', el).forEach((b) => (b.onclick = buttons[+b.dataset.b].fn));
};
async function fSafe(btn, fn) { // evita dobles clics y muestra errores grandes
  if (btn) btn.disabled = true;
  try { await fn(); } catch (e) { fError(e.message); if (btn) btn.disabled = false; }
}
function fError(msg) {
  const old = $('#ferr'); if (old) old.remove();
  const d = document.createElement('div'); d.id = 'ferr'; d.className = 'ferr'; d.innerHTML = `<b>⚠ ${esc(msg)}</b><button class="fbig sec" id="ferrok">ENTENDIDO</button>`;
  document.body.appendChild(d); $('#ferrok').onclick = () => d.remove();
}
function fConfirm(title, lines, yes, onYes, onNo) { // confirmación grande antes de mover dinero
  const close = modal(title, `<div class="fconf">${lines.map((l) => `<p>${l}</p>`).join('')}<button class="fbig go" id="fyes">✅ ${yes}</button><button class="fbig sec" id="fno">⬅ NO, VOLVER</button></div>`, {
    onMount: (el) => { $('#fno', el).onclick = () => { close(); if (onNo) onNo(); }; $('#fyes', el).onclick = (e) => fSafe(e.target, async () => { await onYes(); close(); }); },
  });
}

/* ----- entrada ----- */
async function renderFacil(app) {
  document.body.classList.add('facil'); applyFs();
  const [, screen, arg] = (location.hash.slice(1) || 'f/inicio').split('/');
  const fn = FACIL[screen] || FACIL.inicio;
  try { await fn(arg); } catch (e) { fShell('Algo salió mal', `<p class="fbigtext">${esc(e.message)}</p><button class="fbig" onclick="location.reload()">INTENTAR DE NUEVO</button>`); }
}

const FACIL = {};

/* ----- inicio ----- */
FACIL.inicio = async () => {
  const role = S.user.role, acc = role !== 'vendedor';
  let alertas = 0;
  if (acc) { try { const d = await api('GET', '/reports/dashboard'); alertas = (d.lots ? d.lots.expired_count + d.lots.expiring_count : 0) + d.low_stock.length; } catch (_) {} }
  const tiles = [
    ['vender', '🛒', 'VENDER'], ['cobrar', '💵', 'COBRAR A UN CLIENTE'],
    ...(acc ? [['comprar', '📦', 'COMPRAR MERCANCÍA'], ['pagar', '🧾', 'PAGAR A UN PROVEEDOR'], ['gasto', '💸', 'REGISTRAR UN GASTO']] : []),
    ['clientes', '👥', 'MIS CLIENTES'], ['productos', '🏷️', 'MIS PRODUCTOS'],
    ...(acc ? [['alertas', '⚠️', 'AVISOS' + (alertas ? ` (${alertas})` : '')], ['resumen', '📊', '¿CÓMO VOY?']] : []),
  ];
  const el = fShell('', `<h1 class="fhello">Hola, ${esc(S.user.name.split(' ')[0])} 👋</h1><p class="fbigtext">¿Qué desea hacer?</p>
    <div class="ftiles">${tiles.map((t) => `<button class="ftile c-${SCREEN_COLOR[t[0]]}" data-s="${t[0]}"><span class="fi">${t[1]}</span>${t[2]}</button>`).join('')}</div>
    <div class="ffoot"><button class="flink" id="fall">Ver todas las opciones</button><button class="flink" id="fout">Cerrar sesión</button></div>`, { back: false, hideTitle: true });
  $$('[data-s]', el).forEach((b) => (b.onclick = () => { location.hash = '#f/' + b.dataset.s; }));
  $('#fall').onclick = () => setMode('completo');
  $('#fout').onclick = async () => { try { await api('POST', '/logout'); } catch (_) {} S.token = null; try { localStorage.removeItem('token'); } catch (_) {} document.documentElement.style.fontSize = ''; document.body.classList.remove('facil'); render(); };
};

/* ----- cobrar / pagar ----- */
async function pendientes(tipo) {
  if (tipo === 'cobrar') return (await api('GET', '/documents?type=venta&pending=1')).map((d) => ({ ...d, kind: 'venta' }));
  const [c, g] = await Promise.all([api('GET', '/documents?type=compra&pending=1'), api('GET', '/documents?type=gasto&pending=1')]);
  return [...c.map((d) => ({ ...d, kind: 'compra' })), ...g.map((d) => ({ ...d, kind: 'gasto' }))];
}
function debtCards(rows, tipo) {
  const hoy = todayStr();
  rows.sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  return rows.length ? rows.map((d, i) => {
    const bal = round2(d.total - d.paid), late = daysBetween(hoy, d.due_date);
    const tag = late > 0 ? `<span class="ftag bad">Vencida hace ${spanishDays(late)}</span>` : `<span class="ftag">Vence en ${spanishDays(-late)}</span>`;
    return `<div class="fcard"><div class="fname">${esc(d.third || (tipo === 'cobrar' ? 'Cliente de mostrador' : 'Sin nombre'))}</div><div class="fsub">${esc(d.number)} · ${esc(d.date)}</div>
      <div class="famount">${tipo === 'cobrar' ? 'Debe' : 'Debo'}: ${money(bal)}</div>${tag}<button class="fbig c-${tipo === 'cobrar' ? 'azul' : 'morado'}" data-i="${i}">${tipo === 'cobrar' ? '💵 COBRAR' : '💸 PAGAR'}</button></div>`;
  }).join('') : `<div class="fempty">🎉 ${tipo === 'cobrar' ? 'Nadie le debe nada.' : 'No debe nada a proveedores.'}</div>`;
}
async function pantallaDeuda(tipo) {
  const rows = await pendientes(tipo);
  const tot = round2(rows.reduce((s, d) => s + d.total - d.paid, 0));
  const el = fShell(tipo === 'cobrar' ? 'Cobrar a un cliente' : 'Pagar a un proveedor', `<div class="fsum">${tipo === 'cobrar' ? 'Le deben en total' : 'Debe en total'}: <b>${money(tot)}</b></div><input class="fsearch" id="fq" placeholder="🔍 Buscar por nombre…" autocomplete="off"><div id="fl"></div>`);
  const draw = () => {
    const q = $('#fq').value.trim().toLowerCase();
    const list = rows.filter((d) => !q || (d.third || '').toLowerCase().includes(q) || d.number.toLowerCase().includes(q));
    $('#fl').innerHTML = debtCards(list, tipo);
    $$('#fl [data-i]').forEach((b) => (b.onclick = () => fPay(list[+b.dataset.i], tipo)));
  };
  $('#fq').oninput = draw; draw();
}
FACIL.cobrar = () => pantallaDeuda('cobrar');
FACIL.pagar = () => pantallaDeuda('pagar');

// Cobro o pago en 3 pasos grandes: cuánto → cómo → confirmar
function fPay(doc, tipo) {
  const bal = round2(doc.total - doc.paid), who = doc.third || (tipo === 'cobrar' ? 'cliente de mostrador' : 'proveedor');
  let amount = bal;
  const step = {
    monto() {
      body(`<p class="fbigtext">${tipo === 'cobrar' ? 'Debe' : 'Debe usted'}: <b>${money(bal)}</b></p><button class="fbig c-verde" id="all">${tipo === 'cobrar' ? 'RECIBÍ' : 'PAGUÉ'} TODO: ${money(bal)}</button>
        <p class="fbigtext" style="margin-top:1rem">o un valor diferente:</p><input class="fnum" id="amt" inputmode="decimal" placeholder="Escriba el valor">
        <button class="fbig sec" id="part">OTRO VALOR ➡</button>`);
      $('#all').onclick = () => { amount = bal; step.metodo(); };
      $('#part').onclick = () => { const v = round2(parseFloat(String($('#amt').value).replace(',', '.'))); if (!(v > 0)) return fError('Escriba el valor.'); if (v > bal + 0.005) return fError(`No puede ser más de ${money(bal)}.`); amount = v; step.metodo(); };
    },
    metodo() {
      body(`<p class="fbigtext">Valor: <b>${money(amount)}</b></p><p class="fbigtext">${tipo === 'cobrar' ? '¿Cómo le pagaron?' : '¿Cómo pagó?'}</p>${methodButtons()}<button class="fbig sec" id="back">⬅ CAMBIAR VALOR</button>`);
      $('#back').onclick = step.monto;
      $$('#fmodal [data-m]').forEach((b) => (b.onclick = () => step.confirmar(payMethods().find((m) => m.key === b.dataset.m))));
    },
    confirmar(m) {
      body(`<div class="fconf"><p class="fbigtext">${tipo === 'cobrar' ? 'Va a registrar que' : 'Va a registrar que pagó a'}</p><p class="fname">${esc(who)}</p><p class="famount">${tipo === 'cobrar' ? 'pagó' : ''} ${money(amount)}</p><p class="fbigtext">por ${m.icon} ${m.label}</p>
        <p class="fsub">${esc(doc.number)}${amount < bal ? ` · quedará debiendo ${money(round2(bal - amount))}` : ' · quedará pagada'}</p>
        <button class="fbig go" id="yes">✅ SÍ, REGISTRAR</button><button class="fbig sec" id="no">⬅ NO, VOLVER</button></div>`);
      $('#no').onclick = step.metodo;
      $('#yes').onclick = (e) => fSafe(e.target, async () => {
        const id = (await api('GET', '/documents/' + doc.id)).id;
        await api('POST', '/payments', { doc_id: id, amount, date: todayStr(), account_code: m.code });
        close();
        fOk(tipo === 'cobrar' ? '¡Cobro registrado!' : '¡Pago registrado!', [`${esc(who)}: <b>${money(amount)}</b>`, amount < bal ? `Quedan ${money(round2(bal - amount))} por ${tipo === 'cobrar' ? 'cobrar' : 'pagar'}.` : 'Esta cuenta quedó saldada.'],
          [{ label: tipo === 'cobrar' ? '💵 COBRAR A OTRO' : '💸 PAGAR OTRA', cls: 'go', fn: () => { location.hash = '#f/' + tipo; render(); } }, { label: '🏠 INICIO', fn: fHome }]);
      });
    },
  };
  let close;
  const body = (html) => { $('#fmodal').innerHTML = html; };
  close = modal(tipo === 'cobrar' ? `Cobrar a ${who}` : `Pagar a ${who}`, '<div id="fmodal"></div>', { onMount: () => step.monto() });
}

/* ----- carrito compartido por vender y comprar ----- */
async function carrito(tipo) {
  const [products, thirds] = await Promise.all([api('GET', '/products'), api('GET', '/thirds' + qs({ kind: tipo === 'venta' ? 'cliente' : 'proveedor' }))]);
  const useInv = S.cfg.use_inventory === '1', lots = S.cfg.track_lots === '1' && tipo === 'compra';
  const st = { third: null, mostrador: false, lines: [], method: null, credit: false };
  const mostradorT = thirds.find((t) => /mostrador|consumidor/i.test(t.name));
  const priceOf = (p) => (tipo === 'venta' ? (st.third && st.third.price_list === 'mayorista' && p.price2 > 0 ? p.price2 : p.price) : (p.cost || 0));
  const sugOf = (p) => (tipo === 'venta' && p.sug && p.sug.pct > 0 ? (st.third && st.third.price_list === 'mayorista' && p.sug2 ? p.sug2 : p.sug) : null);
  const calc = (l) => { const base = round2(l.qty * l.price * (1 - l.disc / 100)); const tax = round2(base * (l.p.tax_rate || 0) / 100); return { base, tax, total: round2(base + tax) }; };
  const total = () => round2(st.lines.reduce((s, l) => s + calc(l).total, 0));
  const word = tipo === 'venta' ? { t: 'Vender', q: '¿Quién compra?', who: 'CLIENTE DE MOSTRADOR', list: 'UN CLIENTE DE MI LISTA' } : { t: 'Comprar mercancía', q: '¿A quién le compra?', who: null, list: 'UN PROVEEDOR DE MI LISTA' };

  const s1 = () => {
    const el = fShell(word.t, `<p class="fbigtext">${word.q}</p><div class="fgrid">${tipo === 'venta' ? `<button class="fbig c-verde" id="mos"><span class="fi">🙋</span>${word.who}<small>(paga ahora)</small></button>` : ''}
      <button class="fbig c-azul" id="lst"><span class="fi">👥</span>${word.list}</button></div>`);
    if (tipo === 'venta') $('#mos').onclick = () => { st.third = mostradorT || null; st.mostrador = true; s2(); };
    $('#lst').onclick = () => s1b();
  };
  const s1b = () => {
    const el = fShell(word.t, `<p class="fbigtext">${tipo === 'venta' ? 'Escoja el cliente' : 'Escoja el proveedor'}</p><input class="fsearch" id="fq" placeholder="🔍 Buscar por nombre…" autocomplete="off"><div id="fl"></div>`);
    const draw = () => {
      const q = $('#fq').value.trim().toLowerCase(), list = thirds.filter((t) => !/mostrador|consumidor/i.test(t.name) && (!q || (t.name + ' ' + (t.company || '')).toLowerCase().includes(q))).slice(0, 40);
      $('#fl').innerHTML = list.length ? list.map((t, i) => `<button class="fpick" data-i="${i}"><b>${esc(t.name)}</b>${t.company ? `<small>${esc(t.company)}</small>` : ''}${t.receivable > 0 ? `<small class="bad">Le debe ${money(t.receivable)}</small>` : ''}</button>`).join('') : '<div class="fempty">No encuentro a nadie con ese nombre.<br>Puede agregarlo en “Mis clientes”.</div>';
      $$('#fl [data-i]').forEach((b) => (b.onclick = () => { st.third = list[+b.dataset.i]; st.mostrador = false; s2(); }));
    };
    $('#fq').oninput = draw; draw();
  };

  const s2 = () => {
    const el = fShell(word.t, `<div class="fsum">${esc(st.third ? st.third.name : 'Cliente de mostrador')}${st.third && st.third.price_list === 'mayorista' ? ' · <b>precio mayorista</b>' : ''}</div>
      <div class="fsplit"><div class="fleft"><input class="fsearch" id="fq" placeholder="🔍 Busque un producto o escanee el código…" autocomplete="off" autofocus><div id="fres" class="fprods"></div></div>
      <div class="fright"><h2 class="fh2">${tipo === 'venta' ? 'Lo que lleva el cliente' : 'Lo que va a comprar'}</h2><div id="fcart"></div><div class="fbar"><div class="ftotal">TOTAL: <b id="ft">${money(total())}</b></div><button class="fbig go" id="next">SIGUIENTE ➡</button></div></div></div>`);
    setTimeout(() => { const q = $('#fq'); if (q) q.focus(); }, 50);
    const add = (p) => {
      const ex = st.lines.find((l) => l.p.id === p.id);
      const stock = p.is_service || !useInv ? Infinity : p.stock;
      if (tipo === 'venta' && S.cfg.allow_negative_stock !== '1' && (ex ? ex.qty : 0) + 1 > stock + 1e-9) return fError(`De "${p.name}" solo quedan ${qty(p.stock)}.`);
      if (ex) ex.qty += 1; else { const sg = sugOf(p); st.lines.push({ p, qty: 1, price: sg ? sg.price : priceOf(p), disc: 0, sug: sg, lot: '', expiry: '' }); if (sg) { const l = st.lines[st.lines.length - 1]; l.price = priceOf(p); l.disc = sg.pct; } }
      drawCart();
    };
    const drawRes = () => {
      const q = $('#fq').value.trim().toLowerCase();
      const exact = q && products.find((p) => p.code.toLowerCase() === q || (p.barcode && String(p.barcode) === q));
      const list = (q ? products.filter((p) => (p.name + ' ' + p.code + ' ' + (p.brand || '')).toLowerCase().includes(q)) : products).slice(0, q ? 12 : 8);
      $('#fres').innerHTML = list.map((p, i) => `<button class="fprod" data-i="${i}"><b>${esc(p.name)}</b><span>${money(priceOf(p))}</span><small>${p.is_service ? 'Servicio' : (tipo === 'venta' && p.stock <= 0 ? '<span class="bad">Sin existencias</span>' : 'Quedan ' + qty(p.stock))}${sugOf(p) ? ` · <span class="warnc">⏳ por vencer −${sugOf(p).pct}%</span>` : ''}</small></button>`).join('') || '<div class="fempty">No encuentro ese producto.</div>';
      $$('#fres [data-i]').forEach((b) => (b.onclick = () => { add(list[+b.dataset.i]); $('#fq').value = ''; drawRes(); }));
      return exact;
    };
    const drawCart = () => {
      $('#fcart').innerHTML = st.lines.length ? st.lines.map((l, i) => `<div class="fline"><div class="fname">${esc(l.p.name)}</div>
        <div class="fqty"><button class="fcirc" data-d="-1" data-i="${i}" aria-label="Menos">−</button><span class="fq">${qty(l.qty)}</span><button class="fcirc" data-d="1" data-i="${i}" aria-label="Más">+</button></div>
        <div class="fprice">${tipo === 'compra' ? `<label class="fsub">Costo de cada uno</label><input class="fnum small" data-c="${i}" inputmode="decimal" value="${l.price}">` : `${money(l.price)} c/u${l.disc ? ` · <span class="warnc">−${l.disc}% por vencer</span>` : ''}`}</div>
        ${lots && l.p && !l.p.is_service ? `<div class="fsub">Lote y vencimiento (si tiene)</div><div class="frow"><input class="fnum small" data-l="${i}" placeholder="Lote" value="${esc(l.lot)}"><input class="fnum small" type="date" data-e="${i}" value="${esc(l.expiry)}"></div>` : ''}
        <div class="fsub">Subtotal: <b>${money(calc(l).total)}</b></div><button class="fquit" data-r="${i}">✕ QUITAR</button></div>`).join('') : '<div class="fempty">Todavía no ha agregado nada.<br>Toque un producto de arriba.</div>';
      $('#ft').textContent = money(total());
      $$('#fcart [data-d]').forEach((b) => (b.onclick = () => { const l = st.lines[+b.dataset.i]; const nq = l.qty + +b.dataset.d; if (nq <= 0) st.lines.splice(+b.dataset.i, 1); else { if (tipo === 'venta' && useInv && !l.p.is_service && S.cfg.allow_negative_stock !== '1' && nq > l.p.stock + 1e-9) return fError(`Solo quedan ${qty(l.p.stock)}.`); l.qty = nq; } drawCart(); }));
      $$('#fcart [data-r]').forEach((b) => (b.onclick = () => { st.lines.splice(+b.dataset.r, 1); drawCart(); }));
      $$('#fcart [data-c]').forEach((i) => (i.onchange = () => { const v = parseFloat(String(i.value).replace(',', '.')); st.lines[+i.dataset.c].price = v >= 0 ? v : 0; drawCart(); }));
      $$('#fcart [data-l]').forEach((i) => (i.oninput = () => { st.lines[+i.dataset.l].lot = i.value; }));
      $$('#fcart [data-e]').forEach((i) => (i.onchange = () => { st.lines[+i.dataset.e].expiry = i.value; }));
    };
    $('#fq').oninput = drawRes;
    $('#fq').onkeydown = (e) => { if (e.key !== 'Enter') return; e.preventDefault(); const ex = drawRes(); if (ex) { add(ex); $('#fq').value = ''; drawRes(); } };
    $('#next').onclick = () => { if (!st.lines.length) return fError('Agregue al menos un producto.'); s3(); };
    drawRes(); drawCart();
  };

  const s3 = () => {
    const credOk = !!(st.third && !st.mostrador) || (st.third && /mostrador|consumidor/i.test(st.third.name) ? false : !!st.third);
    const el = fShell(word.t, `<div class="fsum">TOTAL: <b>${money(total())}</b></div><p class="fbigtext">${tipo === 'venta' ? '¿Cómo paga?' : '¿Cómo lo paga?'}</p>${methodButtons(`<button class="fbig c-ambar ${credOk ? '' : 'off'}" id="cred"><span class="fi">📒</span>${tipo === 'venta' ? 'LO DEJA FIADO' : 'LO PAGO DESPUÉS'}${credOk ? '' : '<small>(elija un ' + (tipo === 'venta' ? 'cliente' : 'proveedor') + ' de su lista)</small>'}</button>`)}`);
    $$('[data-m]', el).forEach((b) => (b.onclick = () => { st.method = payMethods().find((m) => m.key === b.dataset.m); st.credit = false; s4(); }));
    $('#cred').onclick = () => { if (!credOk) return fError(`Para ${tipo === 'venta' ? 'fiar' : 'pagar después'} primero elija ${tipo === 'venta' ? 'un cliente' : 'un proveedor'} de su lista.`); st.method = null; st.credit = true; s4(); };
  };

  const s4 = () => {
    const how = st.credit ? (tipo === 'venta' ? '📒 FIADO (queda pendiente)' : '📒 LO PAGA DESPUÉS') : `${st.method.icon} ${st.method.label}`;
    const el = fShell(word.t, `<div class="fconf"><p class="fbigtext">Revise antes de guardar:</p><div class="fcard">${st.lines.map((l) => `<div class="frev"><span>${qty(l.qty)} × ${esc(l.p.name)}</span><b>${money(calc(l).total)}</b></div>`).join('')}
      <div class="frev tot"><span>TOTAL</span><b>${money(total())}</b></div></div><p class="fbigtext">${tipo === 'venta' ? 'Cliente' : 'Proveedor'}: <b>${esc(st.third ? st.third.name : 'Mostrador')}</b></p><p class="fbigtext">Pago: <b>${how}</b></p>
      <button class="fbig go" id="yes">✅ SÍ, GUARDAR ${tipo === 'venta' ? 'LA VENTA' : 'LA COMPRA'}</button><button class="fbig sec" id="no">⬅ CORREGIR</button></div>`);
    $('#no').onclick = s3;
    $('#yes').onclick = (e) => fSafe(e.target, async () => {
      const t = total();
      const doc = await api('POST', '/documents', {
        type: tipo, date: todayStr(), due_date: st.credit ? new Date(Date.now() + 15 * 86400000).toLocaleDateString('sv') : todayStr(), third_id: st.third ? st.third.id : null,
        lines: st.lines.map((l) => ({ product_id: l.p.id, qty: l.qty, price: l.price, disc_pct: l.disc || 0, ...(lots ? { lot: l.lot, expiry: l.expiry || null } : {}) })),
        pay_now: st.credit ? 0 : t, pay_account: st.method ? st.method.code : undefined,
      });
      const einv = tipo === 'venta' && S.cfg.einv_provider && S.cfg.einv_provider !== 'none';
      fOk(tipo === 'venta' ? '¡Venta registrada!' : '¡Compra registrada!', [`${esc(doc.number)} · <b>${money(doc.total)}</b>`, st.credit ? `Quedó pendiente de ${tipo === 'venta' ? 'cobro' : 'pago'}.` : 'Pagada.'], [
        { label: '🖨️ IMPRIMIR / VER FACTURA', cls: 'go', fn: () => showDoc(doc.id) },
        ...(einv ? [{ label: '🧾 ENVIAR A LA DIAN', fn: async function () { try { const r = await api('POST', `/documents/${doc.id}/einvoice`); fError(r.status === 'aceptada' ? 'Factura electrónica aceptada ✔' : `Estado: ${r.status}. ${r.message || ''}`); } catch (er) { fError(er.message); } } }] : []),
        { label: tipo === 'venta' ? '➕ NUEVA VENTA' : '➕ OTRA COMPRA', fn: () => { location.hash = '#f/' + (tipo === 'venta' ? 'vender' : 'comprar'); render(); } }, { label: '🏠 INICIO', fn: fHome },
      ]);
    });
  };
  s1();
}
FACIL.vender = () => carrito('venta');
FACIL.comprar = () => carrito('compra');

/* ----- gasto ----- */
FACIL.gasto = async () => {
  const accs = await api('GET', '/accounts').catch(() => []), has = (c) => accs.some((a) => a.code === c && a.active);
  const GC = { ARRIENDO: 'morado', 'LUZ Y AGUA': 'ambar', 'INTERNET / TELÉFONO': 'turquesa', 'SUELDOS / NÓMINA': 'azul', TRANSPORTE: 'naranja', PUBLICIDAD: 'rosa', 'OTRO GASTO': 'gris' };
  const cats = [['🏠', 'ARRIENDO', '512010'], ['💡', 'LUZ Y AGUA', '513525'], ['📶', 'INTERNET / TELÉFONO', '513535'], ['👷', 'SUELDOS / NÓMINA', '510506'], ['🚚', 'TRANSPORTE', '513550'], ['📣', 'PUBLICIDAD', '519505'], ['🧰', 'OTRO GASTO', S.cfg.acc_gastos_diversos || '519595']].filter((c) => has(c[2]) || c[1] === 'OTRO GASTO');
  const st = {};
  const s1 = () => { const el = fShell('Registrar un gasto', `<p class="fbigtext">¿En qué gastó?</p><div class="fgrid">${cats.map((c, i) => `<button class="fbig c-${GC[c[1]]}" data-i="${i}"><span class="fi">${c[0]}</span>${c[1]}</button>`).join('')}</div>`); $$('[data-i]', el).forEach((b) => (b.onclick = () => { st.cat = cats[+b.dataset.i]; s2(); })); };
  const s2 = () => {
    const el = fShell('Registrar un gasto', `<p class="fbigtext">${st.cat[0]} ${st.cat[1]}</p><p class="fbigtext">¿Cuánto pagó?</p><input class="fnum" id="amt" inputmode="decimal" placeholder="Escriba el valor" autofocus><input class="fsearch" id="nota" placeholder="Nota (opcional)"><button class="fbig go" id="n">SIGUIENTE ➡</button>`);
    $('#n').onclick = () => { const v = round2(parseFloat(String($('#amt').value).replace(',', '.'))); if (!(v > 0)) return fError('Escriba cuánto pagó.'); st.amount = v; st.nota = $('#nota').value.trim(); s3(); };
  };
  const s3 = () => { const el = fShell('Registrar un gasto', `<p class="fbigtext">${st.cat[1]}: <b>${money(st.amount)}</b></p><p class="fbigtext">¿Cómo lo pagó?</p>${methodButtons()}`); $$('[data-m]', el).forEach((b) => (b.onclick = () => { st.method = payMethods().find((m) => m.key === b.dataset.m); s4(); })); };
  const s4 = () => {
    const el = fShell('Registrar un gasto', `<div class="fconf"><p class="fbigtext">Va a registrar este gasto:</p><div class="fcard"><div class="fname">${st.cat[0]} ${st.cat[1]}</div><div class="famount">${money(st.amount)}</div><div class="fsub">Pagado con ${st.method.icon} ${st.method.label}${st.nota ? ' · ' + esc(st.nota) : ''}</div></div>
      <button class="fbig go" id="yes">✅ SÍ, REGISTRAR</button><button class="fbig sec" id="no">⬅ CORREGIR</button></div>`);
    $('#no').onclick = s3;
    $('#yes').onclick = (e) => fSafe(e.target, async () => {
      await api('POST', '/documents', { type: 'gasto', date: todayStr(), lines: [{ description: st.cat[1] + (st.nota ? ' - ' + st.nota : ''), qty: 1, price: st.amount, account_code: st.cat[2], tax_id: '' }], pay_now: st.amount, pay_account: st.method.code });
      fOk('¡Gasto registrado!', [`${esc(st.cat[1])}: <b>${money(st.amount)}</b>`], [{ label: '➕ OTRO GASTO', cls: 'go', fn: () => { location.hash = '#f/gasto'; render(); } }, { label: '🏠 INICIO', fn: fHome }]);
    });
  };
  s1();
};

/* ----- clientes ----- */
FACIL.clientes = async () => {
  const thirds = (await api('GET', '/thirds?kind=cliente')).filter((t) => !/mostrador|consumidor/i.test(t.name));
  const el = fShell('Mis clientes', `<input class="fsearch" id="fq" placeholder="🔍 Buscar cliente…" autocomplete="off"><button class="fbig c-turquesa" id="new">➕ CLIENTE NUEVO</button><div id="fl"></div>`);
  const draw = () => {
    const q = $('#fq').value.trim().toLowerCase(), list = thirds.filter((t) => !q || (t.name + ' ' + (t.company || '') + ' ' + (t.phone || '')).toLowerCase().includes(q));
    $('#fl').innerHTML = list.length ? list.map((t, i) => `<button class="fpick" data-i="${i}"><b>${esc(t.name)}</b>${t.company ? `<small>${esc(t.company)}</small>` : ''}${t.phone ? `<small>📞 ${esc(t.phone)}</small>` : ''}${t.receivable > 0 ? `<small class="bad">Le debe ${money(t.receivable)}</small>` : '<small>Al día ✔</small>'}</button>`).join('') : '<div class="fempty">No encuentro ese cliente.</div>';
    $$('#fl [data-i]').forEach((b) => (b.onclick = () => fCliente(list[+b.dataset.i])));
  };
  $('#fq').oninput = draw; draw();
  $('#new').onclick = () => {
    const close = modal('Cliente nuevo', `<div class="fconf"><label class="fsub">Nombre</label><input class="fnum" id="nn" autocomplete="off"><label class="fsub">Teléfono</label><input class="fnum" id="np" inputmode="tel" autocomplete="off"><button class="fbig go" id="sv">✅ GUARDAR</button></div>`, {
      onMount: (m) => { $('#sv', m).onclick = (e) => fSafe(e.target, async () => { const n = $('#nn', m).value.trim(); if (!n) throw new Error('Escriba el nombre.'); await api('POST', '/thirds', { kind: 'cliente', name: n, phone: $('#np', m).value.trim() }); close(); toast('Cliente guardado'); render(); }); },
    });
  };
};
async function fCliente(t) {
  const docs = (await api('GET', '/documents?type=venta&pending=1&q=' + encodeURIComponent(t.name))).filter((d) => d.third === t.name).map((d) => ({ ...d, kind: 'venta' }));
  const close = modal(t.name, `<div class="fconf">${t.phone ? `<p class="fbigtext">📞 ${esc(t.phone)}</p>` : ''}<p class="fbigtext">${docs.length ? `Debe: <b class="bad">${money(round2(docs.reduce((s, d) => s + d.total - d.paid, 0)))}</b>` : 'No debe nada ✔'}</p>
    <div id="fd">${docs.map((d, i) => `<div class="fcard"><div class="fsub">${esc(d.number)} · ${esc(d.date)}</div><div class="famount">${money(round2(d.total - d.paid))}</div><button class="fbig c-azul" data-i="${i}">💵 COBRAR</button></div>`).join('')}</div>
    <button class="fbig c-verde" id="sell">🛒 VENDERLE ALGO</button></div>`, { onMount: (m) => { $$('[data-i]', m).forEach((b) => (b.onclick = () => { close(); fPay(docs[+b.dataset.i], 'cobrar'); })); $('#sell', m).onclick = () => { close(); location.hash = '#f/vender'; render(); }; } });
}

/* ----- productos ----- */
FACIL.productos = async () => {
  const products = await api('GET', '/products');
  const el = fShell('Mis productos', `<input class="fsearch" id="fq" placeholder="🔍 Buscar producto o escanear código…" autocomplete="off"><div id="fl"></div><p class="fsub" style="margin-top:1rem">Para cambiar precios o crear productos use “Ver todas las opciones”.</p>`);
  const draw = () => {
    const q = $('#fq').value.trim().toLowerCase(), list = products.filter((p) => !q || (p.name + ' ' + p.code + ' ' + (p.brand || '') + ' ' + (p.barcode || '')).toLowerCase().includes(q)).slice(0, 40);
    $('#fl').innerHTML = list.length ? list.map((p) => { const low = !p.is_service && p.min_stock > 0 && p.stock <= p.min_stock;
      return `<div class="fcard"><div class="fname">${esc(p.name)}</div><div class="fsub">${esc(p.brand || '')} ${esc(p.code)}</div><div class="famount">${money(p.price)}</div>
        <span class="ftag ${p.is_service ? '' : p.stock <= 0 ? 'bad' : low ? 'warn' : 'good'}">${p.is_service ? 'Servicio' : p.stock <= 0 ? 'Sin existencias' : (low ? '⚠ Quedan pocos: ' : 'Quedan ') + qty(p.stock)}</span>${p.next_lot && p.sug && p.sug.pct > 0 ? ` <span class="ftag warn">⏳ vence en ${p.next_lot.days_left} días</span>` : ''}${p.next_lot && p.next_lot.expired ? ' <span class="ftag bad">VENCIDO</span>' : ''}</div>`; }).join('') : '<div class="fempty">No encuentro ese producto.</div>';
  };
  $('#fq').oninput = draw; draw();
};

/* ----- avisos y resumen ----- */
FACIL.alertas = async () => {
  const [d, l] = await Promise.all([api('GET', '/reports/dashboard'), C_lots()]);
  const venc = l.rows.filter((r) => r.status === 'vencido'), por = l.rows.filter((r) => r.status === 'por vencer');
  const card = (r, extra) => `<div class="fcard"><div class="fname">${esc(r.name)}</div><div class="fsub">Lote ${esc(r.lot || '—')} · vence ${esc(r.expiry || '')} · ${qty(r.qty_left)} unidades</div>${extra}</div>`;
  fShell('Avisos', `${venc.length ? `<h2 class="fh2 bad">❌ Productos vencidos</h2><p class="fsub">No los venda. Retírelos del estante.</p>${venc.map((r) => card(r, `<span class="ftag bad">Vencido · ${money(r.value)} perdidos</span>`)).join('')}` : ''}
    ${por.length ? `<h2 class="fh2">⏳ Por vencer: ofrezca descuento</h2>${por.map((r) => card(r, `<div class="famount">${money(r.price)} → <b class="warnc">${r.suggest && r.suggest.pct ? money(r.suggest.price) + ' (−' + r.suggest.pct + '%)' : 'sin margen para descuento'}</b></div><span class="ftag warn">Vence en ${r.days_left} días</span>`)).join('')}` : ''}
    ${d.low_stock.length ? `<h2 class="fh2">📉 Se están acabando</h2>${d.low_stock.map((p) => `<div class="fcard"><div class="fname">${esc(p.name)}</div><span class="ftag bad">Quedan ${qty(p.stock)} (mínimo ${qty(p.min_stock)})</span></div>`).join('')}` : ''}
    ${!venc.length && !por.length && !d.low_stock.length ? '<div class="fempty">🎉 Todo en orden. No hay avisos.</div>' : ''}`);
};
const C_lots = async () => (S.cfg.track_lots === '1' ? api('GET', '/reports/lots?days=90') : { rows: [] });

FACIL.resumen = async () => {
  const d = await api('GET', '/reports/dashboard');
  const k = (icon, label, v, cls = '') => `<div class="fcard fk"><div class="fsub">${icon} ${label}</div><div class="famount ${cls}">${money(v)}</div></div>`;
  const hoy = (await api('GET', '/reports/sales' + qs({ from: todayStr(), to: todayStr(), group: 'dia' }))).totals;
  fShell('¿Cómo voy?', `${k('🛒', 'Vendí hoy', hoy.total)}${k('📅', 'Vendí en lo que va del mes', d.sales_month)}${k('📈', 'Ganancia del mes', d.profit_month, d.profit_month < 0 ? 'bad' : 'good')}
    ${k('💰', 'Dinero que tengo (caja y bancos)', d.cash_total)}${k('👥', 'Me deben los clientes', d.receivable, d.overdue_count ? 'bad' : '')}${d.overdue_count ? `<div class="fsub bad" style="margin:-.3rem 0 1rem">${d.overdue_count} cuentas vencidas por ${money(d.overdue_total)}</div>` : ''}${k('🧾', 'Debo a proveedores', d.payable)}`);
};
