'use strict';
// Informes contables y de gestión. Los asientos anulados se compensan con su contraasiento,
// por eso los informes suman todos los asientos sin filtrar por estado.
const C = require('./core');
const { round2, num, today, needDate, bad } = C;

const BEGIN = '0000-01-01', END = '9999-12-31';

function range(q) {
  const from = q.from ? needDate(q.from, 'fecha inicial') : BEGIN;
  const to = q.to ? needDate(q.to, 'fecha final') : END;
  if (from > to) throw bad('La fecha inicial es posterior a la final');
  return { from, to };
}

function accountBalances(db, from, to) {
  const rows = db.prepare(`
    SELECT a.code, a.name, a.type, a.nature, a.active,
      COALESCE(SUM(CASE WHEN e.date < :d1 THEN l.debit - l.credit END), 0) opening,
      COALESCE(SUM(CASE WHEN e.date >= :d1 AND e.date <= :d2 THEN l.debit END), 0) debit,
      COALESCE(SUM(CASE WHEN e.date >= :d1 AND e.date <= :d2 THEN l.credit END), 0) credit
    FROM accounts a
    LEFT JOIN journal_lines l ON l.account_code = a.code
    LEFT JOIN journal_entries e ON e.id = l.entry_id
    GROUP BY a.code ORDER BY a.code`).all({ d1: from, d2: to });
  for (const r of rows) {
    r.opening = round2(r.opening); r.debit = round2(r.debit); r.credit = round2(r.credit);
    r.closing = round2(r.opening + r.debit - r.credit); // saldo deudor (+) / acreedor (−)
  }
  return rows;
}
const natural = (r, v) => (r.nature === 'D' ? v : -v);

function trialBalance(db, q) {
  const { from, to } = range(q);
  const rows = accountBalances(db, from, to).filter((r) => r.opening || r.debit || r.credit || r.closing);
  const tot = rows.reduce((t, r) => ({ debit: t.debit + r.debit, credit: t.credit + r.credit }), { debit: 0, credit: 0 });
  return { from, to, rows, total_debit: round2(tot.debit), total_credit: round2(tot.credit) };
}

function incomeStatement(db, q) {
  const { from, to } = range(q);
  const rows = accountBalances(db, from, to).filter((r) => ['ingreso', 'costo', 'gasto'].includes(r.type) && (r.debit || r.credit));
  const sect = (type) => {
    const items = rows.filter((r) => r.type === type).map((r) => ({ code: r.code, name: r.name, amount: round2(natural(r, r.debit - r.credit)) }));
    return { items, total: round2(items.reduce((s, i) => s + i.amount, 0)) };
  };
  const ingresos = sect('ingreso'), costos = sect('costo'), gastos = sect('gasto');
  return { from, to, ingresos, costos, utilidad_bruta: round2(ingresos.total - costos.total), gastos, utilidad_neta: round2(ingresos.total - costos.total - gastos.total) };
}

function balanceSheet(db, q) {
  const to = q.to ? needDate(q.to, 'fecha') : today();
  const rows = accountBalances(db, BEGIN, to);
  const sect = (type) => {
    const items = rows.filter((r) => r.type === type && r.closing).map((r) => ({ code: r.code, name: r.name, amount: round2(natural(r, r.closing)) }));
    return { items, total: round2(items.reduce((s, i) => s + i.amount, 0)) };
  };
  const activo = sect('activo'), pasivo = sect('pasivo'), patrimonio = sect('patrimonio');
  const resultado = round2(rows.filter((r) => ['ingreso', 'costo', 'gasto'].includes(r.type)).reduce((s, r) => s - r.closing, 0));
  const totalPP = round2(pasivo.total + patrimonio.total + resultado);
  return { to, activo, pasivo, patrimonio, resultado, total_pasivo_patrimonio: totalPP, cuadra: Math.abs(activo.total - totalPP) < 0.01 };
}

function ledger(db, q) {
  const { from, to } = range(q);
  const acc = db.prepare('SELECT * FROM accounts WHERE code=?').get(String(q.account || ''));
  if (!acc) throw bad('Seleccione una cuenta');
  const opening = round2(db.prepare(`SELECT COALESCE(SUM(l.debit-l.credit),0) v FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
    WHERE l.account_code=? AND e.date<?`).get(acc.code, from).v);
  const lines = db.prepare(`SELECT e.id entry_id, e.number, e.date, e.description, l.debit, l.credit, l.memo, t.name third
    FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id LEFT JOIN thirds t ON t.id=l.third_id
    WHERE l.account_code=? AND e.date>=? AND e.date<=? ORDER BY e.date, e.id, l.id`).all(acc.code, from, to);
  let bal = opening;
  for (const l of lines) { bal = round2(bal + l.debit - l.credit); l.balance = natural(acc, bal); }
  return { account: acc, from, to, opening: natural(acc, opening), lines, closing: natural(acc, bal) };
}

function journal(db, q) {
  const { from, to } = range(q);
  const entries = db.prepare('SELECT * FROM journal_entries WHERE date>=? AND date<=? ORDER BY date, id').all(from, to);
  const stmt = db.prepare(`SELECT l.*, a.name account_name FROM journal_lines l JOIN accounts a ON a.code=l.account_code WHERE entry_id=? ORDER BY l.id`);
  for (const e of entries) e.lines = stmt.all(e.id);
  return { from, to, entries };
}

function salesReport(db, q) {
  const { from, to } = range(q);
  const groups = {
    producto: ["COALESCE(p.code || ' · ' || p.name, l.description)", 'p.name'],
    categoria: ["COALESCE(c.name, 'Sin categoría')", 'c.name'],
    cliente: ["COALESCE(t.name, 'Sin cliente')", 't.name'],
    dia: ['d.date', 'd.date'],
    mes: ["substr(d.date,1,7)", "substr(d.date,1,7)"],
    marca: ["COALESCE(p.brand, 'Sin marca')", 'p.brand'],
    vendedor: ["COALESCE(u.name, '—')", 'u.name'],
  };
  const g = groups[q.group] || groups.producto;
  const type = q.type === 'compra' ? 'compra' : 'venta';
  const rows = db.prepare(`SELECT ${g[0]} label, ROUND(SUM(l.qty),4) qty, ROUND(SUM(l.base),2) sales, ROUND(SUM(l.qty*l.unit_cost),2) cost,
      ROUND(SUM(l.base - l.qty*l.unit_cost),2) profit, ROUND(SUM(l.tax_amount),2) tax, ROUND(SUM(l.total),2) total
    FROM doc_lines l JOIN documents d ON d.id=l.doc_id LEFT JOIN products p ON p.id=l.product_id LEFT JOIN categories c ON c.id=p.category_id
    LEFT JOIN thirds t ON t.id=d.third_id LEFT JOIN users u ON u.id=d.user_id
    WHERE d.type=? AND d.status='activo' AND d.date>=? AND d.date<=? GROUP BY label ORDER BY ${q.group === 'dia' || q.group === 'mes' ? 'label' : 'sales DESC'}`).all(type, from, to);
  const tot = rows.reduce((t, r) => ({ qty: t.qty + r.qty, sales: t.sales + r.sales, cost: t.cost + r.cost, profit: t.profit + r.profit, tax: t.tax + r.tax, total: t.total + r.total }), { qty: 0, sales: 0, cost: 0, profit: 0, tax: 0, total: 0 });
  for (const k of Object.keys(tot)) tot[k] = round2(tot[k]);
  return { from, to, group: q.group || 'producto', type, rows, totals: tot };
}

function agingReport(db, q) {
  const type = q.type === 'compra' ? 'compra' : 'venta';
  const asOf = q.to ? needDate(q.to, 'fecha') : today();
  const docs = db.prepare(`SELECT d.id, d.type, d.number, d.date, d.due_date, d.total, d.paid, ROUND(d.total-d.paid,2) balance, d.third_id, COALESCE(t.name,'Sin tercero') third
    FROM documents d LEFT JOIN thirds t ON t.id=d.third_id WHERE d.type IN (${type === 'venta' ? "'venta'" : "'compra','gasto'"}) AND d.status='activo' AND d.total-d.paid > 0.004
    ORDER BY d.due_date, d.id`).all();
  const buckets = ['vigente', 'd1_30', 'd31_60', 'd61_90', 'd90'];
  const byThird = new Map();
  for (const d of docs) {
    const days = Math.floor((Date.parse(asOf) - Date.parse(d.due_date)) / 86400000);
    d.days_overdue = Math.max(days, 0);
    d.bucket = days <= 0 ? 'vigente' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90';
    let t = byThird.get(d.third_id);
    if (!t) { t = { third_id: d.third_id, third: d.third, total: 0 }; buckets.forEach((b) => (t[b] = 0)); byThird.set(d.third_id, t); }
    t[d.bucket] = round2(t[d.bucket] + d.balance); t.total = round2(t.total + d.balance);
  }
  const thirds = [...byThird.values()].sort((a, b) => b.total - a.total);
  const totals = { total: 0 }; buckets.forEach((b) => (totals[b] = 0));
  for (const t of thirds) { totals.total = round2(totals.total + t.total); buckets.forEach((b) => (totals[b] = round2(totals[b] + t[b]))); }
  return { type, as_of: asOf, thirds, docs, totals };
}

function inventoryReport(db) {
  const rows = db.prepare(`SELECT p.id, p.code, p.name, c.name category, p.unit, p.stock, p.cost, ROUND(p.stock*p.cost,2) value, p.min_stock, p.price
    FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.is_service=0 AND p.active=1 ORDER BY p.name`).all();
  return { rows, total_value: round2(rows.reduce((s, r) => s + r.value, 0)) };
}

// Lotes con existencia, ordenados por vencimiento. days = ventana de "próximos a vencer".
function lotsReport(db, q) {
  const days = Math.max(1, parseInt(q.days, 10) || 90), now = today();
  const limit = new Date(Date.parse(now) + days * 86400000).toISOString().slice(0, 10);
  const rows = db.prepare(`SELECT l.id, l.lot, l.expiry, l.qty_left, l.unit_cost, ROUND(l.qty_left*l.unit_cost,2) value, p.code, p.name, p.brand
    FROM lots l JOIN products p ON p.id=l.product_id WHERE l.qty_left>0 ORDER BY l.expiry IS NULL, l.expiry, p.name`).all();
  for (const r of rows) {
    r.days_left = r.expiry ? Math.floor((Date.parse(r.expiry) - Date.parse(now)) / 86400000) : null;
    r.status = !r.expiry ? 'sin fecha' : r.expiry < now ? 'vencido' : r.expiry <= limit ? 'por vencer' : 'vigente';
  }
  const sum = (st) => round2(rows.filter((r) => r.status === st).reduce((s, r) => s + r.value, 0));
  return { days, rows, expired_value: sum('vencido'), expiring_value: sum('por vencer'), expired_count: rows.filter((r) => r.status === 'vencido').length, expiring_count: rows.filter((r) => r.status === 'por vencer').length };
}

function kardex(db, q) {
  const { from, to } = range(q);
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(num(q.product_id));
  if (!p) throw bad('Seleccione un producto');
  const prev = db.prepare('SELECT bal_qty, bal_value FROM stock_moves WHERE product_id=? AND date<? ORDER BY date DESC, id DESC LIMIT 1').get(p.id, from);
  const moves = db.prepare('SELECT m.*, d.number doc_number FROM stock_moves m LEFT JOIN documents d ON d.id=m.doc_id WHERE m.product_id=? AND m.date>=? AND m.date<=? ORDER BY m.date, m.id').all(p.id, from, to);
  return { product: p, from, to, opening_qty: prev ? prev.bal_qty : 0, opening_value: prev ? prev.bal_value : 0, moves };
}

function dashboard(db) {
  const now = today(), ms = now.slice(0, 8) + '01';
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const sales = one("SELECT COALESCE(SUM(subtotal),0) v, COUNT(*) n FROM documents WHERE type='venta' AND status='activo' AND date>=? AND date<=?", ms, now);
  const purchases = one("SELECT COALESCE(SUM(subtotal),0) v FROM documents WHERE type='compra' AND status='activo' AND date>=? AND date<=?", ms, now);
  const inc = incomeStatement(db, { from: ms, to: now });
  const cash = accountBalances(db, BEGIN, END).filter((r) => r.type === 'activo' && r.code.startsWith('11')).map((r) => ({ code: r.code, name: r.name, balance: r.closing }));
  const cxc = one("SELECT COALESCE(SUM(total-paid),0) v FROM documents WHERE type='venta' AND status='activo'");
  const cxp = one("SELECT COALESCE(SUM(total-paid),0) v FROM documents WHERE type IN ('compra','gasto') AND status='activo'");
  const vencidas = one("SELECT COUNT(*) n, COALESCE(SUM(total-paid),0) v FROM documents WHERE type='venta' AND status='activo' AND total-paid>0.004 AND due_date<?", now);
  const low = db.prepare('SELECT id, code, name, stock, min_stock FROM products WHERE is_service=0 AND active=1 AND stock<=min_stock AND min_stock>0 ORDER BY stock LIMIT 10').all();
  const top = salesReport(db, { from: ms, to: now, group: 'producto' }).rows.slice(0, 5);
  const d30 = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const daily = db.prepare("SELECT date, ROUND(SUM(subtotal),2) v FROM documents WHERE type='venta' AND status='activo' AND date>=? AND date<=? GROUP BY date ORDER BY date").all(d30, now);
  const invValue = inventoryReport(db).total_value;
  const lots = C.lotsOn(db) ? lotsReport(db, { days: 60 }) : null;
  return {
    month_from: ms, sales_month: round2(sales.v), sales_count: sales.n, purchases_month: round2(purchases.v), profit_month: inc.utilidad_neta,
    cash, cash_total: round2(cash.reduce((s, c) => s + c.balance, 0)), receivable: round2(cxc.v), payable: round2(cxp.v),
    overdue_count: vencidas.n, overdue_total: round2(vencidas.v), lots: lots && { expired_count: lots.expired_count, expiring_count: lots.expiring_count, expired_value: lots.expired_value, expiring_value: lots.expiring_value }, low_stock: low, top_products: top, daily, inventory_value: invValue,
  };
}

module.exports = { trialBalance, incomeStatement, balanceSheet, ledger, journal, salesReport, agingReport, inventoryReport, kardex, lotsReport, dashboard };
