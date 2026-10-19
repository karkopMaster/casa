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
  D.registerPayment(db, user, { doc_id: venta.id, amount: 295, date: '2025-01-20', account_code: '111005' });
  D.registerPayment(db, user, { doc_id: compra.id, amount: 714, date: '2025-01-21', account_code: '110505' });
  bal(db);
  const er = R.incomeStatement(db, { from: '2025-01-01', to: '2025-01-31' });
  assert.equal(er.ingresos.total, 500); assert.equal(er.costos.total, 275); assert.equal(er.utilidad_neta, 225);
  const bs = R.balanceSheet(db, { to: '2025-01-31' });
  assert.equal(bs.resultado, 225);
  assert.equal(R.agingReport(db, { type: 'venta' }).totals.total, 0);
  const inv = R.inventoryReport(db);
  assert.equal(inv.total_value, 825); // 15 * 55
  // el inventario contable coincide con el kardex
  assert.equal(R.ledger(db, { account: '143505' }).closing, 825);
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
  const g = D.createDocument(db, user, { type: 'gasto', date: '2025-04-01', third_id: prov, lines: [{ description: 'Arriendo abril', qty: 1, price: 1000, account_code: '512010', tax_id: '' }], pay_now: 1000 });
  assert.equal(g.balance, 0);
  D.createManualEntry(db, user, { date: '2025-04-02', description: 'Aporte inicial', lines: [{ account_code: '111005', debit: 5000 }, { account_code: '310505', credit: 5000 }] });
  assert.throws(() => D.createManualEntry(db, user, { date: '2025-04-02', lines: [{ account_code: '111005', debit: 10 }, { account_code: '310505', credit: 9 }] }), /no cuadra/);
  bal(db);
  assert.equal(R.incomeStatement(db, {}).utilidad_neta, -1000);
  C.setSetting(db, 'lock_date', '2025-04-30');
  assert.throws(() => D.createDocument(db, user, { type: 'gasto', date: '2025-04-15', lines: [{ description: 'x', qty: 1, price: 1, account_code: '5195' }], pay_now: 1 }), /cerrado/);
});

test('anular asiento manual', () => {
  const { db, user } = fresh();
  const { id } = D.createManualEntry(db, user, { date: '2025-05-01', description: 'x', lines: [{ account_code: '110505', debit: 50 }, { account_code: '310505', credit: 50 }] });
  D.voidManualEntry(db, user, id, '2025-05-02');
  assert.equal(R.ledger(db, { account: '110505' }).closing, 0);
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

test('Colombia: plan PUC, IVA 19/5 y retenciones en compra y venta', () => {
  const { db, user, cli, prov, mkProd } = fresh();
  assert.ok(db.prepare("SELECT 1 FROM accounts WHERE code='240801'").get());
  assert.deepEqual(db.prepare('SELECT rate FROM taxes ORDER BY id').all().map((t) => t.rate), [19, 5, 0]);
  const p = mkProd('K1', 1000);
  C.adjustStock(db, user, { product_id: p, qty: 100, unit_cost: 400, kind: 'inicial', date: '2025-01-01' });
  const w = (name) => db.prepare('SELECT * FROM withholdings WHERE name LIKE ?').get(name + '%');
  // compra: 10 × 400 + IVA 760 − retefuente 2,5% (100) − reteIVA 15% (114)
  const c = D.createDocument(db, user, { type: 'compra', date: '2025-02-01', third_id: prov, lines: [{ product_id: p, qty: 10, price: 400 }], withholdings: [w('Retefuente por compras').id, w('ReteIVA 15% del IVA').id] });
  assert.equal(c.subtotal, 4000); assert.equal(c.tax, 760); assert.equal(c.withholding, 214); assert.equal(c.total, 4546);
  assert.equal(R.ledger(db, { account: '236540' }).closing, 100);
  // venta: el cliente nos retiene
  const v = D.createDocument(db, user, { type: 'venta', date: '2025-02-02', third_id: cli, lines: [{ product_id: p, qty: 10 }], withholdings: [w('Retefuente que nos practican').id] });
  assert.equal(v.total, 10000 + 1900 - 250);
  assert.throws(() => D.createDocument(db, user, { type: 'venta', date: '2025-02-02', third_id: cli, lines: [{ product_id: p, qty: 1 }], withholdings: [w('Retefuente por compras').id] }), /no aplica/);
  D.registerPayment(db, user, { doc_id: v.id, amount: v.total, date: '2025-02-03', account_code: '111010' });
  assert.equal(R.agingReport(db, { type: 'venta' }).totals.total, 0);
  assert.equal(R.ledger(db, { account: '135515' }).closing, 250);
  bal(db);
  D.voidDocument(db, user, c.id, '2025-02-05');
  bal(db);
});

test('cabello: lotes FEFO, vencimientos y precio mayorista', () => {
  const { db, user, cli, prov, mkProd } = fresh();
  const p = mkProd('SH1', 20000);
  db.prepare('UPDATE products SET price2=15000 WHERE id=?').run(p);
  const mayo = Number(db.prepare("INSERT INTO thirds(kind,name,price_list) VALUES('cliente','Peluquería Estilo','mayorista')").run().lastInsertRowid);
  D.createDocument(db, user, { type: 'compra', date: '2025-01-01', third_id: prov, lines: [{ product_id: p, qty: 5, price: 8000, lot: 'L-NUEVO', expiry: '2027-12-31' }], pay_now: 47600 });
  D.createDocument(db, user, { type: 'compra', date: '2025-01-02', third_id: prov, lines: [{ product_id: p, qty: 5, price: 8000, lot: 'L-VIEJO', expiry: '2026-03-01' }], pay_now: 47600 });
  const v = D.createDocument(db, user, { type: 'venta', date: '2025-01-10', third_id: mayo, lines: [{ product_id: p, qty: 6 }] });
  assert.equal(v.lines[0].price, 15000);                       // lista mayorista
  const lots = db.prepare('SELECT lot, qty_left FROM lots ORDER BY expiry').all();
  assert.deepEqual(lots.map((l) => l.qty_left), [0, 4]);        // primero se agota el que vence antes
  const rep = R.lotsReport(db, { days: 100000 });
  assert.equal(rep.rows.length, 1); assert.equal(rep.rows[0].lot, 'L-NUEVO');
  D.voidDocument(db, user, v.id, '2025-01-11');                 // anular devuelve a los mismos lotes
  assert.deepEqual(db.prepare('SELECT qty_left FROM lots ORDER BY expiry').all().map((l) => l.qty_left), [5, 5]);
  bal(db);
});

test('sugerencia de descuento por vencimiento respeta escalones y costo', () => {
  const t = R.parseTiers('30:30,60:20,90:10');
  assert.deepEqual(R.suggestDiscount(25, 40000, 20000, t), { pct: 30, price: 28000, limited: false });
  assert.equal(R.suggestDiscount(45, 40000, 20000, t).pct, 20);
  assert.equal(R.suggestDiscount(120, 40000, 20000, t), null);   // aún falta mucho
  assert.equal(R.suggestDiscount(-1, 40000, 20000, t), null);    // vencido: no se vende
  const lim = R.suggestDiscount(10, 40000, 36000, t);            // margen de solo 10 %: no baja del costo
  assert.ok(lim.limited && lim.price >= 36000);
  assert.ok(R.suggestDiscount(10, 40000, 40000, t).at_cost);
});

test('pasarelas: enlace Wompi, webhook firmado, idempotencia y liquidación', async () => {
  const crypto = require('crypto');
  const G = require('../src/gateways');
  const { db, user, cli, mkProd } = fresh();
  const s = mkProd('S9', 50000, { service: true });
  const v = D.createDocument(db, user, { type: 'venta', date: '2025-07-01', third_id: cli, lines: [{ product_id: s, qty: 1 }] }); // 59.500
  const gid = G.saveGateway(db, null, { provider: 'wompi', name: 'Wompi', mode: 'sandbox', private_key: 'prv_test_x', events_secret: 'sec123', account_code: '111015' });
  assert.ok(!JSON.stringify(G.listGateways(db)).includes('prv_test_x'), 'no devuelve secretos');
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM gateways').all()).includes('prv_test_x'), 'cifrado en reposo');
  let called;
  const fakeFetch = async (url, opt) => { called = { url, opt }; return { ok: true, json: async () => ({ data: { id: 'link_abc' } }) }; };
  const link = await G.createPayLink(db, user, { gateway_id: gid, doc_id: v.id }, fakeFetch);
  assert.equal(link.url, 'https://checkout.wompi.co/l/link_abc');
  assert.equal(JSON.parse(called.opt.body).amount_in_cents, 5950000);
  assert.match(called.url, /sandbox\.wompi\.co/); assert.equal(called.opt.headers.Authorization, 'Bearer prv_test_x');
  const event = (status, txid, ts = 1700000000) => {
    const data = { transaction: { id: txid, status, amount_in_cents: 5950000, payment_link_id: 'link_abc', payment_method_type: 'NEQUI' } };
    const props = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'];
    const checksum = crypto.createHash('sha256').update(txid + status + 5950000 + ts + 'sec123').digest('hex');
    return { event: 'transaction.updated', data, timestamp: ts, signature: { properties: props, checksum } };
  };
  assert.throws(() => G.handleWebhook(db, gid, {}, '', { ...event('APPROVED', 't1'), signature: { properties: ['transaction.id'], checksum: 'mala' } }), /Firma inválida/);
  assert.equal(R.agingReport(db, { type: 'venta' }).totals.total, 59500);   // la firma mala no cobró nada
  assert.equal(G.handleWebhook(db, gid, {}, '', event('DECLINED', 't0')).result, 'Sin pago (DECLINED)');
  G.handleWebhook(db, gid, {}, '', event('APPROVED', 't1'));
  assert.equal(D.getDocument(db, v.id).balance, 0);
  assert.ok(G.handleWebhook(db, gid, {}, '', event('APPROVED', 't1')).duplicate); // reintento de la pasarela
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payments').get().n, 1);
  assert.equal(R.ledger(db, { account: '111015' }).closing, 59500);
  // banco recibe 57.000 y la pasarela cobra 2.500 de comisión
  G.settle(db, user, { gateway_id: gid, received: 57000, fee: 2500, bank_account: '111005', date: '2025-07-05' });
  assert.equal(R.ledger(db, { account: '111015' }).closing, 0);
  assert.equal(R.ledger(db, { account: '111005' }).closing, 57000);
  assert.equal(R.ledger(db, { account: '530505' }).closing, 2500);
  bal(db);
  // pasarela genérica con HMAC
  const g2 = G.saveGateway(db, null, { provider: 'generico', name: 'Otra', events_secret: 'k', account_code: '111015', link_template: 'https://pay.example.com/?ref={reference}&monto={amount}' });
  const v2 = D.createDocument(db, user, { type: 'venta', date: '2025-07-02', third_id: cli, lines: [{ product_id: s, qty: 1 }] });
  const l2 = await G.createPayLink(db, user, { gateway_id: g2, doc_id: v2.id });
  const raw = JSON.stringify({ reference: l2.reference, status: 'approved', amount: 59500, transaction_id: 'x1' });
  assert.throws(() => G.handleWebhook(db, g2, { 'x-signature': 'abc' }, raw, JSON.parse(raw)), /Firma inválida/);
  G.handleWebhook(db, g2, { 'x-signature': crypto.createHmac('sha256', 'k').update(raw).digest('hex') }, raw, JSON.parse(raw));
  assert.equal(D.getDocument(db, v2.id).balance, 0);
  bal(db);
});
