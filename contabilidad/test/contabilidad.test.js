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

test('facturación electrónica: validaciones, simulador, genérico, webhook y nota crédito', async () => {
  const crypto = require('crypto');
  const EI = require('../src/einvoice');
  const { db, user, cli, mkProd } = fresh();
  const p = mkProd('F1', 10000);
  C.adjustStock(db, user, { product_id: p, qty: 10, unit_cost: 4000, kind: 'inicial', date: '2025-08-01' });
  const v = D.createDocument(db, user, { type: 'venta', date: '2025-08-02', third_id: cli, lines: [{ product_id: p, qty: 2 }] });
  await assert.rejects(EI.emit(db, user, v.id), /Configure un proveedor/);
  EI.saveConfig(db, { provider: 'simulador' });
  await assert.rejects(EI.emit(db, user, v.id), /NIT de la empresa/);                  // faltan datos de la empresa
  C.setSetting(db, 'company_nit', '900123456-7'); C.setSetting(db, 'company_address', 'Calle 1 # 2-3');
  await assert.rejects(EI.emit(db, user, v.id), /documento/);                          // el cliente no tiene documento
  db.prepare("UPDATE thirds SET doc_id='1020304050', email='ana@correo.co' WHERE id=?").run(cli);
  const pl = EI.buildPayload(db, v.id, 'factura');
  assert.equal(pl.supplier.dv, '7'); assert.equal(pl.supplier.id_number, '900123456'); assert.equal(pl.totals.payable, 23800); assert.equal(pl.lines[0].tax.amount, 3800);
  assert.equal(pl.payment_form.code, '2');                                              // crédito
  const r1 = await EI.emit(db, user, v.id);
  assert.equal(r1.status, 'aceptada'); assert.match(r1.message, /SIMULACI/); assert.equal(D.getDocument(db, v.id).ref, v.number);
  await assert.rejects(EI.emit(db, user, v.id), /ya tiene factura/);
  // anular una venta aceptada genera nota crédito primero
  const nc = await EI.creditNoteIfNeeded(db, user, v.id, 'Devolución');
  assert.equal(nc.kind, 'nota_credito'); assert.equal(nc.status, 'aceptada');
  D.voidDocument(db, user, v.id, '2025-08-03');
  // genérico con respuesta mapeada, cabecera de autenticación y rechazo 4xx
  EI.saveConfig(db, { provider: 'generico', url: 'https://api.proveedor.co/facturas', auth: 'header', header: 'X-Api-Key', secret: 'llave123', map_status: 'data.status', map_number: 'data.number', map_cufe: 'data.cufe', webhook_secret: 'wh' });
  const v2 = D.createDocument(db, user, { type: 'venta', date: '2025-08-04', third_id: cli, lines: [{ product_id: p, qty: 1 }] });
  let seen;
  const ok = async (url, o) => { seen = { url, o }; return { ok: true, status: 200, text: async () => JSON.stringify({ data: { status: 'ACCEPTED', number: 'SETP990000001', cufe: 'abc123' } }) }; };
  const r2 = await EI.emit(db, user, v2.id, 'factura', {}, ok);
  assert.equal(r2.status, 'aceptada'); assert.equal(r2.cufe, 'abc123'); assert.equal(seen.o.headers['X-Api-Key'], 'llave123'); assert.equal(JSON.parse(seen.o.body).type, 'invoice');
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM settings').all()).includes('llave123'), 'secreto cifrado');
  const v3 = D.createDocument(db, user, { type: 'venta', date: '2025-08-05', third_id: cli, lines: [{ product_id: p, qty: 1 }] });
  const bad422 = async () => ({ ok: false, status: 422, text: async () => JSON.stringify({ message: 'NIT del adquiriente inválido' }) });
  const r3 = await EI.emit(db, user, v3.id, 'factura', {}, bad422);
  assert.equal(r3.status, 'rechazada'); assert.match(r3.message, /inválido/);
  const down = async () => { throw new Error('ECONNREFUSED'); };
  const r4 = await EI.emit(db, user, v3.id, 'factura', {}, down);                      // reintento permitido tras rechazo
  assert.equal(r4.status, 'error');
  // enviada sin mapa de estado → queda pendiente hasta el webhook firmado
  EI.saveConfig(db, { provider: 'generico', url: 'https://api.proveedor.co/facturas', map_status: '' });
  const r5 = await EI.emit(db, user, v3.id, 'factura', {}, async () => ({ ok: true, status: 202, text: async () => '{}' }));
  assert.equal(r5.status, 'enviada');
  await assert.rejects(EI.creditNoteIfNeeded(db, user, v3.id, 'x'), /pendiente de confirmación/);
  const raw = JSON.stringify({ einvoice_id: r5.id, status: 'accepted', number: 'SETP990000002', cufe: 'zzz' });
  assert.throws(() => EI.handleWebhook(db, { 'x-signature': 'mala' }, raw, JSON.parse(raw)), /Firma inválida/);
  assert.equal(EI.handleWebhook(db, { 'x-signature': crypto.createHmac('sha256', 'wh').update(raw).digest('hex') }, raw, JSON.parse(raw)).status, 'aceptada');
  assert.equal(D.getDocument(db, v3.id).ref, 'SETP990000002');
  bal(db);
});

test('SETUP_TOKEN: sin el código nadie crea el primer administrador', () => {
  const { open } = require('../src/db');
  const { build } = require('../src/api');
  const db = open(':memory:'), api = build(db);
  const call = (b) => api.dispatch('POST', '/api/setup', {}, b, null, '1.1.1.1');
  const datos = { company_name: 'X', username: 'dueno', password: 'clave-segura-1' };
  process.env.SETUP_TOKEN = 'abc123secreto';
  try {
    assert.equal(api.dispatch('GET', '/api/status', {}, {}, null, 'x').setup_token_required, true);
    assert.throws(() => call(datos), /Código de instalación incorrecto/);
    assert.throws(() => call({ ...datos, setup_token: 'otro' }), /incorrecto/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
    assert.ok(call({ ...datos, setup_token: 'abc123secreto' }).ok);
    assert.equal(api.dispatch('GET', '/api/status', {}, {}, null, 'x').setup_token_required, false);
    assert.throws(() => call({ ...datos, username: 'otro', setup_token: 'abc123secreto' }), /ya fue configurado/);
    // nadie se registra solo: crear usuarios exige sesión de administrador
    assert.throws(() => api.dispatch('POST', '/api/users', {}, { username: 'intruso', password: 'clave-segura-1', role: 'admin' }, null, 'x'), /Sesión expirada/);
  } finally { delete process.env.SETUP_TOKEN; }
});

test('multi-empresa: bases separadas, aislamiento total y control de la plataforma', async () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const { Platform } = require('../src/platform');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plat-'));
  const P = new Platform(dir);
  process.env.SETUP_TOKEN = 'tok-plat-123';
  try {
    await assert.rejects(() => P.handle('POST', 'setup', { username: 'dueno', password: 'una-clave-larga-1', setup_token: 'mal' }, '', 'x'), /incorrecto/);
    await P.handle('POST', 'setup', { username: 'dueno', password: 'una-clave-larga-1', setup_token: 'tok-plat-123' }, '', 'x');
    await assert.rejects(() => P.handle('GET', 'tenants', {}, '', 'x'), /Sesión expirada/);
    const { token } = await P.handle('POST', 'login', { username: 'dueno', password: 'una-clave-larga-1' }, '', 'x');
    const a = await P.handle('POST', 'tenants', { name: 'Peluquería Ana' }, token);
    const b = await P.handle('POST', 'tenants', { name: 'Distribuidora Beto', admin_user: 'beto' }, token);
    assert.equal(a.slug, 'peluqueria-ana'); assert.ok(a.password.length >= 10);
    await assert.rejects(() => P.handle('POST', 'tenants', { name: 'Peluquería Ana' }, token), /ya existe/);
    for (const mal of ['../x', 'a/b', 'API', 'plataforma', 'A B', '']) assert.equal(P.validSlug(mal), false, mal);
    assert.throws(() => P.fileFor('../platform'), /inválido/);
    assert.ok(fs.existsSync(path.join(dir, 'tenants', 'peluqueria-ana.db')) && fs.existsSync(path.join(dir, 'tenants', 'distribuidora-beto.db')));
    // cada negocio entra con lo suyo y su token no sirve en el otro
    const ta = P.tenant(a.slug), tb = P.tenant(b.slug);
    const la = ta.api.dispatch('POST', '/api/login', {}, { username: a.admin_user, password: a.password }, '', 'x');
    assert.throws(() => ta.api.dispatch('POST', '/api/login', {}, { username: b.admin_user, password: b.password }, '', 'x'), /incorrectos/);
    assert.throws(() => tb.api.dispatch('GET', '/api/me', {}, {}, la.token, 'x'), /Sesión expirada/);
    // datos separados
    ta.api.dispatch('POST', '/api/thirds', {}, { kind: 'cliente', name: 'Cliente SOLO de Ana' }, la.token, 'x');
    const lb = tb.api.dispatch('POST', '/api/login', {}, { username: b.admin_user, password: b.password }, '', 'x');
    const deB = tb.api.dispatch('GET', '/api/thirds', {}, {}, lb.token, 'x');
    assert.ok(!JSON.stringify(deB).includes('SOLO de Ana'));
    assert.equal(ta.api.dispatch('GET', '/api/thirds', {}, {}, la.token, 'x').some((t) => t.name === 'Cliente SOLO de Ana'), true);
    // el negocio no puede crear empresas ni reconfigurarse
    assert.throws(() => ta.api.dispatch('POST', '/api/setup', {}, { company_name: 'x' }, '', 'x'), /plataforma/);
    // suspender bloquea el acceso; reactivar lo devuelve
    await P.handle('POST', `tenants/${a.slug}/estado`, { status: 'suspendido' }, token);
    assert.throws(() => P.tenant(a.slug), /suspendida/);
    await P.handle('POST', `tenants/${a.slug}/estado`, { status: 'activo' }, token);
    assert.ok(P.tenant(a.slug));
    // restablecer clave del admin de un negocio
    const nueva = await P.handle('POST', `tenants/${a.slug}/reset-admin`, {}, token);
    P.tenant(a.slug).api.dispatch('POST', '/api/login', {}, { username: nueva.username, password: nueva.password }, '', 'x');
    assert.throws(() => P.tenant(a.slug).api.dispatch('GET', '/api/me', {}, {}, la.token, 'x'), /Sesión expirada/); // sesiones anteriores cerradas
    // copia de un negocio y archivado (no borra el archivo)
    assert.ok((await P.handle('GET', `tenants/${b.slug}/backup`, {}, token)).__download.length > 1000);
    await assert.rejects(() => P.handle('POST', `tenants/${b.slug}/archivar`, { confirm: 'otro' }, token), /Escriba el código/);
    await P.handle('POST', `tenants/${b.slug}/archivar`, { confirm: b.slug }, token);
    assert.equal(P.tenant(b.slug), null);
    assert.equal(fs.readdirSync(path.join(dir, 'archivo')).filter((f) => f.endsWith('.db')).length, 1);
  } finally { delete process.env.SETUP_TOKEN; }
});

test('demo: datos de ejemplo completos, con contabilidad que cuadra', async () => {
  const { seedDemo } = require('../src/demo');
  const db = open(':memory:');
  C.setupCompany(db, { company_name: 'Demo', username: 'demo', password: 'demo-clave-1', sector: 'cabello' });
  const user = db.prepare('SELECT * FROM users').get();
  const t0 = Date.now();
  const sm = await seedDemo(db, user, { password: 'demo-clave-1' });
  console.log('   demo generada en', Date.now() - t0, 'ms', JSON.stringify(sm));
  assert.ok(sm.products >= 29 && sm.clients === 8 && sm.sales >= 100 && sm.purchases === 5 && sm.expenses === 15 && sm.einvoices > 80);
  bal(db);
  const lots = R.lotsReport(db, { days: 90 });
  assert.ok(lots.expired_count >= 1, 'hay un lote vencido');
  assert.ok(lots.rows.filter((r) => r.suggest && r.suggest.pct > 0).length >= 3, 'hay descuentos sugeridos');
  const ar = R.agingReport(db, { type: 'venta' }), ap = R.agingReport(db, { type: 'compra' });
  assert.ok(ar.totals.total > 0 && ar.totals.d1_30 + ar.totals.d31_60 > 0, 'hay cartera vencida');
  assert.ok(ap.totals.total > 0, 'hay cuentas por pagar');
  for (const a of ['110505', '111005']) assert.ok(R.ledger(db, { account: a }).closing > 0, 'saldo positivo en ' + a);
  assert.ok(R.incomeStatement(db, {}).utilidad_neta !== 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM documents WHERE status='anulado'").get().n, 1);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM einvoices WHERE status='aceptada'").get().n === sm.einvoices);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM users").get().n, 3);
  const dash = R.dashboard(db);
  assert.ok(dash.sales_month > 0 && dash.purchases_month > 0 && dash.profit_month > 0, 'el mes actual muestra ventas, compras y utilidad positiva');
  for (const a of ['111010', '111015']) assert.ok(R.ledger(db, { account: a }).closing > 0, 'hay movimiento en ' + a);
  const ym = new Date().toISOString().slice(0, 7);
  assert.ok(R.incomeStatement(db, { from: ym + '-01', to: ym + '-31' }).utilidad_neta > 0);
});

test('seguridad: la facturación electrónica no puede apuntar a direcciones internas (SSRF)', async () => {
  const EI = require('../src/einvoice');
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.20.1.1', '192.168.1.10', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '0.0.0.0']) assert.equal(EI.isPrivateIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '148.113.203.154', '2606:4700::1111']) assert.equal(EI.isPrivateIp(ip), false, ip);
  for (const u of ['http://api.x.co/f', 'https://localhost/f', 'https://127.0.0.1/f', 'https://[::1]/f', 'https://api.x.co:4000/f', 'https://user:pw@api.x.co/f', 'https://servicio.internal/f', 'https://169.254.169.254/latest/meta-data'])
    assert.ok(EI.urlProblem(u), u);
  assert.equal(EI.urlProblem('https://api.proveedor.co/v1/facturas'), null);
  const { db } = fresh();
  assert.throws(() => EI.saveConfig(db, { provider: 'generico', url: 'https://127.0.0.1:3000/x' }), /URL del proveedor/);
  assert.throws(() => EI.saveConfig(db, { provider: 'generico', url: 'https://api.proveedor.co/x', url_nc: 'https://10.0.0.1/x' }), /URL del proveedor/);
  await assert.rejects(EI.assertPublicUrl('https://localhost/x'), /no permitida/i);
});

test('demos: creación automática, restricciones, vencimiento, demo pública con límites y migración', async () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const { Platform } = require('../src/platform');
  const { DatabaseSync } = require('node:sqlite');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plat-demo-'));
  // base de plataforma "antigua" (sin columnas de demo) para comprobar la migración
  const old = new DatabaseSync(path.join(dir, 'platform.db'));
  old.exec("CREATE TABLE tenants (id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'activo', sector TEXT, note TEXT, created_at TEXT, last_login TEXT, admin_user TEXT)");
  old.close();
  const P = new Platform(dir);
  assert.ok(P.pdb.prepare('PRAGMA table_info(tenants)').all().some((c) => c.name === 'is_demo'));
  // demo manual
  const d = await P.createDemo({ days: 2, note: 'manual' });
  assert.match(d.slug, /^demo-[0-9a-f]{6}$/); assert.ok(d.summary.sales >= 50 && d.password.length >= 10);
  const t = P.tenant(d.slug);
  const lg = t.api.dispatch('POST', '/api/login', {}, { username: 'vendedor', password: d.password }, '', 'x');
  assert.equal(lg.user.role, 'vendedor');
  const adm = t.api.dispatch('POST', '/api/login', {}, { username: 'demo', password: d.password }, '', 'x');
  assert.equal(t.api.dispatch('GET', '/api/me', {}, {}, adm.token, 'x').settings.is_demo, '1');
  assert.ok(!JSON.stringify(t.api.dispatch('GET', '/api/me', {}, {}, adm.token, 'x').settings).includes('secret_key'));
  // restricciones de demo
  assert.throws(() => t.api.dispatch('POST', '/api/gateways', {}, { provider: 'wompi', name: 'x', private_key: 'prv', account_code: '111015' }, adm.token, 'x'), /No disponible en la demo/);
  assert.throws(() => t.api.dispatch('PUT', '/api/einvoice/config', {}, { provider: 'generico', url: 'https://api.x.co/f' }, adm.token, 'x'), /simulador/);
  assert.throws(() => t.api.dispatch('POST', '/api/me/password', {}, { current: 'x', password: 'otra-clave-1' }, adm.token, 'x'), /demo/);
  // vencimiento: al pasar la fecha se elimina por completo; un negocio real no se toca
  const real = await P.handle('GET', 'status', {}, '', 'x') && P.createTenant({ name: 'Negocio Real' });
  assert.equal(P.purgeExpired(), 0);
  P.pdb.prepare("UPDATE tenants SET expires_at='2000-01-01T00:00:00.000Z' WHERE slug=?").run(d.slug);
  assert.equal(P.purgeExpired(), 1);
  assert.equal(P.row(d.slug), undefined); assert.ok(!fs.existsSync(path.join(dir, 'tenants', d.slug + '.db')));
  assert.ok(P.row(real.slug) && fs.existsSync(path.join(dir, 'tenants', real.slug + '.db')));
  // demo pública: apagada por defecto, con tope por IP
  await assert.rejects(P.startPublicDemo('1.1.1.1'), /no está habilitada/);
  P.setSetting('public_demo', '1');
  const p1 = await P.startPublicDemo('1.1.1.1');
  assert.ok(p1.token && p1.empresa.startsWith('demo-'));
  assert.equal(P.tenant(p1.empresa).api.dispatch('GET', '/api/me', {}, {}, p1.token, 'x').user.username, 'demo');
  await P.startPublicDemo('1.1.1.1'); await P.startPublicDemo('1.1.1.1');
  await assert.rejects(P.startPublicDemo('1.1.1.1'), /varias demos/);
  P.setSetting('public_demo_max', '3');
  await assert.rejects(P.startPublicDemo('2.2.2.2'), /muchas demos/);
  // las demos públicas no ven a los demás negocios
  const other = P.tenant(real.slug).api.dispatch('POST', '/api/login', {}, { username: real.admin_user, password: real.password }, '', 'x');
  assert.throws(() => P.tenant(p1.empresa).api.dispatch('GET', '/api/me', {}, {}, other.token, 'x'), /Sesión expirada/);
});
