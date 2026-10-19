'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { open } = require('../src/db');
const C = require('../src/core');
const D = require('../src/docs');
const R = require('../src/reports');

function fresh() {
  const db = open(':memory:');
  C.setupCompany(db, { company_name: 'Tienda Prueba', username: 'admin', password: 'clave-segura-1', profile: 'comercio', tax_rate: 19, tax_name: 'IVA' });
  const user = db.prepare('SELECT * FROM users').get();
  const iva = db.prepare("SELECT id FROM taxes WHERE rate=19").get().id;
  const cli = db.prepare('SELECT id FROM thirds').get().id;
  const prov = Number(db.prepare("INSERT INTO thirds(kind,name) VALUES('proveedor','Proveedor SA')").run().lastInsertRowid);
  const mkProd = (code, price, extra = {}) => Number(db.prepare('INSERT INTO products(code,name,price,tax_id,is_service) VALUES(?,?,?,?,?)').run(code, 'Prod ' + code, price, iva, extra.service ? 1 : 0).lastInsertRowid);
  return { db, user, iva, cli, prov, mkProd };
}
const bal = (db) => {
  const t = R.trialBalance(db, {});
  assert.equal(t.total_debit, t.total_credit, 'balance de prueba cuadrado');
  assert.ok(R.balanceSheet(db, {}).cuadra, 'balance general cuadrado');
  return t;
};

test('configuración inicial crea plan de cuentas, impuestos y admin', () => {
  const { db } = fresh();
  assert.ok(db.prepare('SELECT COUNT(*) n FROM accounts').get().n >= 20);
  assert.throws(() => C.setupCompany(db, { company_name: 'x', username: 'abc', password: '12345678' }), /ya fue configurado/);
});

test('compra, venta, costo promedio y cuadre contable', () => {
  const { db, user, cli, prov, mkProd } = fresh();
  const p = mkProd('A1', 100);
  // inventario inicial 10 @ 50
  C.adjustStock(db, user, { product_id: p, qty: 10, unit_cost: 50, kind: 'inicial', date: '2025-01-01' });
  // compra 10 @ 60 + IVA, a crédito
  const compra = D.createDocument(db, user, { type: 'compra', date: '2025-01-05', third_id: prov, lines: [{ product_id: p, qty: 10, price: 60 }] });
  assert.equal(compra.total, 714); // 600 + 19%
  let prod = db.prepare('SELECT * FROM products WHERE id=?').get(p);
  assert.equal(prod.stock, 20); assert.equal(prod.cost, 55); // (500+600)/20
  // venta 5 @ 100 + IVA, paga 300 ahora
  const venta = D.createDocument(db, user, { type: 'venta', date: '2025-01-10', third_id: cli, lines: [{ product_id: p, qty: 5 }], pay_now: 300 });
  assert.equal(venta.subtotal, 500); assert.equal(venta.tax, 95); assert.equal(venta.total, 595);
  assert.equal(venta.cogs, 275); assert.equal(venta.balance, 295);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(p).stock, 15);
  D.registerPayment(db, user, { doc_id: venta.id, amount: 295, date: '2025-01-20', account_code: '1110' });
  D.registerPayment(db, user, { doc_id: compra.id, amount: 714, date: '2025-01-21', account_code: '1105' });
  bal(db);
  const er = R.incomeStatement(db, { from: '2025-01-01', to: '2025-01-31' });
  assert.equal(er.ingresos.total, 500); assert.equal(er.costos.total, 275); assert.equal(er.utilidad_neta, 225);
  const bs = R.balanceSheet(db, { to: '2025-01-31' });
  assert.equal(bs.resultado, 225);
  assert.equal(R.agingReport(db, { type: 'venta' }).totals.total, 0);
  const inv = R.inventoryReport(db);
  assert.equal(inv.total_value, 825); // 15 * 55
  // el inventario contable coincide con el kardex
  assert.equal(R.ledger(db, { account: '1435' }).closing, 825);
});

test('no vende sin existencias y valida datos', () => {
  const { db, user, cli, mkProd } = fresh();
  const p = mkProd('B1', 10);
  assert.throws(() => D.createDocument(db, user, { type: 'venta', date: '2025-02-01', third_id: cli, lines: [{ product_id: p, qty: 1 }] }), /Existencia insuficiente/);
  assert.throws(() => D.createDocument(db, user, { type: 'venta', date: '2025-02-01', lines: [{ product_id: p, qty: 0 }] }), /cantidad/);
  assert.throws(() => D.createDocument(db, user, { type: 'venta', date: '2025-13-01', lines: [] }), /fecha/);
  // el fallo no deja rastros (transacción revertida)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM documents').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM journal_entries').get().n, 0);
});

test('servicios: venta sin inventario y venta a crédito exige cliente', () => {
  const { db, user, cli, mkProd } = fresh();
  const s = mkProd('S1', 200, { service: true });
  assert.throws(() => D.createDocument(db, user, { type: 'venta', date: '2025-02-01', lines: [{ product_id: s, qty: 1 }] }), /crédito/);
  const v = D.createDocument(db, user, { type: 'venta', date: '2025-02-01', third_id: cli, lines: [{ product_id: s, qty: 2 }], pay_now: 476 });
  assert.equal(v.total, 476); assert.equal(v.cogs, 0); assert.equal(v.balance, 0);
  const libre = D.createDocument(db, user, { type: 'venta', date: '2025-02-02', third_id: cli, lines: [{ description: 'Consultoría', qty: 1, price: 1000, tax_id: '' }], pay_now: 1000 });
  assert.equal(libre.total, 1000);
  bal(db);
});

test('anular venta y cobros revierte inventario y contabilidad', () => {
  const { db, user, cli, mkProd } = fresh();
  const p = mkProd('C1', 100);
  C.adjustStock(db, user, { product_id: p, qty: 10, unit_cost: 40, kind: 'inicial', date: '2025-03-01' });
  const v = D.createDocument(db, user, { type: 'venta', date: '2025-03-02', third_id: cli, lines: [{ product_id: p, qty: 4 }], pay_now: 100 });
  assert.throws(() => D.voidDocument(db, user, v.id, '2025-03-03'), /cobros/);
  const pay = db.prepare('SELECT id FROM payments').get().id;
  D.voidPayment(db, user, pay, '2025-03-03');
  D.voidDocument(db, user, v.id, '2025-03-03');
  assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(p).stock, 10);
  assert.equal(R.salesReport(db, {}).totals.sales, 0);
  assert.equal(R.incomeStatement(db, {}).utilidad_neta, 0);
  assert.throws(() => D.voidDocument(db, user, v.id), /ya está anulado/);
  bal(db);
});

test('anular compra cuyo stock ya se vendió falla', () => {
  const { db, user, cli, prov, mkProd } = fresh();
  const p = mkProd('D1', 100);
  const c = D.createDocument(db, user, { type: 'compra', date: '2025-03-01', third_id: prov, lines: [{ product_id: p, qty: 5, price: 30 }], pay_now: 178.5 });
  D.createDocument(db, user, { type: 'venta', date: '2025-03-02', third_id: cli, lines: [{ product_id: p, qty: 5 }], pay_now: 595 });
  const pay = db.prepare("SELECT id FROM payments WHERE doc_id=?").get(c.id).id;
  D.voidPayment(db, user, pay, '2025-03-03');
  assert.throws(() => D.voidDocument(db, user, c.id, '2025-03-03'), /ya se vendió/);
  bal(db);
});

test('gastos, asientos manuales y cierre de período', () => {
  const { db, user, prov } = fresh();
  const g = D.createDocument(db, user, { type: 'gasto', date: '2025-04-01', third_id: prov, lines: [{ description: 'Arriendo abril', qty: 1, price: 1000, account_code: '5120', tax_id: '' }], pay_now: 1000 });
  assert.equal(g.balance, 0);
  D.createManualEntry(db, user, { date: '2025-04-02', description: 'Aporte inicial', lines: [{ account_code: '1110', debit: 5000 }, { account_code: '3105', credit: 5000 }] });
  assert.throws(() => D.createManualEntry(db, user, { date: '2025-04-02', lines: [{ account_code: '1110', debit: 10 }, { account_code: '3105', credit: 9 }] }), /no cuadra/);
  bal(db);
  assert.equal(R.incomeStatement(db, {}).utilidad_neta, -1000);
  C.setSetting(db, 'lock_date', '2025-04-30');
  assert.throws(() => D.createDocument(db, user, { type: 'gasto', date: '2025-04-15', lines: [{ description: 'x', qty: 1, price: 1, account_code: '5195' }], pay_now: 1 }), /cerrado/);
});

test('anular asiento manual', () => {
  const { db, user } = fresh();
  const { id } = D.createManualEntry(db, user, { date: '2025-05-01', description: 'x', lines: [{ account_code: '1105', debit: 50 }, { account_code: '3105', credit: 50 }] });
  D.voidManualEntry(db, user, id, '2025-05-02');
  assert.equal(R.ledger(db, { account: '1105' }).closing, 0);
  assert.throws(() => D.voidManualEntry(db, user, id), /anulado/);
  bal(db);
});

test('descuento por línea y varios impuestos', () => {
  const { db, user, cli, mkProd } = fresh();
  const p = mkProd('E1', 100, { service: true });
  const v = D.createDocument(db, user, { type: 'venta', date: '2025-06-01', third_id: cli, lines: [{ product_id: p, qty: 3, disc_pct: 10 }], pay_now: 0 });
  assert.equal(v.subtotal, 270); assert.equal(v.discount, 30); assert.equal(v.tax, 51.3); assert.equal(v.total, 321.3);
  assert.equal(R.agingReport(db, { type: 'venta', to: '2025-06-10' }).totals.total, 321.3);
  bal(db);
});
