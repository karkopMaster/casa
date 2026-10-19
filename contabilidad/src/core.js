'use strict';
// Núcleo contable: configuración, plan de cuentas, asientos de partida doble e inventario (costo promedio).
const crypto = require('crypto');
const { tx } = require('./db');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);

const round2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const round4 = (x) => Math.round((Number(x) + Number.EPSILON) * 10000) / 10000;
const num = (v, def = 0) => { const n = Number(v); return Number.isFinite(n) ? n : def; };

function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
const today = () => new Date().toISOString().slice(0, 10);
function needDate(s, label = 'fecha') { if (!isDate(s)) throw bad(`La ${label} no es válida (use AAAA-MM-DD)`); return s; }

// ---------- configuración ----------
function getSettings(db) {
  const o = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) o[r.key] = r.value;
  return o;
}
function getSetting(db, key, def = '') {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : def;
}
function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value ?? ''));
}
function nextNumber(db, type) {
  const n = parseInt(getSetting(db, 'next_' + type, '1'), 10) || 1;
  setSetting(db, 'next_' + type, n + 1);
  return getSetting(db, 'pfx_' + type, '') + String(n).padStart(5, '0');
}

// ---------- plan de cuentas ----------
const DEFAULT_ACCOUNTS = [
  ['1105', 'Caja', 'activo'], ['1110', 'Bancos', 'activo'], ['1305', 'Clientes (cuentas por cobrar)', 'activo'],
  ['1355', 'IVA descontable (impuesto en compras)', 'activo'], ['1435', 'Inventario de mercancías', 'activo'],
  ['1540', 'Equipo y mobiliario', 'activo'],
  ['2105', 'Obligaciones financieras', 'pasivo'], ['2205', 'Proveedores (cuentas por pagar)', 'pasivo'],
  ['2335', 'Costos y gastos por pagar', 'pasivo'], ['2408', 'IVA generado (impuesto en ventas)', 'pasivo'],
  ['2505', 'Obligaciones laborales', 'pasivo'],
  ['3105', 'Capital social', 'patrimonio'], ['3705', 'Utilidades acumuladas', 'patrimonio'],
  ['4135', 'Ingresos por ventas', 'ingreso'], ['4210', 'Otros ingresos', 'ingreso'],
  ['5105', 'Gastos de personal', 'gasto'], ['5120', 'Arrendamientos', 'gasto'], ['5135', 'Servicios (luz, agua, internet)', 'gasto'],
  ['5195', 'Gastos diversos', 'gasto'], ['5199', 'Ajustes de inventario', 'gasto'], ['5305', 'Gastos financieros', 'gasto'],
  ['6135', 'Costo de ventas', 'costo'],
];
const DEFAULT_ROLES = {
  acc_caja: '1105', acc_bancos: '1110', acc_cxc: '1305', acc_cxp: '2205', acc_inventario: '1435',
  acc_iva_compras: '1355', acc_iva_ventas: '2408', acc_ingresos: '4135', acc_costo_ventas: '6135',
  acc_capital: '3105', acc_ajuste_inv: '5199', acc_gastos_compras: '5135', acc_gastos_diversos: '5195',
};
const natureOf = (type) => (type === 'activo' || type === 'costo' || type === 'gasto' ? 'D' : 'C');
const ACCOUNT_TYPES = ['activo', 'pasivo', 'patrimonio', 'ingreso', 'costo', 'gasto'];

function acct(db, role) {
  const code = getSetting(db, role, DEFAULT_ROLES[role]);
  if (!db.prepare('SELECT 1 FROM accounts WHERE code=?').get(code)) throw bad(`La cuenta configurada para "${role}" (${code}) no existe. Revise Configuración.`);
  return code;
}

// ---------- asientos ----------
function checkLock(db, date) {
  const lock = getSetting(db, 'lock_date', '');
  if (lock && date <= lock) throw bad(`El período está cerrado hasta ${lock}; no se pueden registrar movimientos con fecha ${date}`);
}

function postEntry(db, { date, description, source = 'manual', source_id = null, user_id = null, lines }) {
  needDate(date);
  checkLock(db, date);
  if (!Array.isArray(lines) || lines.length < 2) throw bad('El asiento necesita al menos dos líneas');
  let d = 0, c = 0;
  const clean = [];
  for (const l of lines) {
    const debit = round2(num(l.debit)), credit = round2(num(l.credit));
    if (debit < 0 || credit < 0) throw bad('Los valores del asiento no pueden ser negativos');
    if (debit > 0 && credit > 0) throw bad('Una línea no puede tener débito y crédito a la vez');
    if (debit === 0 && credit === 0) continue;
    const acc = db.prepare('SELECT code, active FROM accounts WHERE code=?').get(String(l.account_code));
    if (!acc) throw bad(`La cuenta ${l.account_code} no existe`);
    if (!acc.active) throw bad(`La cuenta ${l.account_code} está inactiva`);
    d += debit; c += credit;
    clean.push({ account_code: acc.code, third_id: l.third_id || null, debit, credit, memo: l.memo || null });
  }
  if (clean.length < 2) throw bad('El asiento necesita al menos dos líneas con valor');
  if (Math.abs(d - c) > 0.005) throw bad(`El asiento no cuadra: débitos ${round2(d)} ≠ créditos ${round2(c)}`);
  const number = (db.prepare('SELECT COALESCE(MAX(number),0)+1 n FROM journal_entries').get().n);
  const r = db.prepare('INSERT INTO journal_entries(number,date,description,source,source_id,user_id) VALUES(?,?,?,?,?,?)')
    .run(number, date, description || '', source, source_id, user_id);
  const id = Number(r.lastInsertRowid);
  const ins = db.prepare('INSERT INTO journal_lines(entry_id,account_code,third_id,debit,credit,memo) VALUES(?,?,?,?,?,?)');
  for (const l of clean) ins.run(id, l.account_code, l.third_id, l.debit, l.credit, l.memo);
  return id;
}

// Contraasiento: invierte débitos/créditos de los asientos de un origen; ambos quedan en libros (huella de auditoría).
// El llamador garantiza que el origen no se anule dos veces (estado del documento/pago).
function reverseEntries(db, source, source_id, date, description, user_id) {
  const entries = db.prepare("SELECT * FROM journal_entries WHERE source=? AND source_id=? AND status='activo'").all(source, source_id);
  for (const e of entries) {
    const lines = db.prepare('SELECT * FROM journal_lines WHERE entry_id=?').all(e.id)
      .map((l) => ({ account_code: l.account_code, third_id: l.third_id, debit: l.credit, credit: l.debit, memo: 'Anulación' }));
    postEntry(db, { date, description, source: source + '-anul', source_id, user_id, lines });
  }
}

// ---------- inventario (costo promedio ponderado) ----------
function stockIn(db, product, date, kind, qty, unitCost, doc_id, notes, valueOverride) {
  qty = round4(qty);
  const curStock = product.stock, curVal = Math.max(curStock, 0) * product.cost;
  const addVal = valueOverride != null ? round2(valueOverride) : round2(qty * unitCost);
  const newStock = round4(curStock + qty);
  const newVal = curVal + addVal;
  const newCost = newStock > 0 ? round4(newVal / newStock) : unitCost;
  db.prepare('UPDATE products SET stock=?, cost=? WHERE id=?').run(newStock, newCost, product.id);
  db.prepare('INSERT INTO stock_moves(product_id,date,kind,qty,unit_cost,value,bal_qty,bal_value,doc_id,notes) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(product.id, date, kind, qty, unitCost, addVal, newStock, round2(newStock * newCost), doc_id || null, notes || null);
  product.stock = newStock; product.cost = newCost;
  return addVal;
}
// Sale de inventario. Si costOverride se indica (anulaciones) se valora a ese costo.
function stockOut(db, product, date, kind, qty, doc_id, notes, costOverride, valueOverride) {
  qty = round4(qty);
  const unitCost = costOverride ?? product.cost;
  const outVal = valueOverride != null ? round2(valueOverride) : round2(qty * unitCost);
  const newStock = round4(product.stock - qty);
  let newCost = product.cost;
  if (costOverride != null) {
    const v = product.stock * product.cost - outVal;
    newCost = newStock > 0 ? round4(Math.max(v, 0) / newStock) : product.cost;
  }
  db.prepare('UPDATE products SET stock=?, cost=? WHERE id=?').run(newStock, newCost, product.id);
  db.prepare('INSERT INTO stock_moves(product_id,date,kind,qty,unit_cost,value,bal_qty,bal_value,doc_id,notes) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(product.id, date, kind, -qty, unitCost, -outVal, newStock, round2(newStock * newCost), doc_id || null, notes || null);
  product.stock = newStock; product.cost = newCost;
  return outVal;
}

function adjustStock(db, user, b) {
  return tx(db, () => {
    const p = db.prepare('SELECT * FROM products WHERE id=?').get(num(b.product_id));
    if (!p) throw bad('Producto no encontrado');
    if (p.is_service) throw bad('Un servicio no maneja inventario');
    const date = needDate(b.date || today());
    checkLock(db, date);
    const kind = b.kind === 'inicial' ? 'inicial' : 'ajuste';
    const qty = num(b.qty);
    if (!qty) throw bad('Indique la cantidad');
    const inv = acct(db, 'acc_inventario');
    if (qty > 0) {
      const uc = b.unit_cost === undefined || b.unit_cost === '' ? p.cost : num(b.unit_cost);
      if (uc < 0) throw bad('El costo no puede ser negativo');
      if (kind === 'inicial' && !(uc > 0)) throw bad('El inventario inicial requiere costo unitario');
      const val = stockIn(db, p, date, kind, qty, uc, null, b.notes);
      if (val > 0) postEntry(db, { date, description: `${kind === 'inicial' ? 'Inventario inicial' : 'Ajuste de inventario'}: ${p.name}`, source: 'inventario', source_id: p.id, user_id: user.id,
        lines: [{ account_code: inv, debit: val }, { account_code: acct(db, kind === 'inicial' ? 'acc_capital' : 'acc_ajuste_inv'), credit: val }] });
    } else {
      if (kind === 'inicial') throw bad('El inventario inicial solo suma existencias');
      const out = -qty;
      if (p.stock < out && getSetting(db, 'allow_negative_stock', '0') !== '1') throw bad(`Existencia insuficiente de ${p.name} (hay ${p.stock})`);
      const val = stockOut(db, p, date, 'ajuste', out, null, b.notes);
      if (val > 0) postEntry(db, { date, description: `Ajuste de inventario: ${p.name}`, source: 'inventario', source_id: p.id, user_id: user.id,
        lines: [{ account_code: acct(db, 'acc_ajuste_inv'), debit: val }, { account_code: inv, credit: val }] });
    }
    return db.prepare('SELECT * FROM products WHERE id=?').get(p.id);
  });
}

// ---------- seguridad ----------
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function checkPassword(password, salt, hash) {
  const h = crypto.scryptSync(password, salt, 64);
  const b = Buffer.from(hash, 'hex');
  return b.length === h.length && crypto.timingSafeEqual(h, b);
}

// ---------- puesta en marcha ----------
function isSetup(db) { return db.prepare('SELECT COUNT(*) n FROM users').get().n > 0; }

function setupCompany(db, b) {
  if (isSetup(db)) throw new HttpError(409, 'El sistema ya fue configurado');
  const name = String(b.company_name || '').trim();
  const username = String(b.username || '').trim().toLowerCase();
  if (!name) throw bad('Indique el nombre de la empresa');
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw bad('Usuario: 3 a 30 caracteres (letras, números, . _ -)');
  if (String(b.password || '').length < 8) throw bad('La contraseña debe tener al menos 8 caracteres');
  const profile = ['comercio', 'servicios', 'mixto'].includes(b.profile) ? b.profile : 'comercio';
  return tx(db, () => {
    for (const [code, n, type] of DEFAULT_ACCOUNTS)
      db.prepare('INSERT OR IGNORE INTO accounts(code,name,type,nature) VALUES(?,?,?,?)').run(code, n, type, natureOf(type));
    for (const [k, v] of Object.entries(DEFAULT_ROLES)) setSetting(db, k, v);
    const s = {
      company_name: name, company_nit: b.company_nit || '', company_address: b.company_address || '', company_phone: b.company_phone || '',
      currency: String(b.currency || '$').slice(0, 5), profile,
      use_inventory: profile === 'servicios' ? '0' : '1', allow_negative_stock: '0', lock_date: '',
      pfx_venta: 'FV-', pfx_compra: 'FC-', pfx_gasto: 'GA-', next_venta: 1, next_compra: 1, next_gasto: 1,
    };
    for (const [k, v] of Object.entries(s)) setSetting(db, k, v);
    const rate = num(b.tax_rate, 0);
    if (rate > 0) db.prepare('INSERT INTO taxes(name,rate) VALUES(?,?)').run(String(b.tax_name || 'IVA') + ' ' + rate + '%', rate);
    db.prepare('INSERT INTO taxes(name,rate) VALUES(?,?)').run('Sin impuesto', 0);
    db.prepare('INSERT INTO categories(name) VALUES(?)').run('General');
    db.prepare("INSERT INTO thirds(kind,name) VALUES('cliente','Cliente mostrador')").run();
    const { salt, hash } = hashPassword(String(b.password));
    db.prepare("INSERT INTO users(username,name,salt,hash,role) VALUES(?,?,?,?, 'admin')").run(username, String(b.admin_name || username), salt, hash);
  });
}

module.exports = {
  HttpError, bad, round2, round4, num, isDate, today, needDate, getSettings, getSetting, setSetting, nextNumber,
  DEFAULT_ACCOUNTS, DEFAULT_ROLES, ACCOUNT_TYPES, natureOf, acct, checkLock, postEntry, reverseEntries,
  stockIn, stockOut, adjustStock, hashPassword, checkPassword, isSetup, setupCompany,
};
