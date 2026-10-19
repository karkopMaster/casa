'use strict';
/* ---------- utilidades ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { token: null, user: null, cfg: {} };
try { S.token = localStorage.getItem('token'); } catch (_) {}
const todayStr = () => new Date().toLocaleDateString('sv');
const monthStart = () => todayStr().slice(0, 8) + '01';
const money = (n) => (S.cfg.currency || '$') + ' ' + Number(n || 0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n) => Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 4 });
const mneg = (n) => `<span class="${n < 0 ? 'neg' : ''}">${money(n)}</span>`;
const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const TYPE_NAME = { venta: 'Venta', compra: 'Compra', gasto: 'Gasto' };

async function api(method, path, body) {
  const r = await fetch('/api' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await r.json(); } catch (_) {}
  if (!r.ok) {
    if (r.status === 401 && S.token) { S.token = null; try { localStorage.removeItem('token'); } catch (_) {} render(); }
    throw new Error((data && data.error) || 'Error ' + r.status);
  }
  return data;
}
const qs = (o) => '?' + new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''))).toString();

function toast(msg, err) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 3000);
}
const fail = (e) => toast(e.message || String(e), true);

function modal(title, html, { small = false, onMount } = {}) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${small ? 'sm' : ''}" role="dialog" aria-modal="true"><div class="mh noprint"><h2>${esc(title)}</h2><button class="x" aria-label="Cerrar">×</button></div><div class="mb">${html}</div></div>`;
  const close = () => ov.remove();
  $('.x', ov).onclick = close;
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) ov._down = true; });
  ov.addEventListener('mouseup', (e) => { if (e.target === ov && ov._down) close(); ov._down = false; });
  document.body.appendChild(ov);
  if (onMount) onMount($('.mb', ov), close);
  return close;
}
function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else o[el.name] = el.value;
  }
  return o;
}
const opt = (v, t, sel) => `<option value="${esc(v)}" ${String(sel) === String(v) ? 'selected' : ''}>${esc(t)}</option>`;

function table(cols, rows, { foot, empty = 'Sin datos', onclick } = {}) {
  const cell = (c, r) => { const v = typeof c.k === 'function' ? c.k(r) : r[c.k]; return c.raw ? v : c.m ? mneg(v) : c.q ? qty(v) : esc(v); };
  if (!rows.length) return `<p class="help">${esc(empty)}</p>`;
  return `<div class="tw"><table><thead><tr>${cols.map((c) => `<th class="${c.m || c.q || c.n ? 'n' : ''}">${esc(c.h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) =>
    `<tr ${onclick ? `class="click" data-i="${i}"` : ''}>${cols.map((c) => `<td class="${c.m || c.q || c.n ? 'n' : ''}">${cell(c, r)}</td>`).join('')}</tr>`).join('')}</tbody>${foot ? `<tfoot><tr>${foot}</tr></tfoot>` : ''}</table></div>`;
}
function csvDownload(name, head, rows) {
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const txt = '﻿' + [head, ...rows].map((r) => r.map(q).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const can = (...roles) => roles.includes(S.user.role);

/* ---------- navegación ---------- */
const NAV = [
  ['inicio', 'Inicio', ['admin', 'contador', 'vendedor']],
  ['ventas', 'Ventas', ['admin', 'contador', 'vendedor']],
  ['compras', 'Compras', ['admin', 'contador']],
  ['gastos', 'Gastos', ['admin', 'contador']],
  ['clientes', 'Clientes', ['admin', 'contador', 'vendedor']],
  ['proveedores', 'Proveedores', ['admin', 'contador']],
  ['productos', 'Productos y servicios', ['admin', 'contador', 'vendedor']],
  ['inventario', 'Inventario', ['admin', 'contador']],
  ['contabilidad', 'Contabilidad', ['admin', 'contador']],
  ['informes', 'Informes', ['admin', 'contador']],
  ['config', 'Configuración', ['admin']],
];
const VIEWS = {};
function route() { const [v, sub] = (location.hash.slice(1) || 'inicio').split('/'); return { v, sub }; }

async function render() {
  const app = $('#app');
  let st;
  try { st = await api('GET', '/status'); } catch (e) { app.innerHTML = `<div class="center"><div class="card">No se pudo conectar con el servidor.</div></div>`; return; }
  if (!st.setup) return renderSetup(app);
  if (!S.token) return renderLogin(app);
  try { const me = await api('GET', '/me'); S.user = me.user; S.cfg = me.settings; } catch (e) { return renderLogin(app); }
  const { v, sub } = route();
  const nav = NAV.filter((n) => n[2].includes(S.user.role));
  const cur = nav.find((n) => n[0] === v) || nav[0];
  app.innerHTML = `<div class="shell"><nav class="side" id="side"><div class="brand">${esc(S.cfg.company_name)}</div>
    ${nav.map((n) => `<a href="#${n[0]}" class="${n[0] === cur[0] ? 'on' : ''}">${esc(n[1])}</a>`).join('')}
    <div class="who">${esc(S.user.name)}<br><span class="mut">${esc(S.user.role)}</span><br><a href="#" id="pw" style="padding:4px 0">Cambiar contraseña</a><a href="#" id="out" style="padding:4px 0">Cerrar sesión</a></div></nav>
    <main class="main"><div class="top"><div style="display:flex;gap:10px;align-items:center"><button class="btn sec burger" id="burger" aria-label="Menú">☰</button><h1 id="title">${esc(cur[1])}</h1></div><div id="topbtn" class="actions"></div></div><div id="view">Cargando…</div></main></div>`;
  $('#burger').onclick = () => $('#side').classList.toggle('open');
  $$('#side a[href^="#"]').forEach((a) => a.addEventListener('click', () => $('#side').classList.remove('open')));
  $('#out').onclick = async (e) => { e.preventDefault(); try { await api('POST', '/logout'); } catch (_) {} S.token = null; try { localStorage.removeItem('token'); } catch (_) {} render(); };
  $('#pw').onclick = (e) => { e.preventDefault(); changePassword(); };
  try { await VIEWS[cur[0]]($('#view'), sub); } catch (e) { $('#view').innerHTML = `<div class="card neg">${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', render);

function renderSetup(app) {
  app.innerHTML = `<div class="center"><form class="card auth" id="f"><h1>Bienvenido 👋</h1><p class="help">Configure su empresa en un minuto. Todo se puede cambiar después.</p>
  <div class="grid g2"><div><label>Nombre de la empresa *</label><input name="company_name" required></div><div><label>NIT / identificación</label><input name="company_nit"></div>
  <div><label>Teléfono</label><input name="company_phone"></div><div><label>Dirección</label><input name="company_address"></div></div>
  <h3>¿Cómo funciona su negocio?</h3>
  <select name="profile"><option value="comercio">Compro y vendo productos (tienda, distribuidora, ferretería…)</option><option value="mixto">Productos y servicios (taller, restaurante, ISP…)</option><option value="servicios">Solo servicios (sin inventario)</option></select>
  <div class="grid g3" style="margin-top:10px"><div><label>Símbolo de moneda</label><input name="currency" value="$"></div><div><label>Impuesto (nombre)</label><input name="tax_name" value="IVA"></div><div><label>Tarifa % (0 = sin impuesto)</label><input name="tax_rate" type="number" step="0.01" min="0" max="100" value="19"></div></div>
  <h3>Administrador</h3><div class="grid g3"><div><label>Su nombre</label><input name="admin_name"></div><div><label>Usuario *</label><input name="username" required autocomplete="username"></div><div><label>Contraseña (8+) *</label><input name="password" type="password" minlength="8" required autocomplete="new-password"></div></div>
  <p><button class="btn" style="width:100%">Crear mi sistema</button></p></form></div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('POST', '/setup', formData(e.target)); toast('¡Listo! Ahora ingrese.'); render(); } catch (er) { fail(er); }
  };
}
function renderLogin(app) {
  app.innerHTML = `<div class="center"><form class="card auth" id="f"><h1>Ingresar</h1><p><label>Usuario</label><input name="username" required autofocus autocomplete="username"></p>
  <p><label>Contraseña</label><input name="password" type="password" required autocomplete="current-password"></p><p><button class="btn" style="width:100%">Entrar</button></p></form></div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api('POST', '/login', formData(e.target)); S.token = r.token; try { localStorage.setItem('token', r.token); } catch (_) {} location.hash = ''; render(); } catch (er) { fail(er); }
  };
}
function changePassword() {
  modal('Cambiar contraseña', `<form id="f"><p><label>Contraseña actual</label><input name="current" type="password" required></p><p><label>Nueva contraseña (8+)</label><input name="password" type="password" minlength="8" required></p><button class="btn">Guardar</button></form>`, {
    small: true, onMount: (el, close) => { $('#f', el).onsubmit = async (e) => { e.preventDefault(); try { await api('POST', '/me/password', formData(e.target)); toast('Contraseña actualizada'); close(); } catch (er) { fail(er); } }; },
  });
}
const setTop = (html) => { $('#topbtn').innerHTML = html || ''; };

/* ---------- inicio ---------- */
VIEWS.inicio = async (el) => {
  if (!can('admin', 'contador')) {
    const rows = await api('GET', '/reports/my-sales');
    el.innerHTML = `<div class="card"><h2>Mis ventas recientes</h2>${table([{ h: 'Fecha', k: 'date' }, { h: 'Ventas', k: 'n', n: 1 }, { h: 'Total', k: 'total', m: 1 }], rows, { empty: 'Aún no ha registrado ventas' })}</div>`;
    setTop('<a class="btn" href="#ventas/nueva">Nueva venta</a>'); return;
  }
  const d = await api('GET', '/reports/dashboard');
  setTop('<a class="btn" href="#ventas/nueva">Nueva venta</a>');
  const max = Math.max(1, ...d.daily.map((x) => x.v));
  el.innerHTML = `<div class="grid g4" style="margin-bottom:16px">
    <div class="kpi"><div class="l">Ventas del mes</div><div class="v">${money(d.sales_month)}</div><div class="help">${d.sales_count} facturas</div></div>
    <div class="kpi"><div class="l">Compras del mes</div><div class="v">${money(d.purchases_month)}</div></div>
    <div class="kpi"><div class="l">Utilidad del mes</div><div class="v ${d.profit_month < 0 ? 'neg' : ''}">${money(d.profit_month)}</div></div>
    <div class="kpi"><div class="l">Caja y bancos</div><div class="v">${money(d.cash_total)}</div></div>
    <div class="kpi"><div class="l">Por cobrar (clientes)</div><div class="v">${money(d.receivable)}</div><div class="help ${d.overdue_count ? 'neg' : ''}">${d.overdue_count} vencidas · ${money(d.overdue_total)}</div></div>
    <div class="kpi"><div class="l">Por pagar (proveedores)</div><div class="v">${money(d.payable)}</div></div>
    <div class="kpi"><div class="l">Inventario valorizado</div><div class="v">${money(d.inventory_value)}</div></div>
    <div class="kpi"><div class="l">Productos con poco stock</div><div class="v ${d.low_stock.length ? 'neg' : ''}">${d.low_stock.length}</div></div></div>
  <div class="grid g2"><div class="card"><h2>Ventas últimos 30 días</h2>${d.daily.length ? `<div class="bars">${d.daily.map((x) => `<div title="${esc(x.date)}: ${esc(money(x.v))}" style="height:${Math.round(x.v / max * 100)}%"></div>`).join('')}</div>` : '<p class="help">Sin ventas en el período.</p>'}</div>
  <div class="card"><h2>Más vendidos del mes</h2>${table([{ h: 'Producto', k: 'label' }, { h: 'Cant.', k: 'qty', q: 1 }, { h: 'Ventas', k: 'sales', m: 1 }], d.top_products, { empty: 'Sin ventas este mes' })}</div></div>
  ${d.low_stock.length ? `<div class="card"><h2>⚠ Reabastecer</h2>${table([{ h: 'Código', k: 'code' }, { h: 'Producto', k: 'name' }, { h: 'Existencia', k: 'stock', q: 1 }, { h: 'Mínimo', k: 'min_stock', q: 1 }], d.low_stock)}</div>` : ''}
  <div class="card"><h2>Caja y bancos</h2>${table([{ h: 'Cuenta', k: (r) => r.code + ' · ' + r.name }, { h: 'Saldo', k: 'balance', m: 1 }], d.cash)}</div>`;
};

/* ---------- documentos: ventas / compras / gastos ---------- */
function docView(type) {
  return async (el, sub) => {
    if (sub === 'nueva') return docForm(el, type);
    const plural = { venta: 'ventas', compra: 'compras', gasto: 'gastos' }[type];
    setTop(`<button class="btn" id="new">Nueva ${type}</button>`);
    $('#new').onclick = () => { location.hash = plural + '/nueva'; };
    el.innerHTML = `<div class="card"><div class="row"><div><label>Desde</label><input type="date" id="f1" value="${monthStart()}"></div><div><label>Hasta</label><input type="date" id="f2" value="${todayStr()}"></div>
      <div><label>Buscar</label><input id="fq" placeholder="Número o nombre"></div><div class="auto"><label><input type="checkbox" id="fp" style="width:auto"> Solo con saldo</label></div>
      <div class="auto"><button class="btn sec" id="go">Filtrar</button></div></div></div><div id="list"></div>`;
    const load = async () => {
      const rows = await api('GET', '/documents' + qs({ type, from: $('#f1').value, to: $('#f2').value, q: $('#fq').value, pending: $('#fp').checked ? '1' : '' }));
      const tot = rows.filter((r) => r.status === 'activo').reduce((s, r) => s + r.total, 0);
      $('#list').innerHTML = table([{ h: 'Número', k: 'number' }, { h: 'Fecha', k: 'date' }, { h: type === 'venta' ? 'Cliente' : 'Proveedor', k: (r) => r.third || '—' },
        { h: 'Total', k: 'total', m: 1 }, { h: 'Saldo', k: (r) => (r.status === 'activo' ? round2(r.total - r.paid) : 0), m: 1 },
        { h: 'Estado', k: (r) => (r.status === 'anulado' ? '<span class="tag err">Anulado</span>' : r.total - r.paid > 0.004 ? (r.due_date < todayStr() ? '<span class="tag err">Vencido</span>' : '<span class="tag warn">Pendiente</span>') : '<span class="tag ok">Pagado</span>'), raw: 1 }],
      rows, { empty: 'No hay documentos en este filtro', onclick: 1, foot: `<td colspan="3">Total (sin anulados)</td><td class="n">${money(tot)}</td><td colspan="2"></td>` });
      $$('#list tbody tr').forEach((tr) => (tr.onclick = () => showDoc(rows[tr.dataset.i].id, load)));
    };
    $('#go').onclick = () => load().catch(fail);
    await load();
  };
}
VIEWS.ventas = docView('venta'); VIEWS.compras = docView('compra'); VIEWS.gastos = docView('gasto');

async function showDoc(id, reload) {
  const d = await api('GET', '/documents/' + id);
  const c = S.cfg;
  const html = `<div class="printable"><div class="inv-head"><div><h2 style="margin:0">${esc(c.company_name)}</h2><div class="help">${esc(c.company_nit)} ${esc(c.company_address)} ${esc(c.company_phone)}</div></div>
    <div style="text-align:right"><h2 style="margin:0">${TYPE_NAME[d.type].toUpperCase()} ${esc(d.number)}</h2><div>${esc(d.date)} ${d.status === 'anulado' ? '<span class="tag err">ANULADO</span>' : ''}</div><div class="help">Vence: ${esc(d.due_date)}</div></div></div>
    <p><b>${d.type === 'venta' ? 'Cliente' : 'Proveedor'}:</b> ${esc(d.third_name || '—')} ${esc(d.third_doc || '')}<br><span class="help">${esc(d.third_address || '')} ${esc(d.third_phone || '')}</span></p>
    ${table([{ h: 'Descripción', k: 'description' }, { h: 'Cant.', k: 'qty', q: 1 }, { h: 'Precio', k: 'price', m: 1 }, { h: 'Desc %', k: 'disc_pct', n: 1 }, { h: 'Imp. %', k: 'tax_rate', n: 1 }, { h: 'Total', k: 'total', m: 1 }], d.lines)}
    <div class="totals"><div><span>Subtotal</span><span>${money(d.subtotal)}</span></div>${d.discount ? `<div><span>Descuentos incluidos</span><span>${money(d.discount)}</span></div>` : ''}<div><span>Impuestos</span><span>${money(d.tax)}</span></div>
    <div class="big"><span>Total</span><span>${money(d.total)}</span></div><div><span>Pagado</span><span>${money(d.paid)}</span></div><div><b>Saldo</b><b>${money(d.balance)}</b></div></div>
    ${d.notes ? `<p class="help">${esc(d.notes)}</p>` : ''}</div>
    ${d.payments.length ? `<h3 class="noprint">Cobros / pagos</h3><div class="noprint">${table([{ h: 'Fecha', k: 'date' }, { h: 'Cuenta', k: 'account_name' }, { h: 'Valor', k: 'amount', m: 1 }, { h: 'Estado', k: 'status' },
      { h: '', raw: 1, k: (p) => (p.status === 'activo' && can('admin', 'contador') ? `<button class="btn sm sec" data-vp="${p.id}">Anular</button>` : '') }], d.payments)}</div>` : ''}
    <div class="actions noprint" style="margin-top:14px"><button class="btn sec" id="prt">Imprimir</button>
    ${d.status === 'activo' && d.balance > 0.004 ? `<button class="btn" id="pay">${d.type === 'venta' ? 'Registrar cobro' : 'Registrar pago'}</button>` : ''}
    ${d.status === 'activo' && can('admin', 'contador') ? '<button class="btn danger" id="void">Anular documento</button>' : ''}</div>`;
  modal(`${TYPE_NAME[d.type]} ${d.number}`, html, { onMount: (el, close) => {
    $('#prt', el).onclick = () => window.print();
    const done = () => { close(); if (reload) reload(); };
    const pay = $('#pay', el); if (pay) pay.onclick = () => payForm(d, () => { close(); showDoc(id, reload); if (reload) reload(); });
    const vd = $('#void', el); if (vd) vd.onclick = async () => {
      if (!confirm('¿Anular este documento? Se revertirán inventario y contabilidad.')) return;
      try { await api('POST', `/documents/${id}/void`, { date: todayStr() }); toast('Documento anulado'); done(); } catch (e) { fail(e); }
    };
    $$('[data-vp]', el).forEach((b) => (b.onclick = async () => {
      if (!confirm('¿Anular este ' + (d.type === 'venta' ? 'cobro' : 'pago') + '?')) return;
      try { await api('POST', `/payments/${b.dataset.vp}/void`, { date: todayStr() }); toast('Anulado'); close(); showDoc(id, reload); if (reload) reload(); } catch (e) { fail(e); }
    }));
  } });
}

function payForm(d, done) {
  const accs = S.cfg.pay_accounts;
  modal(d.type === 'venta' ? 'Registrar cobro' : 'Registrar pago', `<form id="f"><p class="help">${esc(d.number)} · saldo ${money(d.balance)}</p>
    <div class="grid g2"><div><label>Valor</label><input name="amount" type="number" step="0.01" min="0.01" max="${d.balance}" value="${d.balance}" required></div><div><label>Fecha</label><input name="date" type="date" value="${todayStr()}" required></div>
    <div><label>${d.type === 'venta' ? 'Entra a' : 'Sale de'}</label><select name="account_code">${accs.map((a) => opt(a.code, a.code + ' · ' + a.name)).join('')}</select></div><div><label>Nota</label><input name="notes"></div></div>
    <p><button class="btn">Guardar</button></p></form>`, { small: true, onMount: (el, close) => {
    $('#f', el).onsubmit = async (e) => {
      e.preventDefault();
      try { await api('POST', '/payments', { ...formData(e.target), doc_id: d.id }); toast('Registrado'); close(); done(); } catch (er) { fail(er); }
    };
  } });
}

async function docForm(el, type) {
  const [products, thirds] = await Promise.all([api('GET', '/products'), api('GET', '/thirds' + qs({ kind: type === 'venta' ? 'cliente' : 'proveedor' }))]);
  const accounts = type === 'gasto' ? (await api('GET', '/accounts')).filter((a) => ['gasto', 'costo'].includes(a.type) && a.active) : [];
  const taxes = S.cfg.taxes, accs = S.cfg.pay_accounts;
  const plural = { venta: 'ventas', compra: 'compras', gasto: 'gastos' }[type];
  setTop('<a class="btn sec" href="#' + plural + '">← Volver</a>');
  const useInv = S.cfg.use_inventory === '1';
  el.innerHTML = `<form class="card" id="f"><div class="grid g4">
    <div><label>${type === 'venta' ? 'Cliente' : 'Proveedor'}</label><select name="third_id"><option value="">— ${type === 'venta' ? 'Mostrador (solo contado)' : 'Sin proveedor (solo contado)'} —</option>${thirds.map((t) => opt(t.id, t.name + (t.company ? ' · ' + t.company : ''))).join('')}</select></div>
    <div><label>Fecha</label><input type="date" name="date" value="${todayStr()}" required></div>
    <div><label>Vencimiento</label><input type="date" name="due_date" value="${todayStr()}"></div>
    <div><label>${type === 'venta' ? 'Referencia' : 'N.º factura del proveedor'}</label><input name="${type === 'venta' ? 'ref' : 'number'}"></div></div>
    <h3>Detalle</h3><div class="tw"><table class="lines"><thead><tr><th style="min-width:210px">${type === 'gasto' ? 'Concepto' : 'Producto / servicio'}</th>${type === 'gasto' ? '<th style="min-width:170px">Cuenta</th>' : ''}<th>Cant.</th><th>Precio</th><th>Desc %</th><th>Impuesto</th><th class="n">Total</th><th></th></tr></thead><tbody id="lines"></tbody></table></div>
    <p><button type="button" class="btn sec sm" id="addl">+ Agregar línea</button></p>
    <div class="grid g2"><div><div class="grid g2"><div><label>Forma de pago</label><select id="pm"><option value="contado">Contado</option><option value="credito">Crédito</option><option value="parcial">Abono parcial</option></select></div>
      <div><label>Abono / pago inicial</label><input id="paynow" type="number" step="0.01" min="0" value="0"></div></div>
      <div style="margin-top:10px"><label>${type === 'venta' ? 'Entra a' : 'Sale de'}</label><select name="pay_account">${accs.map((a) => opt(a.code, a.code + ' · ' + a.name)).join('')}</select></div>
      <div style="margin-top:10px"><label>Notas</label><textarea name="notes" rows="2"></textarea></div></div>
    <div class="totals" id="tot"></div></div>
    <p><button class="btn" id="save">Guardar ${type}</button></p></form><datalist id="plist">${products.map((p) => `<option value="${esc(p.code + ' · ' + p.name)}">`).join('')}</datalist>`;
  const byLabel = new Map(products.map((p) => [p.code + ' · ' + p.name, p]));
  const body = $('#lines');
  const taxOpts = (sel) => `<option value="">Sin impuesto</option>${taxes.map((t) => opt(t.id, t.name, sel)).join('')}`;
  const addLine = () => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input class="prod" list="plist" placeholder="${type === 'gasto' ? 'Describa el gasto' : 'Busque por código o nombre'}"></td>
      ${type === 'gasto' ? `<td><select class="acc">${accounts.map((a) => opt(a.code, a.code + ' · ' + a.name, '5195')).join('')}</select></td>` : ''}
      <td><input class="qty" type="number" step="any" min="0" value="1" style="width:80px"></td><td><input class="price" type="number" step="any" min="0" value="0" style="width:110px"></td>
      <td><input class="disc" type="number" step="any" min="0" max="100" value="0" style="width:70px"></td><td><select class="tax">${taxOpts(taxes.length ? '' : '')}</select></td><td class="n tl">0</td><td><button type="button" class="btn sm sec rm" aria-label="Quitar">×</button></td>`;
    body.appendChild(tr);
    $('.rm', tr).onclick = () => { if (body.children.length > 1) { tr.remove(); calc(); } };
    $('.prod', tr).addEventListener('change', (e) => {
      const p = byLabel.get(e.target.value);
      if (p) { tr._p = p; $('.price', tr).value = type === 'venta' ? p.price : (p.cost || 0); if (p.tax_id) $('.tax', tr).value = p.tax_id; if (type !== 'gasto') { /* descripción = producto */ } calc(); }
      else tr._p = null;
    });
    tr.addEventListener('input', calc);
    return tr;
  };
  const lineVals = () => [...body.children].map((tr) => {
    const rate = (taxes.find((t) => String(t.id) === $('.tax', tr).value) || { rate: 0 }).rate;
    const q = +$('.qty', tr).value || 0, pr = +$('.price', tr).value || 0, dc = +$('.disc', tr).value || 0;
    const base = round2(q * pr - q * pr * dc / 100);
    return { tr, q, pr, dc, base, tax: round2(base * rate / 100) };
  });
  function calc() {
    const L = lineVals();
    let sub = 0, tax = 0;
    for (const l of L) { sub += l.base; tax += l.tax; $('.tl', l.tr).textContent = money(l.base + l.tax); }
    sub = round2(sub); tax = round2(tax); const total = round2(sub + tax);
    $('#tot').innerHTML = `<div><span>Subtotal</span><span>${money(sub)}</span></div><div><span>Impuestos</span><span>${money(tax)}</span></div><div class="big"><span>Total</span><span>${money(total)}</span></div>`;
    el._total = total;
    const pm = $('#pm').value;
    if (pm === 'contado') $('#paynow').value = total; else if (pm === 'credito') $('#paynow').value = 0;
    $('#paynow').disabled = pm !== 'parcial';
  }
  $('#pm').onchange = calc; addLine(); calc();
  $('#addl').onclick = () => { addLine().querySelector('.prod').focus(); };
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const lines = lineVals().map((l) => {
      const label = $('.prod', l.tr).value;
      const p = l.tr._p && byLabel.get(label) ? l.tr._p : null;
      const o = { qty: l.q, price: l.pr, disc_pct: l.dc, tax_id: $('.tax', l.tr).value || '' };
      if (p) o.product_id = p.id; else o.description = label;
      if (type === 'gasto') o.account_code = $('.acc', l.tr).value;
      return o;
    });
    const body = { type, date: f.date, due_date: f.due_date || f.date, third_id: f.third_id || null, notes: f.notes, ref: f.ref, number: f.number, lines, pay_account: f.pay_account, pay_now: +$('#paynow').value || 0 };
    $('#save').disabled = true;
    try { const d = await api('POST', '/documents', body); toast(`${TYPE_NAME[type]} ${d.number} guardada`); location.hash = plural; setTimeout(() => showDoc(d.id), 300); }
    catch (er) { fail(er); $('#save').disabled = false; }
  };
}

/* ---------- terceros ---------- */
function thirdsView(kind) {
  return async (el) => {
    setTop('<button class="btn" id="new">Nuevo</button>');
    el.innerHTML = `<div class="card"><div class="row"><div><input id="q" placeholder="Buscar por nombre, empresa o documento"></div><div class="auto"><button class="btn sec" id="imp">Importar CSV</button></div></div></div><div id="list"></div>`;
    const load = async () => {
      const rows = await api('GET', '/thirds' + qs({ kind, q: $('#q').value }));
      $('#list').innerHTML = table([{ h: 'Nombre', k: 'name' }, { h: 'Empresa', k: (r) => r.company || '' }, { h: 'Documento', k: (r) => r.doc_id || '' }, { h: 'Teléfono', k: (r) => r.phone || '' },
        { h: kind === 'cliente' ? 'Nos debe' : 'Le debemos', k: kind === 'cliente' ? 'receivable' : 'payable', m: 1 }], rows, { onclick: 1, empty: 'Sin registros' });
      $$('#list tbody tr').forEach((tr) => (tr.onclick = () => thirdForm(rows[tr.dataset.i], kind, load)));
    };
    $('#q').oninput = () => load().catch(fail);
    $('#new').onclick = () => thirdForm(null, kind, load);
    $('#imp').onclick = () => importCsv('terceros', ['name', 'company', 'doc_id', 'email', 'phone', 'address', 'kind'], 'name;company;doc_id;email;phone;address;kind', load);
    await load();
  };
}
function thirdForm(t, kind, done) {
  t = t || { kind, name: '' };
  modal(t.id ? 'Editar' : 'Nuevo ' + (kind === 'cliente' ? 'cliente' : 'proveedor'), `<form id="f"><div class="grid g2">
    <div><label>Nombre *</label><input name="name" required value="${esc(t.name)}"></div><div><label>Empresa</label><input name="company" value="${esc(t.company)}"></div>
    <div><label>Documento / NIT</label><input name="doc_id" value="${esc(t.doc_id)}"></div><div><label>Tipo</label><select name="kind">${opt('cliente', 'Cliente', t.kind)}${opt('proveedor', 'Proveedor', t.kind)}${opt('ambos', 'Cliente y proveedor', t.kind)}</select></div>
    <div><label>Email</label><input name="email" type="email" value="${esc(t.email)}"></div><div><label>Teléfono</label><input name="phone" value="${esc(t.phone)}"></div>
    <div style="grid-column:1/-1"><label>Dirección</label><input name="address" value="${esc(t.address)}"></div></div>
    ${t.id ? `<p><label><input type="checkbox" name="active" style="width:auto" ${t.active ? 'checked' : ''}> Activo</label></p>` : ''}
    <div class="actions"><button class="btn">Guardar</button>${t.id ? '<button type="button" class="btn sec" id="hist">Ver movimientos</button>' : ''}</div></form>`, { onMount: (el, close) => {
    $('#f', el).onsubmit = async (e) => {
      e.preventDefault(); const b = formData(e.target); if (t.id && b.active === undefined) b.active = true;
      try { t.id ? await api('PUT', '/thirds/' + t.id, b) : await api('POST', '/thirds', b); toast('Guardado'); close(); done(); } catch (er) { fail(er); }
    };
    const h = $('#hist', el);
    if (h) h.onclick = async () => {
      const r = await api('GET', `/thirds/${t.id}/statement`);
      modal('Movimientos de ' + r.third.name, table([{ h: 'Tipo', k: 'type' }, { h: 'Número', k: 'number' }, { h: 'Fecha', k: 'date' }, { h: 'Total', k: 'total', m: 1 }, { h: 'Pagado', k: 'paid', m: 1 }, { h: 'Estado', k: 'status' }], r.docs, { empty: 'Sin movimientos' }));
    };
  } });
}
VIEWS.clientes = thirdsView('cliente'); VIEWS.proveedores = thirdsView('proveedor');

/* ---------- importación CSV ---------- */
function parseCsv(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  const sep = first.includes(';') ? ';' : first.includes('\t') ? '\t' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
function importCsv(what, fields, example, done) {
  modal('Importar desde CSV / Excel', `<p class="help">Guarde su hoja de Excel como <b>CSV</b> y pegue o cargue el archivo. La primera fila debe tener los encabezados:<br><code>${esc(example)}</code></p>
    <p><input type="file" id="file" accept=".csv,.txt"></p><p><textarea id="txt" rows="8" placeholder="o pegue aquí el contenido"></textarea></p><p><button class="btn" id="go">Importar</button></p><div id="res"></div>`, { onMount: (el, close) => {
    $('#file', el).onchange = async (e) => { $('#txt', el).value = await e.target.files[0].text(); };
    $('#go', el).onclick = async () => {
      const rows = parseCsv($('#txt', el).value.replace(/^﻿/, ''));
      if (rows.length < 2) return fail(new Error('Pegue o cargue un archivo con encabezados y al menos una fila'));
      const head = rows[0].map((h) => h.trim().toLowerCase());
      const objs = rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
      try {
        const r = await api('POST', '/import/' + what, { rows: objs });
        $('#res', el).innerHTML = `<p><b>${r.created}</b> creados, <b>${r.updated}</b> actualizados${r.error_count ? `, <b class="neg">${r.error_count}</b> con error` : ''}.</p>${r.errors.map((x) => `<div class="help neg">${esc(x)}</div>`).join('')}`;
        done();
      } catch (er) { fail(er); }
    };
  } });
}

/* ---------- productos e inventario ---------- */
VIEWS.productos = async (el) => {
  const editor = can('admin', 'contador');
  setTop(editor ? '<button class="btn" id="new">Nuevo</button>' : '');
  el.innerHTML = `<div class="card"><div class="row"><div><input id="q" placeholder="Buscar por código o nombre"></div>${editor ? '<div class="auto"><button class="btn sec" id="imp">Importar CSV</button></div>' : ''}</div></div><div id="list"></div>`;
  const load = async () => {
    const rows = await api('GET', '/products' + qs({ q: $('#q').value, all: editor ? '1' : '' }));
    const cols = [{ h: 'Código', k: 'code' }, { h: 'Nombre', k: (r) => r.name + (r.active ? '' : ' (inactivo)') }, { h: 'Categoría', k: (r) => r.category || '' },
      { h: 'Precio', k: 'price', m: 1 }, { h: 'Existencia', k: (r) => (r.is_service ? 'Servicio' : qty(r.stock) + ' ' + esc(r.unit || '')), raw: 1, n: 1 }];
    if (editor) cols.push({ h: 'Costo prom.', k: 'cost', m: 1 });
    $('#list').innerHTML = table(cols, rows, { onclick: editor, empty: 'Sin productos' });
    if (editor) $$('#list tbody tr').forEach((tr) => (tr.onclick = () => productForm(rows[tr.dataset.i], load)));
  };
  $('#q').oninput = () => load().catch(fail);
  if (editor) {
    $('#new').onclick = () => productForm(null, load);
    $('#imp').onclick = () => importCsv('productos', [], 'code;name;category;unit;price;min_stock;stock;cost  (stock y cost cargan inventario inicial)', load);
  }
  await load();
};
function productForm(p, done) {
  p = p || { code: '', name: '', unit: 'und', price: 0, min_stock: 0, is_service: S.cfg.use_inventory !== '1' ? 1 : 0, active: 1 };
  const cats = S.cfg.categories, taxes = S.cfg.taxes;
  modal(p.id ? 'Editar producto' : 'Nuevo producto o servicio', `<form id="f"><div class="grid g3">
    <div><label>Código *</label><input name="code" required value="${esc(p.code)}"></div><div style="grid-column:span 2"><label>Nombre *</label><input name="name" required value="${esc(p.name)}"></div>
    <div><label>Categoría</label><select name="category_id"><option value="">—</option>${cats.map((c) => opt(c.id, c.name, p.category_id)).join('')}</select></div>
    <div><label>Unidad</label><input name="unit" value="${esc(p.unit)}"></div><div><label>Impuesto</label><select name="tax_id"><option value="">Sin impuesto</option>${taxes.map((t) => opt(t.id, t.name, p.tax_id)).join('')}</select></div>
    <div><label>Precio de venta</label><input name="price" type="number" step="any" min="0" value="${p.price}"></div><div><label>Stock mínimo</label><input name="min_stock" type="number" step="any" min="0" value="${p.min_stock}"></div>
    <div><label>Tipo</label><select name="is_service">${opt(0, 'Producto (con inventario)', p.is_service ? 1 : 0)}${opt(1, 'Servicio (sin inventario)', p.is_service ? 1 : 0)}</select></div></div>
    ${p.id ? `<p class="help">Existencia: <b>${qty(p.stock)}</b> · Costo promedio: <b>${money(p.cost)}</b></p><p><label><input type="checkbox" name="active" style="width:auto" ${p.active ? 'checked' : ''}> Activo</label></p>` : ''}
    <div class="actions"><button class="btn">Guardar</button>${p.id && !p.is_service ? '<button type="button" class="btn sec" id="adj">Ajustar existencias</button>' : ''}</div></form>`, { onMount: (el, close) => {
    $('#f', el).onsubmit = async (e) => {
      e.preventDefault(); const b = formData(e.target); b.is_service = b.is_service === '1'; if (p.id && b.active === undefined) b.active = true;
      try { p.id ? await api('PUT', '/products/' + p.id, b) : await api('POST', '/products', b); toast('Guardado'); close(); done(); } catch (er) { fail(er); }
    };
    const a = $('#adj', el); if (a) a.onclick = () => { close(); adjustForm(p, done); };
  } });
}
function adjustForm(p, done) {
  modal('Ajustar existencias · ' + p.name, `<form id="f"><p class="help">Existencia actual: <b>${qty(p.stock)}</b>. Use cantidad positiva para sumar y negativa para restar.</p><div class="grid g2">
    <div><label>Motivo</label><select name="kind">${opt('inicial', 'Inventario inicial')}${opt('ajuste', 'Ajuste (pérdida, conteo, regalo…)')}</select></div><div><label>Fecha</label><input type="date" name="date" value="${todayStr()}"></div>
    <div><label>Cantidad (+/−)</label><input name="qty" type="number" step="any" required></div><div><label>Costo unitario (para sumar)</label><input name="unit_cost" type="number" step="any" min="0" value="${p.cost || ''}"></div></div>
    <p><label>Nota</label><input name="notes"></p><button class="btn">Aplicar</button></form>`, { small: true, onMount: (el, close) => {
    $('#f', el).onsubmit = async (e) => { e.preventDefault(); try { await api('POST', '/products/adjust', { ...formData(e.target), product_id: p.id }); toast('Existencias ajustadas'); close(); done(); } catch (er) { fail(er); } };
  } });
}

VIEWS.inventario = async (el, sub) => {
  const tabs = [['valorizado', 'Existencias valorizadas'], ['kardex', 'Kardex']];
  const cur = sub || 'valorizado';
  el.innerHTML = `<div class="tabs">${tabs.map((t) => `<a href="#inventario/${t[0]}" class="${t[0] === cur ? 'on' : ''}">${t[1]}</a>`).join('')}</div><div id="in"></div>`;
  const box = $('#in');
  if (cur === 'valorizado') {
    const r = await api('GET', '/reports/inventory');
    setTop('<button class="btn sec" id="csv">Exportar CSV</button>');
    $('#csv').onclick = () => csvDownload('inventario.csv', ['Código', 'Producto', 'Categoría', 'Existencia', 'Costo', 'Valor'], r.rows.map((x) => [x.code, x.name, x.category, x.stock, x.cost, x.value]));
    box.innerHTML = table([{ h: 'Código', k: 'code' }, { h: 'Producto', k: 'name' }, { h: 'Categoría', k: (x) => x.category || '' }, { h: 'Existencia', k: 'stock', q: 1 }, { h: 'Costo prom.', k: 'cost', m: 1 }, { h: 'Valor', k: 'value', m: 1 },
      { h: '', raw: 1, k: (x) => (x.min_stock > 0 && x.stock <= x.min_stock ? '<span class="tag err">Bajo mínimo</span>' : '') }], r.rows, { foot: `<td colspan="5">Valor total del inventario</td><td class="n">${money(r.total_value)}</td><td></td>`, empty: 'No hay productos con inventario' });
  } else {
    setTop('');
    const prods = (await api('GET', '/products')).filter((p) => !p.is_service);
    box.innerHTML = `<div class="card"><div class="row"><div><label>Producto</label><select id="kp">${prods.map((p) => opt(p.id, p.code + ' · ' + p.name)).join('')}</select></div>
      <div><label>Desde</label><input type="date" id="k1" value="${monthStart()}"></div><div><label>Hasta</label><input type="date" id="k2" value="${todayStr()}"></div><div class="auto"><button class="btn" id="go">Ver</button></div></div></div><div id="kr"></div>`;
    const go = async () => {
      if (!$('#kp').value) { $('#kr').innerHTML = '<p class="help">No hay productos con inventario.</p>'; return; }
      const k = await api('GET', '/reports/kardex' + qs({ product_id: $('#kp').value, from: $('#k1').value, to: $('#k2').value }));
      $('#kr').innerHTML = `<p class="help">Saldo inicial: <b>${qty(k.opening_qty)}</b> und · ${money(k.opening_value)}</p>` + table([{ h: 'Fecha', k: 'date' }, { h: 'Movimiento', k: 'kind' }, { h: 'Doc.', k: (m) => m.doc_number || '' }, { h: 'Cantidad', k: 'qty', q: 1 }, { h: 'Costo unit.', k: 'unit_cost', m: 1 }, { h: 'Valor', k: 'value', m: 1 }, { h: 'Saldo cant.', k: 'bal_qty', q: 1 }, { h: 'Saldo valor', k: 'bal_value', m: 1 }], k.moves, { empty: 'Sin movimientos en el período' });
    };
    $('#go').onclick = () => go().catch(fail); await go();
  }
};
