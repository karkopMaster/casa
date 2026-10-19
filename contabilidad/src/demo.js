'use strict';
// Datos de demostración: una distribuidora ficticia de productos para el cabello (Colombia). Todo se registra con las
// mismas funciones que usa la aplicación (compras, ventas, cobros, gastos, asientos), así que la contabilidad es real y cuadra.
// Las marcas, NIT y direcciones son inventados.
const C = require('./core');
const D = require('./docs');
const EI = require('./einvoice');

const BRANDS = { K: 'Keraviva', S: 'SedaPro', C: 'ColorMax', R: 'Rizos&Co', B: 'Botánica Andina', L: 'Lumina', BL: 'Brillo Latino', T: 'TermoStyle' };
// [código, nombre, marca, categoría, unidad, unidad DIAN, precio detal, precio mayorista, costo, mínimo, cantidad inicial]
const PRODUCTS = [
  ['SH-001', 'Shampoo Reparador 400ml', 'K', 'Shampoo', 'ml', 'MLT', 38000, 30000, 21000, 8, 36], ['SH-002', 'Shampoo Anticaspa 350ml', 'S', 'Shampoo', 'ml', 'MLT', 26000, 20500, 14500, 8, 40],
  ['SH-003', 'Shampoo Matizador Violeta 300ml', 'C', 'Shampoo', 'ml', 'MLT', 42000, 33000, 23000, 6, 24], ['SH-004', 'Shampoo Rizos Definidos 400ml', 'R', 'Shampoo', 'ml', 'MLT', 36000, 28500, 19500, 8, 30],
  ['AC-001', 'Acondicionador Hidratante 400ml', 'K', 'Acondicionador', 'ml', 'MLT', 38000, 30000, 21000, 8, 32], ['AC-002', 'Acondicionador Sin Enjuague 200ml', 'BL', 'Acondicionador', 'ml', 'MLT', 24000, 18500, 12800, 8, 30],
  ['TR-001', 'Mascarilla Nutrición Intensa 500g', 'B', 'Tratamientos y mascarillas', 'gr', 'GRM', 58000, 46000, 31000, 6, 22], ['TR-002', 'Ampolletas Reparadoras x12', 'K', 'Tratamientos y mascarillas', 'und', '94', 72000, 58000, 39500, 5, 16],
  ['TR-003', 'Tratamiento Bond Repair 250ml', 'L', 'Tratamientos y mascarillas', 'ml', 'MLT', 95000, 76000, 52000, 4, 14], ['TR-004', 'Mascarilla Cacao-Coco 300g', 'B', 'Tratamientos y mascarillas', 'gr', 'GRM', 34000, 27000, 18000, 6, 18],
  ['KE-001', 'Keratina Alisante 1L', 'L', 'Keratina y alisados', 'ml', 'LTR', 165000, 130000, 92000, 3, 10], ['KE-002', 'Shampoo Pre-Alisado 1L', 'L', 'Keratina y alisados', 'ml', 'LTR', 64000, 50000, 35000, 4, 12],
  ['KE-003', 'Botox Capilar 500g', 'K', 'Keratina y alisados', 'gr', 'GRM', 118000, 94000, 64000, 3, 9],
  ['TI-001', 'Tinte 5.0 Castaño Claro 60g', 'C', 'Tintes y coloración', 'gr', 'GRM', 18000, 14000, 9500, 12, 60], ['TI-002', 'Tinte 7.1 Rubio Ceniza 60g', 'C', 'Tintes y coloración', 'gr', 'GRM', 18000, 14000, 9500, 12, 60],
  ['TI-003', 'Tinte 1.0 Negro 60g', 'C', 'Tintes y coloración', 'gr', 'GRM', 18000, 14000, 9500, 12, 70], ['TI-004', 'Oxidante 20 Vol 900ml', 'C', 'Tintes y coloración', 'ml', 'MLT', 21000, 16500, 11500, 10, 40],
  ['TI-005', 'Decolorante en Polvo 500g', 'C', 'Tintes y coloración', 'gr', 'GRM', 48000, 38000, 26000, 5, 20],
  ['ST-001', 'Gel Fijación Fuerte 500g', 'R', 'Styling (geles, ceras, sprays)', 'gr', 'GRM', 19000, 15000, 10000, 10, 40], ['ST-002', 'Cera Moldeadora 100g', 'BL', 'Styling (geles, ceras, sprays)', 'gr', 'GRM', 22000, 17500, 12000, 8, 30],
  ['ST-003', 'Spray Fijador 400ml', 'S', 'Styling (geles, ceras, sprays)', 'ml', 'MLT', 28000, 22000, 15500, 8, 28],
  ['AS-001', 'Aceite de Argán 60ml', 'B', 'Aceites y serums', 'ml', 'MLT', 52000, 41000, 28000, 6, 24], ['AS-002', 'Serum Anti-Frizz 100ml', 'BL', 'Aceites y serums', 'ml', 'MLT', 39000, 31000, 21000, 6, 26],
  ['HE-001', 'Secador Profesional 2200W', 'T', 'Herramientas (secadores, planchas)', 'und', '94', 235000, 190000, 142000, 2, 8], ['HE-002', 'Plancha Cerámica 1 pulgada', 'T', 'Herramientas (secadores, planchas)', 'und', '94', 185000, 150000, 112000, 2, 8],
  ['AX-001', 'Cepillo Térmico Redondo', 'T', 'Accesorios', 'und', '94', 28000, 22000, 15000, 6, 24], ['AX-002', 'Pinzas Cocodrilo x12', 'T', 'Accesorios', 'und', '94', 9000, 6500, 4200, 10, 50],
  ['AX-003', 'Capa de Corte Impermeable', 'T', 'Accesorios', 'und', '94', 33000, 26000, 19000, 4, 14], ['KI-001', 'Kit Hidratación Total', 'K', 'Kits y combos', 'und', '94', 89000, 72000, 52000, 4, 14],
];
// lotes que vencen pronto o ya vencieron (para mostrar descuentos sugeridos y bajas): código → [días para vencer, cantidad]
const SPECIAL_LOTS = { 'SH-002': [18, 20], 'AC-002': [42, 16], 'ST-003': [70, 14], 'KE-003': [28, 5], 'TI-004': [55, 12], 'TR-004': [-6, 6] };
const CLIENTS = [
  ['Salón Estilo y Color', 'Salón Estilo y Color SAS', '900456123', '31', '4', 'mayorista', '3105550101', 'estilocolor@example.com', 'Cra 20 # 45-12, Barranquilla'],
  ['Peluquería Karina', '', '1045678901', '13', null, 'mayorista', '3115550102', 'karina@example.com', 'Calle 30 # 8-15, Santa Marta'],
  ['Barbería El Patrón', 'El Patrón Barber SAS', '901234567', '31', '2', 'mayorista', '3125550103', 'patron@example.com', 'Av. Principal # 12-40, Ciénaga'],
  ['Laura Gómez', '', '1098765432', '13', null, 'detal', '3135550104', 'laura@example.com', 'Calle 5 # 3-21, Ciénaga'],
  ['Andrés Pardo', '', '72345678', '13', null, 'detal', '3145550105', 'andres@example.com', 'Cra 8 # 10-33, Ciénaga'],
  ['Spa Capilar Bella', 'Bella Spa SAS', '900987654', '31', '6', 'mayorista', '3155550106', 'bella@example.com', 'Calle 72 # 20-10, Barranquilla'],
  ['Marcela Ríos', '', '1002003004', '13', null, 'detal', '3165550107', 'marcela@example.com', 'Cra 15 # 22-18, Ciénaga'],
  ['Estética Divina', '', '1122334455', '13', null, 'mayorista', '3175550108', 'divina@example.com', 'Calle 14 # 6-50, Fundación'],
];
const SUPPLIERS = [['Distribuciones Andinas SAS', '800111222', '1'], ['Importadora Belleza Total SAS', '800333444', '5'], ['Herramientas y Estilo Ltda', '800555666', '9']];

function mulberry(seed) { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const ean13 = (n) => { const b = '770' + String(n).padStart(9, '0'); let s = 0; for (let i = 0; i < 12; i++) s += +b[i] * (i % 2 ? 3 : 1); return b + ((10 - (s % 10)) % 10); };
const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
const ahead = (days) => iso(-days);

async function seedDemo(db, user, opts = {}) {
  const rnd = mulberry(opts.seed || 20261019);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const summary = { products: 0, clients: 0, suppliers: 0, sales: 0, purchases: 0, expenses: 0, einvoices: 0 };
  const taxes = db.prepare('SELECT id, rate FROM taxes ORDER BY id').all();
  const iva = taxes.find((t) => t.rate === 19).id;
  const cats = new Map(db.prepare('SELECT id, name FROM categories').all().map((c) => [c.name, c.id]));
  C.setSetting(db, 'company_nit', '900123456-7'); C.setSetting(db, 'company_address', 'Calle 45 # 12-30, Barranquilla');
  C.setSetting(db, 'company_phone', '3000000000'); C.setSetting(db, 'company_email', 'demo@example.com'); C.setSetting(db, 'company_city_code', '08001');
  C.setSetting(db, 'dian_text', 'DEMOSTRACIÓN · datos ficticios sin validez fiscal');
  EI.saveConfig(db, { provider: 'simulador', mode: 'sandbox' });

  // capital inicial
  C.postEntry(db, { date: iso(100), description: 'Aporte inicial de capital (demo)', source: 'manual', user_id: user.id,
    lines: [{ account_code: '111005', debit: 110000000 }, { account_code: '110505', debit: 5000000 }, { account_code: '310505', credit: 115000000 }] });

  // proveedores y clientes
  const mostrador = db.prepare("SELECT id FROM thirds WHERE name='Cliente mostrador'").get().id;
  db.prepare("UPDATE thirds SET name='Consumidor final (mostrador)', doc_id='222222222222', doc_type='13' WHERE id=?").run(mostrador);
  const sup = SUPPLIERS.map(([name, nit, dv]) => Number(db.prepare("INSERT INTO thirds(kind,doc_id,name,doc_type,dv,city_code,email) VALUES('proveedor',?,?, '31', ?, '08001', 'proveedor@example.com')").run(nit, name, dv).lastInsertRowid));
  summary.suppliers = sup.length;
  const cli = CLIENTS.map(([name, company, doc, type, dv, list, phone, email, addr]) => Number(db.prepare("INSERT INTO thirds(kind,doc_id,name,company,doc_type,dv,price_list,phone,email,address,city_code) VALUES('cliente',?,?,?,?,?,?,?,?,?,'08001')").run(doc, name, company || null, type, dv, list, phone, email, addr).lastInsertRowid));
  summary.clients = cli.length;

  // productos
  const prod = {};
  PRODUCTS.forEach((p, i) => {
    const [code, name, brand, cat, unit, ucode, price, price2, , min] = p;
    prod[code] = Number(db.prepare('INSERT INTO products(code,name,category_id,unit,unit_code,price,price2,brand,barcode,nso,min_stock,tax_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(code, name, cats.get(cat) || null, unit, ucode, price, price2, BRANDS[brand], ean13(7000 + i), 'NSOC' + String(30000 + i * 37), min, iva).lastInsertRowid);
  });
  prod['SV-001'] = Number(db.prepare("INSERT INTO products(code,name,unit,price,is_service,tax_id) VALUES('SV-001','Asesoría técnica en color (hora)','hora',60000,1,?)").run(iva).lastInsertRowid);
  summary.products = PRODUCTS.length + 1;

  // compras (lotes con vencimiento). Ronda 1 hace 75 días en tres pedidos; ronda 2 hace 30 días.
  const lotCode = (code, n) => code.replace('-', '') + '-' + String(n).padStart(2, '0');
  const buy = async (daysAgo, supplier, items, paid, extra = {}) => {
    const lines = items.map(([code, qty, expDays, n]) => { const p = PRODUCTS.find((x) => x[0] === code); return { product_id: prod[code], qty, price: p[8], lot: lotCode(code, n), expiry: ahead(expDays) }; });
    const doc = D.createDocument(db, user, { type: 'compra', date: iso(daysAgo), due_date: paid ? iso(daysAgo) : ahead(10), third_id: supplier, lines, ...extra });
    if (paid) D.registerPayment(db, user, { doc_id: doc.id, amount: doc.total, date: iso(daysAgo), account_code: '111005' });
    summary.purchases++;
  };
  const normalExp = [380, 540, 700, 250, 600, 460];
  const groups = [PRODUCTS.slice(0, 10), PRODUCTS.slice(10, 21), PRODUCTS.slice(21)];
  for (let g = 0; g < 3; g++) {
    const items = [];
    groups[g].forEach((p0, i) => {
      const p = [...p0]; p[10] = Math.round(p0[10] * 1.6);
      const sp = SPECIAL_LOTS[p[0]];
      if (sp) { const near = Math.min(sp[1], p[10]); items.push([p[0], near, sp[0], 1]); if (p[10] > near) items.push([p[0], p[10] - near, normalExp[(i + g) % 6], 2]); }
      else items.push([p[0], p[10], normalExp[(i + g) % 6], 1]);
    });
    // el último pedido queda a crédito para mostrar cuentas por pagar; los demás se pagan de contado
    const retefuente = g === 1 ? db.prepare("SELECT id FROM withholdings WHERE name LIKE 'Retefuente por compras%'").get().id : null;
    await buy(75 - g, sup[g], items, g === 2 ? 0 : true, retefuente ? { withholdings: [retefuente] } : {});
  }
  const dom = new Date().getUTCDate();
  await buy(Math.min(3, dom - 1), sup[1], [['SH-001', 10, 520, 4], ['AC-001', 10, 520, 4], ['TR-001', 8, 480, 3], ['AS-002', 10, 500, 3], ['KI-001', 6, 560, 2]], true);
  await buy(30, sup[0], [['SH-001', 12, 520, 3], ['AC-001', 12, 520, 3], ['TI-001', 24, 470, 3], ['TI-002', 24, 470, 3], ['TI-003', 24, 470, 3], ['ST-001', 18, 400, 3]], true);

  // ventas de los últimos 45 días
  const cashAcc = () => { const r = rnd(); return r < 0.4 ? '110505' : r < 0.72 ? '111010' : '111015'; };
  // un comercio no vende producto vencido: el artículo con lote vencido queda en inventario para mostrar la baja
// (los productos de baja rotación son justamente los que quedan con lotes por vencer)
const slow = Object.keys(SPECIAL_LOTS).map((c) => `'${c}'`).join(',');
  const sellable = db.prepare(`SELECT id, stock FROM products WHERE is_service=0 AND stock>0 AND code NOT IN (${slow})`);
  const sales = [];
  for (let d = 45; d >= 0; d--) {
    const dow = new Date(iso(d) + 'T12:00:00Z').getUTCDay();
    const n = dow === 0 ? 2 : dow === 6 ? 6 : 4 + (rnd() < 0.5 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const stockRows = sellable.all();
      const lines = [];
      const used = new Set();
      for (let i = 0; i < 1 + Math.floor(rnd() * 3); i++) {
        const r = pick(stockRows);
        if (used.has(r.id)) continue; used.add(r.id);
        lines.push({ product_id: r.id, qty: Math.max(1, Math.min(Math.floor(r.stock), 1 + Math.floor(rnd() * 3))), disc_pct: rnd() < 0.12 ? pick([5, 10]) : 0 });
      }
      if (rnd() < 0.05) lines.push({ product_id: prod['SV-001'], qty: 1 });
      if (!lines.length) continue;
      const named = rnd() < 0.4, third = named ? pick(cli) : mostrador;
      const mode = !named ? 'contado' : rnd() < 0.5 ? 'contado' : rnd() < 0.6 ? 'credito' : 'parcial';
      try {
        const doc = await D.createDocument(db, user, { type: 'venta', date: iso(d), due_date: mode === 'contado' ? iso(d) : iso(d - 15), third_id: third, lines, pay_now: 0 });
        sales.push({ id: doc.id, d, total: doc.total, third, mode });
        if (mode === 'contado') D.registerPayment(db, user, { doc_id: doc.id, amount: doc.total, date: iso(d), account_code: named ? pick(['111005', '111005', '110505', '111010']) : cashAcc() });
        else if (mode === 'parcial') D.registerPayment(db, user, { doc_id: doc.id, amount: Math.round(doc.total * 0.4), date: iso(d), account_code: '111005' });
        else if (d > 20 && rnd() < 0.45) D.registerPayment(db, user, { doc_id: doc.id, amount: doc.total, date: iso(Math.max(d - 8, 0)), account_code: '111005' });
        summary.sales++;
      } catch (e) { /* sin existencia suficiente: se omite esa venta */ }
    }
  }

  // una venta anulada (cobro y documento) para mostrar la trazabilidad
  const toVoid = sales.find((s) => s.mode === 'contado' && s.d <= 3) || sales[sales.length - 1];
  if (toVoid) { for (const p of db.prepare("SELECT id FROM payments WHERE doc_id=? AND status='activo'").all(toVoid.id)) D.voidPayment(db, user, p.id, iso(0)); D.voidDocument(db, user, toVoid.id, iso(0)); }

  // gastos mensuales
  const exp = async (daysAgo, desc, acc, price, taxId) => {
    D.createDocument(db, user, { type: 'gasto', date: iso(daysAgo), lines: [{ description: desc, qty: 1, price, account_code: acc, tax_id: taxId || '' }],
      pay_now: Math.round(price * (taxId ? 1.19 : 1) * 100) / 100, pay_account: '111005' });
    summary.expenses++;
  };
  // meses completos anteriores: el mes en curso solo muestra la operación comercial, sin depender del día del mes en que se genere
  for (const off of [92, 62, 32]) {
    await exp(off, 'Arriendo del local', '512010', 1200000); await exp(off, 'Servicio de energía', '513525', 280000);
    await exp(off, 'Internet y teléfono', '513535', 110000); await exp(off, 'Nómina del mes', '510506', 1800000);
    await exp(off - 1, 'Publicidad en redes', '519505', 300000, iva);
  }

  // usuarios de prueba por rol
  const pass = opts.password;
  for (const [u, name, role] of [['vendedor', 'Vendedor demo', 'vendedor'], ['contador', 'Contador demo', 'contador']]) {
    const { salt, hash } = C.hashPassword(pass);
    db.prepare('INSERT INTO users(username,name,salt,hash,role) VALUES(?,?,?,?,?)').run(u, name, salt, hash, role);
  }

  // facturas electrónicas de prueba (simulador) para las ventas, salvo las más recientes para que se pueda probar el envío
  const vigentes = db.prepare("SELECT id FROM documents WHERE type='venta' AND status='activo' ORDER BY date, id").all();
  for (const v of vigentes.slice(0, Math.max(0, vigentes.length - 8))) {
    const r = await EI.emit(db, user, v.id, 'factura'); if (r.status === 'aceptada') summary.einvoices++;
  }
  return summary;
}

module.exports = { seedDemo };
