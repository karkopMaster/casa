'use strict';
/* ---------- contabilidad ---------- */
const rangeBar = (extra = '') => `<div class="card"><div class="row"><div><label>Desde</label><input type="date" id="r1" value="${monthStart()}"></div><div><label>Hasta</label><input type="date" id="r2" value="${todayStr()}"></div>${extra}<div class="auto"><button class="btn" id="go">Ver</button></div></div></div><div id="rr"></div>`;
const tabsBar = (base, tabs, cur) => `<div class="tabs">${tabs.map((t) => `<a href="#${base}/${t[0]}" class="${t[0] === cur ? 'on' : ''}">${esc(t[1])}</a>`).join('')}</div>`;
const sectionRows = (title, sec) => `<tr><td colspan="2"><b>${esc(title)}</b></td></tr>${sec.items.map((i) => `<tr><td>${esc(i.code)} · ${esc(i.name)}</td><td class="n">${mneg(i.amount)}</td></tr>`).join('')}<tr><td><b>Total ${esc(title.toLowerCase())}</b></td><td class="n"><b>${mneg(sec.total)}</b></td></tr>`;

VIEWS.contabilidad = async (el, sub) => {
  const tabs = [['plan', 'Plan de cuentas'], ['diario', 'Libro diario'], ['mayor', 'Libro mayor'], ['balanza', 'Balance de prueba'], ['resultados', 'Estado de resultados'], ['balance', 'Balance general']];
  const cur = sub || 'plan';
  el.innerHTML = tabsBar('contabilidad', tabs, cur) + '<div id="ct"></div>';
  const box = $('#ct');
  if (cur === 'plan') {
    setTop('<button class="btn" id="newa">Nueva cuenta</button><button class="btn sec" id="newe">Asiento manual</button>');
    $('#newe').onclick = () => entryForm();
    const load = async () => {
      const rows = await api('GET', '/accounts');
      box.innerHTML = table([{ h: 'Código', k: 'code' }, { h: 'Nombre', k: (a) => a.name + (a.active ? '' : ' (inactiva)') }, { h: 'Tipo', k: 'type' }, { h: 'Naturaleza', k: (a) => (a.nature === 'D' ? 'Débito' : 'Crédito') }], rows, { onclick: 1 });
      $$('#ct tbody tr').forEach((tr) => (tr.onclick = () => accountForm(rows[tr.dataset.i], load)));
    };
    $('#newa').onclick = () => accountForm(null, load);
    return load();
  }
  setTop(cur === 'diario' ? '<button class="btn" id="newe">Asiento manual</button>' : '');
  if ($('#newe')) $('#newe').onclick = () => entryForm(() => $('#go').click());
  if (cur === 'diario') {
    box.innerHTML = rangeBar();
    $('#go').onclick = async () => {
      const r = await api('GET', '/reports/journal' + qs({ from: $('#r1').value, to: $('#r2').value }));
      $('#rr').innerHTML = r.entries.length ? r.entries.map((e) => `<div class="card"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>#${e.number} · ${esc(e.date)} · ${esc(e.description)}</b>
        <span><span class="tag">${esc(e.source)}</span> ${e.source === 'manual' && e.status === 'activo' ? `<button class="btn sm sec" data-ve="${e.id}">Anular</button>` : e.status === 'anulado' ? '<span class="tag err">Anulado</span>' : ''}</span></div>
        ${table([{ h: 'Cuenta', k: (l) => l.account_code + ' · ' + l.account_name }, { h: 'Débito', k: (l) => (l.debit ? l.debit : ''), m: 1 }, { h: 'Crédito', k: (l) => (l.credit ? l.credit : ''), m: 1 }], e.lines)}</div>`).join('') : '<p class="help">No hay asientos en el período.</p>';
      $$('[data-ve]').forEach((b) => (b.onclick = async () => { if (!confirm('¿Anular este asiento? Se crea un contraasiento.')) return; try { await api('POST', `/entries/${b.dataset.ve}/void`, { date: todayStr() }); toast('Anulado'); $('#go').click(); } catch (e) { fail(e); } }));
    };
    return $('#go').click();
  }
  if (cur === 'mayor') {
    const accs = await api('GET', '/accounts');
    box.innerHTML = rangeBar(`<div><label>Cuenta</label><select id="ac">${accs.map((a) => opt(a.code, a.code + ' · ' + a.name)).join('')}</select></div>`);
    $('#go').onclick = async () => {
      const r = await api('GET', '/reports/ledger' + qs({ account: $('#ac').value, from: $('#r1').value, to: $('#r2').value }));
      $('#rr').innerHTML = `<p class="help">Saldo inicial: <b>${money(r.opening)}</b></p>` + table([{ h: 'Fecha', k: 'date' }, { h: 'Asiento', k: 'number', n: 1 }, { h: 'Detalle', k: (l) => l.description + (l.third ? ' · ' + l.third : '') }, { h: 'Débito', k: 'debit', m: 1 }, { h: 'Crédito', k: 'credit', m: 1 }, { h: 'Saldo', k: 'balance', m: 1 }], r.lines,
        { foot: `<td colspan="5">Saldo final</td><td class="n">${money(r.closing)}</td>`, empty: 'Sin movimientos' });
    };
    return $('#go').click();
  }
  if (cur === 'balanza') {
    box.innerHTML = rangeBar();
    $('#go').onclick = async () => {
      const r = await api('GET', '/reports/trial' + qs({ from: $('#r1').value, to: $('#r2').value }));
      setTop('<button class="btn sec" id="csv">Exportar CSV</button>');
      $('#csv').onclick = () => csvDownload('balance-de-prueba.csv', ['Código', 'Cuenta', 'Saldo inicial', 'Débitos', 'Créditos', 'Saldo final'], r.rows.map((x) => [x.code, x.name, x.opening, x.debit, x.credit, x.closing]));
      $('#rr').innerHTML = table([{ h: 'Código', k: 'code' }, { h: 'Cuenta', k: 'name' }, { h: 'Saldo inicial', k: 'opening', m: 1 }, { h: 'Débitos', k: 'debit', m: 1 }, { h: 'Créditos', k: 'credit', m: 1 }, { h: 'Saldo final', k: 'closing', m: 1 }], r.rows,
        { foot: `<td colspan="3">Totales ${r.total_debit === r.total_credit ? '✔ cuadra' : '⚠ no cuadra'}</td><td class="n">${money(r.total_debit)}</td><td class="n">${money(r.total_credit)}</td><td></td>`, empty: 'Sin movimientos' }) + '<p class="help">Saldo final: positivo = deudor, negativo = acreedor.</p>';
    };
    return $('#go').click();
  }
  if (cur === 'resultados') {
    box.innerHTML = rangeBar();
    $('#go').onclick = async () => {
      const r = await api('GET', '/reports/income' + qs({ from: $('#r1').value, to: $('#r2').value }));
      $('#rr').innerHTML = `<div class="card"><div class="tw"><table><tbody>${sectionRows('Ingresos', r.ingresos)}${sectionRows('Costos', r.costos)}<tr><td><b>UTILIDAD BRUTA</b></td><td class="n"><b>${mneg(r.utilidad_bruta)}</b></td></tr>${sectionRows('Gastos', r.gastos)}<tr><td><b>UTILIDAD NETA</b></td><td class="n"><b>${mneg(r.utilidad_neta)}</b></td></tr></tbody></table></div></div>`;
    };
    return $('#go').click();
  }
  if (cur === 'balance') {
    box.innerHTML = `<div class="card"><div class="row"><div><label>Al día</label><input type="date" id="r2" value="${todayStr()}"></div><div class="auto"><button class="btn" id="go">Ver</button></div></div></div><div id="rr"></div>`;
    $('#go').onclick = async () => {
      const r = await api('GET', '/reports/balance' + qs({ to: $('#r2').value }));
      $('#rr').innerHTML = `<div class="grid g2"><div class="card"><div class="tw"><table><tbody>${sectionRows('Activos', r.activo)}</tbody></table></div></div>
        <div class="card"><div class="tw"><table><tbody>${sectionRows('Pasivos', r.pasivo)}${sectionRows('Patrimonio', r.patrimonio)}<tr><td>Resultado acumulado (utilidad)</td><td class="n">${mneg(r.resultado)}</td></tr><tr><td><b>Total pasivo + patrimonio</b></td><td class="n"><b>${money(r.total_pasivo_patrimonio)}</b></td></tr></tbody></table></div></div></div>
        <p class="help">${r.cuadra ? '✔ Activos = Pasivos + Patrimonio' : '⚠ El balance no cuadra'}</p>`;
    };
    return $('#go').click();
  }
};

function accountForm(a, done) {
  a = a || { code: '', name: '', type: 'gasto', active: 1 };
  modal(a.code ? 'Editar cuenta' : 'Nueva cuenta', `<form id="f"><div class="grid g2"><div><label>Código (numérico)</label><input name="code" ${a.code ? 'disabled' : 'required'} value="${esc(a.code)}"></div>
    <div><label>Tipo</label><select name="type" ${a.code ? 'disabled' : ''}>${['activo', 'pasivo', 'patrimonio', 'ingreso', 'costo', 'gasto'].map((t) => opt(t, t, a.type)).join('')}</select></div>
    <div style="grid-column:1/-1"><label>Nombre</label><input name="name" required value="${esc(a.name)}"></div></div>
    ${a.code ? `<p><label><input type="checkbox" name="active" style="width:auto" ${a.active ? 'checked' : ''}> Activa</label></p>` : ''}<button class="btn">Guardar</button></form>`, { small: true, onMount: (el, close) => {
    $('#f', el).onsubmit = async (e) => {
      e.preventDefault(); const b = formData(e.target);
      try { a.code ? await api('PUT', '/accounts/' + a.code, { name: b.name, active: b.active }) : await api('POST', '/accounts', b); toast('Guardado'); close(); done(); } catch (er) { fail(er); }
    };
  } });
}

async function entryForm(done) {
  const accs = (await api('GET', '/accounts')).filter((a) => a.active);
  modal('Asiento manual', `<form id="f"><div class="grid g2"><div><label>Fecha</label><input type="date" name="date" value="${todayStr()}" required></div><div><label>Descripción</label><input name="description" required></div></div>
    <h3>Movimientos</h3><div class="tw"><table class="lines"><thead><tr><th>Cuenta</th><th>Débito</th><th>Crédito</th><th></th></tr></thead><tbody id="el"></tbody>
    <tfoot><tr><td>Totales</td><td class="n" id="td">0</td><td class="n" id="tc">0</td><td></td></tr></tfoot></table></div>
    <p><button type="button" class="btn sec sm" id="add">+ Línea</button></p><p class="help" id="msg"></p><button class="btn">Guardar asiento</button></form>`, { onMount: (el, close) => {
    const body = $('#el', el);
    const add = () => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><select class="ac">${accs.map((a) => opt(a.code, a.code + ' · ' + a.name)).join('')}</select></td><td><input class="d" type="number" step="0.01" min="0"></td><td><input class="c" type="number" step="0.01" min="0"></td><td><button type="button" class="btn sm sec">×</button></td>`;
      $('button', tr).onclick = () => { if (body.children.length > 2) { tr.remove(); sum(); } };
      tr.addEventListener('input', sum); body.appendChild(tr);
    };
    const sum = () => {
      let d = 0, c = 0; for (const tr of body.children) { d += +$('.d', tr).value || 0; c += +$('.c', tr).value || 0; }
      $('#td', el).textContent = money(d); $('#tc', el).textContent = money(c);
      $('#msg', el).textContent = Math.abs(d - c) < 0.005 ? '✔ Cuadrado' : 'Diferencia: ' + money(d - c);
    };
    add(); add(); $('#add', el).onclick = add;
    $('#f', el).onsubmit = async (e) => {
      e.preventDefault(); const f = formData(e.target);
      const lines = [...body.children].map((tr) => ({ account_code: $('.ac', tr).value, debit: +$('.d', tr).value || 0, credit: +$('.c', tr).value || 0 }));
      try { await api('POST', '/entries', { date: f.date, description: f.description, lines }); toast('Asiento guardado'); close(); if (done) done(); } catch (er) { fail(er); }
    };
  } });
}

/* ---------- informes ---------- */
VIEWS.informes = async (el, sub) => {
  const tabs = [['ventas', 'Ventas y utilidad'], ['compras', 'Compras'], ['cxc', 'Cuentas por cobrar'], ['cxp', 'Cuentas por pagar']];
  const cur = sub || 'ventas';
  setTop('');
  el.innerHTML = tabsBar('informes', tabs, cur) + '<div id="ct"></div>';
  const box = $('#ct');
  if (cur === 'ventas' || cur === 'compras') {
    const type = cur === 'ventas' ? 'venta' : 'compra';
    const groups = type === 'venta' ? [['producto', 'Por producto'], ['categoria', 'Por categoría'], ['cliente', 'Por cliente'], ['dia', 'Por día'], ['mes', 'Por mes'], ['marca', 'Por marca'], ['vendedor', 'Por vendedor']] : [['producto', 'Por producto'], ['categoria', 'Por categoría'], ['cliente', 'Por proveedor'], ['dia', 'Por día'], ['mes', 'Por mes'], ['marca', 'Por marca']];
    box.innerHTML = rangeBar(`<div><label>Agrupar</label><select id="gr">${groups.map((g) => opt(g[0], g[1])).join('')}</select></div>`);
    $('#go').onclick = async () => {
      const r = await api('GET', '/reports/sales' + qs({ from: $('#r1').value, to: $('#r2').value, group: $('#gr').value, type }));
      const cols = [{ h: $('#gr').selectedOptions[0].text, k: 'label' }, { h: 'Cantidad', k: 'qty', q: 1 }, { h: type === 'venta' ? 'Ventas' : 'Compras', k: 'sales', m: 1 }];
      if (type === 'venta') cols.push({ h: 'Costo', k: 'cost', m: 1 }, { h: 'Utilidad', k: 'profit', m: 1 }, { h: 'Margen', k: (x) => (x.sales ? Math.round(x.profit / x.sales * 100) + '%' : '—'), n: 1 });
      cols.push({ h: 'Impuestos', k: 'tax', m: 1 }, { h: 'Total', k: 'total', m: 1 });
      const t = r.totals;
      $('#rr').innerHTML = `<div class="actions" style="margin-bottom:8px"><button class="btn sec sm" id="csv">Exportar CSV</button></div>` + table(cols, r.rows, { empty: 'Sin datos en el período',
        foot: `<td>Total</td><td class="n">${qty(t.qty)}</td><td class="n">${money(t.sales)}</td>${type === 'venta' ? `<td class="n">${money(t.cost)}</td><td class="n">${money(t.profit)}</td><td></td>` : ''}<td class="n">${money(t.tax)}</td><td class="n">${money(t.total)}</td>` });
      const c = $('#csv'); if (c) c.onclick = () => csvDownload(`${cur}-${$('#r1').value}-${$('#r2').value}.csv`, cols.map((x) => x.h), r.rows.map((x) => cols.map((cl) => (typeof cl.k === 'function' ? cl.k(x) : x[cl.k]))));
    };
    return $('#go').click();
  }
  const type = cur === 'cxc' ? 'venta' : 'compra';
  const r = await api('GET', '/reports/aging' + qs({ type }));
  const B = [['vigente', 'Vigente'], ['d1_30', '1-30 días'], ['d31_60', '31-60'], ['d61_90', '61-90'], ['d90', '+90']];
  $('#ct').innerHTML = `<div class="actions" style="margin-bottom:8px"><button class="btn sec sm" id="csv">Exportar CSV</button></div>` +
    table([{ h: type === 'venta' ? 'Cliente' : 'Proveedor', k: 'third' }, ...B.map((b) => ({ h: b[1], k: b[0], m: 1 })), { h: 'Total', k: 'total', m: 1 }], r.thirds, { empty: 'No hay saldos pendientes 🎉',
      foot: `<td>Total</td>${B.map((b) => `<td class="n">${money(r.totals[b[0]])}</td>`).join('')}<td class="n">${money(r.totals.total)}</td>` }) +
    `<h3>Detalle de documentos</h3>` + table([{ h: 'Documento', k: 'number' }, { h: 'Tercero', k: 'third' }, { h: 'Fecha', k: 'date' }, { h: 'Vence', k: 'due_date' }, { h: 'Días vencido', k: 'days_overdue', n: 1 }, { h: 'Saldo', k: 'balance', m: 1 }], r.docs, { onclick: 1, empty: '' });
  $$('#ct tbody tr[data-i]').forEach((tr) => (tr.onclick = () => showDoc(r.docs[tr.dataset.i].id, () => render())));
  $('#csv').onclick = () => csvDownload(`${cur}.csv`, ['Documento', 'Tercero', 'Fecha', 'Vence', 'Días vencido', 'Saldo'], r.docs.map((d) => [d.number, d.third, d.date, d.due_date, d.days_overdue, d.balance]));
};

/* ---------- configuración ---------- */
VIEWS.config = async (el, sub) => {
  const tabs = [['empresa', 'Empresa'], ['cuentas', 'Cuentas por defecto'], ['impuestos', 'Impuestos, retenciones y categorías'], ['usuarios', 'Usuarios'], ['respaldo', 'Cierre y respaldo']];
  const cur = sub || 'empresa';
  setTop('');
  el.innerHTML = tabsBar('config', tabs, cur) + '<div id="ct"></div>';
  const box = $('#ct'), c = S.cfg;
  const saveSettings = (form) => async (e) => {
    e.preventDefault();
    const b = formData(e.target);
    for (const k of ['allow_negative_stock', 'use_inventory', 'track_lots']) if (k in b) b[k] = b[k] ? '1' : '0';
    try { await api('PUT', '/settings', b); toast('Guardado'); render(); } catch (er) { fail(er); }
  };
  if (cur === 'empresa') {
    box.innerHTML = `<form class="card" id="f"><div class="grid g2"><div><label>Nombre</label><input name="company_name" value="${esc(c.company_name)}" required></div><div><label>NIT</label><input name="company_nit" value="${esc(c.company_nit)}"></div>
      <div><label>Teléfono</label><input name="company_phone" value="${esc(c.company_phone)}"></div><div><label>Dirección</label><input name="company_address" value="${esc(c.company_address)}"></div>
      <div><label>Símbolo de moneda</label><input name="currency" value="${esc(c.currency)}"></div><div><label>Decimales a mostrar (0 para pesos)</label><input name="decimals" type="number" min="0" max="2" value="${esc(c.decimals ?? 0)}"></div>
      <div><label>Resolución DIAN / régimen (se imprime bajo el nombre)</label><input name="dian_text" value="${esc(c.dian_text)}" placeholder="Ej: Resolución 18764… · No responsable de IVA"></div><div><label>Pie de la factura</label><input name="print_footer" value="${esc(c.print_footer)}"></div>
      <div><label>Prefijo ventas</label><input name="pfx_venta" value="${esc(c.pfx_venta)}"></div><div><label>Prefijo compras</label><input name="pfx_compra" value="${esc(c.pfx_compra)}"></div><div><label>Prefijo gastos</label><input name="pfx_gasto" value="${esc(c.pfx_gasto)}"></div></div>
      <p><label><input type="checkbox" name="use_inventory" style="width:auto" ${c.use_inventory === '1' ? 'checked' : ''}> Manejo inventario de productos</label>
       <label><input type="checkbox" name="track_lots" style="width:auto" ${c.track_lots === '1' ? 'checked' : ''}> Controlar lotes y fechas de vencimiento (primero en vencer, primero en salir)</label>
      <label><input type="checkbox" name="allow_negative_stock" style="width:auto" ${c.allow_negative_stock === '1' ? 'checked' : ''}> Permitir vender sin existencias</label></p><button class="btn">Guardar</button></form>`;
    $('#f').onsubmit = saveSettings();
  } else if (cur === 'cuentas') {
    const accs = await api('GET', '/accounts');
    const roles = [['acc_caja', 'Caja'], ['acc_bancos', 'Bancos'], ['acc_cxc', 'Clientes por cobrar'], ['acc_cxp', 'Proveedores por pagar'], ['acc_inventario', 'Inventario'], ['acc_iva_compras', 'Impuesto en compras (descontable)'],
      ['acc_iva_ventas', 'Impuesto en ventas (por pagar)'], ['acc_ingresos', 'Ingresos por ventas'], ['acc_costo_ventas', 'Costo de ventas'], ['acc_capital', 'Capital (inventario inicial)'], ['acc_ajuste_inv', 'Ajustes de inventario'], ['acc_gastos_compras', 'Compras de servicios/no inventario'], ['acc_gastos_diversos', 'Gastos por defecto']];
    box.innerHTML = `<form class="card" id="f"><p class="help">Estas cuentas se usan para generar los asientos automáticamente. Puede cambiarlas para adaptar el sistema a su plan contable.</p><div class="grid g2">${roles.map((r) => `<div><label>${r[1]}</label><select name="${r[0]}">${accs.filter((a) => a.active).map((a) => opt(a.code, a.code + ' · ' + a.name, c[r[0]])).join('')}</select></div>`).join('')}</div><p><button class="btn">Guardar</button></p></form>`;
    $('#f').onsubmit = saveSettings();
  } else if (cur === 'impuestos') {
    const accsAll = (await api('GET', '/accounts')).filter((a) => a.active);
    box.innerHTML = `<div class="grid g2"><div class="card"><h2>Impuestos</h2>${table([{ h: 'Nombre', k: 'name' }, { h: 'Tarifa %', k: 'rate', n: 1 }, { h: '', raw: 1, k: (t) => `<button class="btn sm sec" data-dt="${t.id}">Quitar</button>` }], c.taxes)}
      <form id="ft" class="row" style="margin-top:10px"><div><label>Nombre</label><input name="name" required></div><div><label>Tarifa %</label><input name="rate" type="number" step="0.01" min="0" max="100" required></div><div class="auto"><button class="btn">Agregar</button></div></form></div>
      <div class="card"><h2>Categorías de productos</h2>${table([{ h: 'Nombre', k: 'name' }, { h: '', raw: 1, k: (t) => `<button class="btn sm sec" data-dc="${t.id}">Quitar</button>` }], c.categories)}
      <form id="fc" class="row" style="margin-top:10px"><div><label>Nueva categoría</label><input name="name" required></div><div class="auto"><button class="btn">Agregar</button></div></form></div></div>
      <div class="card"><h2>Retenciones</h2><p class="help">Tarifas de ejemplo: confírmelas con su contador (dependen del régimen y del municipio). Se aplican marcándolas al registrar cada compra o venta.</p>
      ${table([{ h: 'Nombre', k: 'name' }, { h: 'Tarifa %', k: 'rate', n: 1 }, { h: 'Sobre', k: (w) => (w.base === 'iva' ? 'IVA' : 'Subtotal') }, { h: 'Aplica a', k: 'applies' }, { h: 'Cuenta', k: 'account_code' }, { h: '', raw: 1, k: (w) => `<button class="btn sm sec" data-dw="${w.id}">Quitar</button>` }], c.withholdings || [])}
      <form id="fw" class="row" style="margin-top:10px"><div><label>Nombre</label><input name="name" required></div><div><label>Tarifa %</label><input name="rate" type="number" step="0.001" min="0" max="100" required></div>
      <div><label>Sobre</label><select name="base"><option value="subtotal">Subtotal</option><option value="iva">IVA</option></select></div><div><label>Aplica a</label><select name="applies"><option value="compra">Compras (nosotros retenemos)</option><option value="venta">Ventas (nos retienen)</option></select></div>
      <div><label>Cuenta contable</label><select name="account_code">${accsAll.map((a) => opt(a.code, a.code + ' · ' + a.name)).join('')}</select></div><div class="auto"><button class="btn">Agregar</button></div></form></div>`;
    $('#fw').onsubmit = async (e) => { e.preventDefault(); try { await api('POST', '/withholdings', formData(e.target)); render(); } catch (er) { fail(er); } };
    $$('[data-dw]').forEach((b) => (b.onclick = async () => { try { await api('DELETE', '/withholdings/' + b.dataset.dw); render(); } catch (er) { fail(er); } }));
    $('#ft').onsubmit = async (e) => { e.preventDefault(); try { await api('POST', '/taxes', formData(e.target)); render(); } catch (er) { fail(er); } };
    $('#fc').onsubmit = async (e) => { e.preventDefault(); try { await api('POST', '/categories', formData(e.target)); render(); } catch (er) { fail(er); } };
    $$('[data-dt]').forEach((b) => (b.onclick = async () => { try { await api('DELETE', '/taxes/' + b.dataset.dt); render(); } catch (er) { fail(er); } }));
    $$('[data-dc]').forEach((b) => (b.onclick = async () => { try { await api('DELETE', '/categories/' + b.dataset.dc); render(); } catch (er) { fail(er); } }));
  } else if (cur === 'usuarios') {
    const users = await api('GET', '/users');
    box.innerHTML = `<div class="card">${table([{ h: 'Usuario', k: 'username' }, { h: 'Nombre', k: 'name' }, { h: 'Rol', k: 'role' }, { h: 'Activo', k: (u) => (u.active ? 'Sí' : 'No') }], users, { onclick: 1 })}</div>
      <form class="card" id="f"><h2>Nuevo usuario</h2><div class="grid g4"><div><label>Usuario</label><input name="username" required></div><div><label>Nombre</label><input name="name"></div><div><label>Contraseña (8+)</label><input name="password" type="password" minlength="8" required></div>
      <div><label>Rol</label><select name="role"><option value="vendedor">Vendedor (ventas y cobros)</option><option value="contador">Contador (todo menos configuración)</option><option value="admin">Administrador</option></select></div></div><p><button class="btn">Crear</button></p></form>`;
    $('#f').onsubmit = async (e) => { e.preventDefault(); try { await api('POST', '/users', formData(e.target)); toast('Usuario creado'); render(); } catch (er) { fail(er); } };
    $$('#ct tbody tr').forEach((tr) => (tr.onclick = () => {
      const u = users[tr.dataset.i];
      modal('Editar ' + u.username, `<form id="g"><div class="grid g2"><div><label>Nombre</label><input name="name" value="${esc(u.name)}"></div><div><label>Rol</label><select name="role">${['vendedor', 'contador', 'admin'].map((r) => opt(r, r, u.role)).join('')}</select></div>
        <div><label>Nueva contraseña (opcional)</label><input name="password" type="password" minlength="8"></div><div><label><input type="checkbox" name="active" style="width:auto" ${u.active ? 'checked' : ''}> Activo</label></div></div><p><button class="btn">Guardar</button></p></form>`, { small: true, onMount: (m, close) => {
        $('#g', m).onsubmit = async (e) => { e.preventDefault(); const b = formData(e.target); if (!b.password) delete b.password; try { await api('PUT', '/users/' + u.id, b); toast('Guardado'); close(); render(); } catch (er) { fail(er); } };
      } });
    }));
  } else {
    box.innerHTML = `<form class="card" id="f"><h2>Cierre de período</h2><p class="help">No se podrán registrar ni anular movimientos con fecha igual o anterior a la fecha de cierre. Déjela vacía para no bloquear.</p>
      <div class="row"><div><label>Cerrado hasta</label><input type="date" name="lock_date" value="${esc(c.lock_date)}"></div><div class="auto"><button class="btn">Guardar</button></div></div></form>
      <div class="card"><h2>Copia de seguridad</h2><p class="help">Descargue una copia completa de su base de datos. Guárdela en un lugar seguro con regularidad.</p><button class="btn" id="bk">Descargar copia</button></div>`;
    $('#f').onsubmit = saveSettings();
    $('#bk').onclick = async () => {
      try {
        const r = await fetch('/api/backup', { headers: { Authorization: 'Bearer ' + S.token } });
        if (!r.ok) throw new Error((await r.json()).error);
        const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'contabilidad-' + todayStr() + '.db'; a.click();
      } catch (e) { fail(e); }
    };
  }
};
