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
// Plan Único de Cuentas (PUC) colombiano, versión comercial simplificada. Es editable desde la aplicación.
const DEFAULT_ACCOUNTS = [
  ['110505', 'Caja general', 'activo'], ['111005', 'Bancos - moneda nacional', 'activo'],
  ['111010', 'Billeteras digitales (Nequi, Daviplata)', 'activo'], ['111015', 'Datáfono / pasarela de pagos (por liquidar)', 'activo'],
  ['130505', 'Clientes nacionales', 'activo'], ['135515', 'Retención en la fuente a favor', 'activo'],
  ['135517', 'Impuesto a las ventas retenido (ReteIVA a favor)', 'activo'], ['135518', 'Impuesto de industria y comercio retenido (ReteICA a favor)', 'activo'],
  ['143505', 'Mercancías no fabricadas por la empresa', 'activo'], ['152405', 'Equipo de oficina', 'activo'], ['154005', 'Muebles y vitrinas', 'activo'],
  ['210505', 'Obligaciones bancarias', 'pasivo'], ['220505', 'Proveedores nacionales', 'pasivo'], ['233525', 'Costos y gastos por pagar', 'pasivo'],
  ['236540', 'Retención en la fuente por compras', 'pasivo'], ['236525', 'Retención en la fuente por servicios', 'pasivo'], ['236515', 'Retención en la fuente por honorarios', 'pasivo'],
  ['236701', 'Impuesto a las ventas retenido (ReteIVA por pagar)', 'pasivo'], ['236801', 'Impuesto de industria y comercio retenido (ReteICA por pagar)', 'pasivo'],
  ['240801', 'IVA generado (por pagar)', 'pasivo'], ['240802', 'IVA descontable', 'pasivo'], ['250501', 'Salarios por pagar', 'pasivo'],
  ['310505', 'Capital social / aportes del propietario', 'patrimonio'], ['370505', 'Utilidades acumuladas', 'patrimonio'],
  ['413595', 'Ingresos por venta de mercancías', 'ingreso'], ['421005', 'Intereses y otros ingresos financieros', 'ingreso'], ['429595', 'Otros ingresos', 'ingreso'],
  ['510506', 'Sueldos y salarios', 'gasto'], ['512010', 'Arrendamientos', 'gasto'], ['513525', 'Acueducto y energía', 'gasto'], ['513535', 'Teléfono e internet', 'gasto'],
  ['513550', 'Transporte y fletes', 'gasto'], ['513595', 'Otros servicios', 'gasto'], ['519505', 'Publicidad y propaganda', 'gasto'], ['519599', 'Ajustes y pérdidas de inventario (mermas, vencidos)', 'gasto'],
  ['519595', 'Gastos diversos', 'gasto'], ['530505', 'Gastos bancarios y comisiones', 'gasto'], ['613595', 'Costo de ventas de mercancías', 'costo'],
];
const DEFAULT_ROLES = {
  acc_caja: '110505', acc_bancos: '111005', acc_cxc: '130505', acc_cxp: '220505', acc_inventario: '143505',
  acc_iva_compras: '240802', acc_iva_ventas: '240801', acc_ingresos: '413595', acc_costo_ventas: '613595',
  acc_capital: '310505', acc_ajuste_inv: '519599', acc_gastos_compras: '513595', acc_gastos_diversos: '519595',
};
// Retenciones: tarifas de ejemplo; cada empresa debe confirmarlas con su contador (dependen del régimen y del municipio).
const DEFAULT_WITHHOLDINGS = [
  ['Retefuente por compras 2,5%', 2.5, 'subtotal', 'compra', '236540'], ['Retefuente por servicios 4%', 4, 'subtotal', 'compra', '236525'],
  ['Retefuente por honorarios 11%', 11, 'subtotal', 'compra', '236515'], ['ReteIVA 15% del IVA', 15, 'iva', 'compra', '236701'], ['ReteICA 0,966% (verifique su municipio)', 0.966, 'subtotal', 'compra', '236801'],
  ['Retefuente que nos practican', 2.5, 'subtotal', 'venta', '135515'], ['ReteIVA que nos practican', 15, 'iva', 'venta', '135517'], ['ReteICA que nos practican', 0.966, 'subtotal', 'venta', '135518'],
];
const HAIR_CATEGORIES = ['Shampoo', 'Acondicionador', 'Tratamientos y mascarillas', 'Keratina y alisados', 'Tintes y coloración', 'Styling (geles, ceras, sprays)', 'Aceites y serums', 'Herramientas (secadores, planchas)', 'Accesorios', 'Kits y combos'];
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

// ---------- lotes y vencimientos (FEFO: primero en vencer, primero en salir) ----------
const lotsOn = (db) => getSetting(db, 'track_lots', '0') === '1';
function lotAdd(db, productId, lot, expiry, qty, unitCost, docId, date) {
  if (!lotsOn(db) || (!lot && !expiry)) return;
  if (expiry) needDate(expiry, 'fecha de vencimiento');
  db.prepare('INSERT INTO lots(product_id,lot,expiry,qty,qty_left,unit_cost,doc_id,date) VALUES(?,?,?,?,?,?,?,?)')
    .run(productId, lot || null, expiry || null, qty, qty, unitCost, docId || null, date);
}
function lotsConsume(db, productId, qty, docId) {
  if (!lotsOn(db)) return;
  let left = qty;
  for (const l of db.prepare('SELECT * FROM lots WHERE product_id=? AND qty_left>0 ORDER BY expiry IS NULL, expiry, id').all(productId)) {
    if (left <= 1e-9) break;
    const take = Math.min(left, l.qty_left);
    db.prepare('UPDATE lots SET qty_left=ROUND(qty_left-?,4) WHERE id=?').run(take, l.id);
    if (docId) db.prepare('INSERT INTO lot_moves(doc_id,lot_id,qty) VALUES(?,?,?)').run(docId, l.id, take);
    left -= take;
  }
}
function lotsRestore(db, docId) {
  for (const m of db.prepare('SELECT * FROM lot_moves WHERE doc_id=?').all(docId)) db.prepare('UPDATE lots SET qty_left=ROUND(qty_left+?,4) WHERE id=?').run(m.qty, m.lot_id);
  db.prepare('DELETE FROM lot_moves WHERE doc_id=?').run(docId);
}
function lotsVoidPurchase(db, docId) {
  for (const l of db.prepare('SELECT * FROM lots WHERE doc_id=?').all(docId)) {
    if (l.qty_left < l.qty - 1e-9) throw bad(`No se puede anular: el lote ${l.lot || ''} ya se vendió en parte`);
    db.prepare('UPDATE lots SET qty_left=0 WHERE id=?').run(l.id);
  }
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
      lotAdd(db, p.id, String(b.lot || '').trim() || null, b.expiry || null, qty, uc, null, date);
      if (val > 0) postEntry(db, { date, description: `${kind === 'inicial' ? 'Inventario inicial' : 'Ajuste de inventario'}: ${p.name}`, source: 'inventario', source_id: p.id, user_id: user.id,
        lines: [{ account_code: inv, debit: val }, { account_code: acct(db, kind === 'inicial' ? 'acc_capital' : 'acc_ajuste_inv'), credit: val }] });
    } else {
      if (kind === 'inicial') throw bad('El inventario inicial solo suma existencias');
      const out = -qty;
      if (p.stock < out && getSetting(db, 'allow_negative_stock', '0') !== '1') throw bad(`Existencia insuficiente de ${p.name} (hay ${p.stock})`);
      const val = stockOut(db, p, date, 'ajuste', out, null, b.notes);
      lotsConsume(db, p.id, out, null);
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
      currency: String(b.currency || '$').slice(0, 5), decimals: '0', country: 'CO', sector: b.sector === 'general' ? 'general' : 'cabello', profile,
      dian_text: '', print_footer: 'Documento de control interno. La factura electrónica se emite con su proveedor tecnológico autorizado por la DIAN.',
      ui_default: 'facil', use_inventory: profile === 'servicios' ? '0' : '1', allow_negative_stock: '0', lock_date: '',
      pfx_venta: 'FV-', pfx_compra: 'FC-', pfx_gasto: 'GA-', next_venta: 1, next_compra: 1, next_gasto: 1,
    };
    for (const [k, v] of Object.entries(s)) setSetting(db, k, v);
    for (const [n, r] of [['IVA 19%', 19], ['IVA 5%', 5], ['Excluido / exento (0%)', 0]]) db.prepare('INSERT INTO taxes(name,rate) VALUES(?,?)').run(n, r);
    for (const w of DEFAULT_WITHHOLDINGS) db.prepare('INSERT INTO withholdings(name,rate,base,applies,account_code) VALUES(?,?,?,?,?)').run(...w);
    const hair = b.sector !== 'general';
    for (const c of hair ? HAIR_CATEGORIES : ['General']) db.prepare('INSERT INTO categories(name) VALUES(?)').run(c);
    setSetting(db, 'track_lots', hair ? '1' : '0');
    db.prepare("INSERT INTO thirds(kind,name) VALUES('cliente','Cliente mostrador')").run();
    const { salt, hash } = hashPassword(String(b.password));
    db.prepare("INSERT INTO users(username,name,salt,hash,role) VALUES(?,?,?,?, 'admin')").run(username, String(b.admin_name || username), salt, hash);
  });
}

module.exports = {
  HttpError, bad, round2, round4, num, isDate, today, needDate, getSettings, getSetting, setSetting, nextNumber,
  DEFAULT_ACCOUNTS, DEFAULT_ROLES, DEFAULT_WITHHOLDINGS, ACCOUNT_TYPES, natureOf, acct, checkLock, postEntry, reverseEntries,
  stockIn, stockOut, adjustStock, lotsOn, lotAdd, lotsConsume, lotsRestore, lotsVoidPurchase, hashPassword, checkPassword, isSetup, setupCompany,
};
