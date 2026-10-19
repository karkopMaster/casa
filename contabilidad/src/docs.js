'use strict';
// Documentos comerciales (venta, compra, gasto), cobros/pagos y anulaciones.
const { tx } = require('./db');
const C = require('./core');
const { bad, round2, round4, num, needDate, today } = C;

const TYPES = ['venta', 'compra', 'gasto'];

function computeLines(db, type, rawLines, third) {
  if (!Array.isArray(rawLines) || !rawLines.length) throw bad('Agregue al menos una línea');
  const useInv = C.getSetting(db, 'use_inventory', '1') === '1';
  const out = [];
  for (const l of rawLines) {
    let product = null;
    if (l.product_id) {
      product = db.prepare('SELECT * FROM products WHERE id=?').get(num(l.product_id));
      if (!product) throw bad('Producto no encontrado');
      if (!product.active) throw bad(`El producto ${product.name} está inactivo`);
    } else if (!String(l.description || '').trim()) throw bad('Cada línea necesita un producto o una descripción');
    const qty = num(l.qty, 1);
    if (!(qty > 0)) throw bad('La cantidad debe ser mayor que cero');
    let price = l.price === undefined || l.price === '' || l.price === null ? null : num(l.price);
    if (price === null) {
      if (!product) price = 0;
      else if (type === 'venta') price = third && third.price_list === 'mayorista' && product.price2 > 0 ? product.price2 : product.price;
      else price = product.cost;
    }
    if (price < 0) throw bad('El precio no puede ser negativo');
    const disc_pct = num(l.disc_pct);
    if (disc_pct < 0 || disc_pct > 100) throw bad('El descuento debe estar entre 0 y 100');
    const taxId = l.tax_id !== undefined && l.tax_id !== '' && l.tax_id !== null ? num(l.tax_id) : (product ? product.tax_id : null);
    let tax_rate = 0;
    if (taxId) {
      const t = db.prepare('SELECT * FROM taxes WHERE id=?').get(taxId);
      if (!t) throw bad('Impuesto no encontrado');
      tax_rate = t.rate;
    }
    const gross = qty * price;
    const base = round2(gross - gross * disc_pct / 100);
    const tax_amount = round2(base * tax_rate / 100);
    const tracked = !!product && !product.is_service && useInv;
    let account_code = l.account_code ? String(l.account_code) : null;
    if (account_code) {
      const a = db.prepare('SELECT type FROM accounts WHERE code=?').get(account_code);
      if (!a) throw bad(`La cuenta ${account_code} no existe`);
    }
    out.push({
      product, tracked, qty, price, disc_pct, tax_id: taxId || null, tax_rate, base, tax_amount, total: round2(base + tax_amount),
      lot: String(l.lot || '').trim() || null, expiry: l.expiry || null, disc_amount: round2(gross - base), description: String(l.description || (product && product.name) || '').trim(), account_code,
    });
  }
  return out;
}

function createDocument(db, user, b) {
  const type = b.type;
  if (!TYPES.includes(type)) throw bad('Tipo de documento inválido');
  const date = needDate(b.date || today());
  const due = b.due_date ? needDate(b.due_date, 'fecha de vencimiento') : date;
  if (due < date) throw bad('El vencimiento no puede ser anterior a la fecha');
  return tx(db, () => {
    C.checkLock(db, date);
    let third = null;
    if (b.third_id) {
      third = db.prepare('SELECT * FROM thirds WHERE id=?').get(num(b.third_id));
      if (!third) throw bad('Tercero no encontrado');
    }
    const lines = computeLines(db, type, b.lines, third);
    const subtotal = round2(lines.reduce((s, l) => s + l.base, 0));
    const tax = round2(lines.reduce((s, l) => s + l.tax_amount, 0));
    const discount = round2(lines.reduce((s, l) => s + l.disc_amount, 0));
    // retenciones (Colombia): reducen lo que se cobra (ventas) o se paga (compras/gastos)
    const whs = [];
    for (const wid of Array.isArray(b.withholdings) ? b.withholdings : []) {
      const w = db.prepare('SELECT * FROM withholdings WHERE id=? AND active=1').get(num(wid));
      if (!w) throw bad('Retención no encontrada');
      if (w.applies !== (type === 'venta' ? 'venta' : 'compra')) throw bad(`La retención "${w.name}" no aplica a este documento`);
      const baseAmount = w.base === 'iva' ? tax : subtotal;
      whs.push({ ...w, base_amount: baseAmount, amount: round2(baseAmount * w.rate / 100) });
    }
    const withholding = round2(whs.reduce((s, w) => s + w.amount, 0));
    const total = round2(subtotal + tax - withholding);
    if (total < 0) throw bad('Las retenciones superan el valor del documento');
    let payNow = round2(num(b.pay_now, 0));
    if (payNow < 0 || payNow > total + 0.005) throw bad('El pago inmediato no puede ser mayor que el total');
    if (payNow > total) payNow = total;
    if (payNow < total && !third) throw bad('Para dejar saldo pendiente (crédito) seleccione un cliente/proveedor');
    if (type === 'venta' && !lines.length) throw bad('Venta sin líneas');

    let number = String(b.number || '').trim();
    if (!number || type === 'venta') number = C.nextNumber(db, type);
    else if (db.prepare('SELECT 1 FROM documents WHERE type=? AND number=?').get(type, number)) throw bad(`Ya existe la compra/gasto ${number}`);
    const r = db.prepare(`INSERT INTO documents(type,number,date,due_date,third_id,subtotal,discount,tax,withholding,total,ref,notes,user_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(type, number, date, due, third ? third.id : null, subtotal, discount, tax, withholding, total,
      b.ref || null, b.notes || null, user.id, new Date().toISOString());
    const docId = Number(r.lastInsertRowid);

    // stock agregado por producto (misma mercancía en varias líneas)
    if (type === 'venta' && C.getSetting(db, 'allow_negative_stock', '0') !== '1') {
      const need = new Map();
      for (const l of lines) if (l.tracked) need.set(l.product.id, (need.get(l.product.id) || 0) + l.qty);
      for (const [pid, q] of need) {
        const p = db.prepare('SELECT name, stock FROM products WHERE id=?').get(pid);
        if (p.stock < q - 1e-9) throw bad(`Existencia insuficiente de "${p.name}": hay ${p.stock}, se piden ${q}`);
      }
    }

    for (const w of whs) db.prepare('INSERT INTO doc_withholdings(doc_id,name,rate,base_amount,amount,account_code) VALUES(?,?,?,?,?,?)').run(docId, w.name, w.rate, w.base_amount, w.amount, w.account_code);
    const insLine = db.prepare(`INSERT INTO doc_lines(doc_id,product_id,description,qty,price,disc_pct,tax_id,tax_rate,base,tax_amount,total,unit_cost,account_code,lot,expiry)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const credits = new Map(), debits = new Map(); // cuenta -> valor
    const add = (m, k, v) => m.set(k, round2((m.get(k) || 0) + v));
    let cogs = 0;
    for (const l of lines) {
      let unitCost = 0;
      if (type === 'venta') {
        if (l.tracked) { const v = C.stockOut(db, l.product, date, 'venta', l.qty, docId); unitCost = round4(v / l.qty); cogs += v; C.lotsConsume(db, l.product.id, l.qty, docId); }
        add(credits, l.account_code || C.acct(db, 'acc_ingresos'), l.base);
      } else if (type === 'compra') {
        if (l.tracked) {
          unitCost = round4(l.base / l.qty);
          C.stockIn(db, l.product, date, 'compra', l.qty, unitCost, docId, null, l.base);
          C.lotAdd(db, l.product.id, l.lot, l.expiry, l.qty, unitCost, docId, date);
          add(debits, C.acct(db, 'acc_inventario'), l.base);
        } else add(debits, l.account_code || C.acct(db, 'acc_gastos_compras'), l.base);
      } else add(debits, l.account_code || C.acct(db, 'acc_gastos_diversos'), l.base);
      insLine.run(docId, l.product ? l.product.id : null, l.description, l.qty, l.price, l.disc_pct, l.tax_id, l.tax_rate, l.base, l.tax_amount, l.total, unitCost, l.account_code, l.lot, l.expiry);
    }
    cogs = round2(cogs);
    db.prepare('UPDATE documents SET cogs=? WHERE id=?').run(cogs, docId);

    const tid = third ? third.id : null;
    const desc = `${type === 'venta' ? 'Venta' : type === 'compra' ? 'Compra' : 'Gasto'} ${number}`;
    if (type === 'venta') {
      const lns = [{ account_code: C.acct(db, 'acc_cxc'), third_id: tid, debit: total }];
      for (const w of whs) lns.push({ account_code: w.account_code, third_id: tid, debit: w.amount, memo: w.name });
      for (const [a, v] of credits) lns.push({ account_code: a, credit: v });
      if (tax > 0) lns.push({ account_code: C.acct(db, 'acc_iva_ventas'), credit: tax });
      C.postEntry(db, { date, description: desc, source: 'venta', source_id: docId, user_id: user.id, lines: lns });
      if (cogs > 0) C.postEntry(db, { date, description: 'Costo de ' + desc, source: 'venta', source_id: docId, user_id: user.id,
        lines: [{ account_code: C.acct(db, 'acc_costo_ventas'), debit: cogs }, { account_code: C.acct(db, 'acc_inventario'), credit: cogs }] });
    } else {
      const lns = [];
      for (const [a, v] of debits) lns.push({ account_code: a, debit: v });
      if (tax > 0) lns.push({ account_code: C.acct(db, 'acc_iva_compras'), debit: tax });
      lns.push({ account_code: C.acct(db, 'acc_cxp'), third_id: tid, credit: total });
      for (const w of whs) lns.push({ account_code: w.account_code, third_id: tid, credit: w.amount, memo: w.name });
      C.postEntry(db, { date, description: desc, source: type, source_id: docId, user_id: user.id, lines: lns });
    }
    if (payNow > 0) registerPayment(db, user, { doc_id: docId, amount: payNow, date, account_code: b.pay_account || C.acct(db, 'acc_caja'), notes: 'Pago al contado' });
    return getDocument(db, docId);
  });
}

function getDocument(db, id) {
  const d = db.prepare(`SELECT d.*, t.name third_name, t.company third_company, t.doc_id third_doc, t.address third_address, t.phone third_phone, t.email third_email
    FROM documents d LEFT JOIN thirds t ON t.id=d.third_id WHERE d.id=?`).get(id);
  if (!d) throw new C.HttpError(404, 'Documento no encontrado');
  d.lines = db.prepare('SELECT * FROM doc_lines WHERE doc_id=? ORDER BY id').all(id);
  d.withholdings = db.prepare('SELECT * FROM doc_withholdings WHERE doc_id=?').all(id);
  d.payments = db.prepare("SELECT p.*, a.name account_name FROM payments p LEFT JOIN accounts a ON a.code=p.account_code WHERE doc_id=? ORDER BY id").all(id);
  d.balance = round2(d.total - d.paid);
  return d;
}

function registerPayment(db, user, b) {
  return tx(db, () => {
    const doc = db.prepare('SELECT * FROM documents WHERE id=?').get(num(b.doc_id));
    if (!doc) throw bad('Documento no encontrado');
    if (doc.status !== 'activo') throw bad('El documento está anulado');
    const date = needDate(b.date || today());
    C.checkLock(db, date);
    const amount = round2(num(b.amount));
    if (!(amount > 0)) throw bad('El valor debe ser mayor que cero');
    const balance = round2(doc.total - doc.paid);
    if (amount > balance + 0.005) throw bad(`El valor excede el saldo pendiente (${balance})`);
    const acc = db.prepare('SELECT code, type, active FROM accounts WHERE code=?').get(String(b.account_code || ''));
    if (!acc || acc.type !== 'activo' || !acc.active) throw bad('Seleccione una cuenta de caja o banco válida');
    const kind = doc.type === 'venta' ? 'cobro' : 'pago';
    const r = db.prepare('INSERT INTO payments(kind,date,doc_id,third_id,amount,account_code,notes,user_id) VALUES(?,?,?,?,?,?,?,?)')
      .run(kind, date, doc.id, doc.third_id, amount, acc.code, b.notes || null, user.id);
    const pid = Number(r.lastInsertRowid);
    const desc = `${kind === 'cobro' ? 'Cobro' : 'Pago'} ${doc.number}`;
    const lines = kind === 'cobro'
      ? [{ account_code: acc.code, debit: amount }, { account_code: C.acct(db, 'acc_cxc'), third_id: doc.third_id, credit: amount }]
      : [{ account_code: C.acct(db, 'acc_cxp'), third_id: doc.third_id, debit: amount }, { account_code: acc.code, credit: amount }];
    C.postEntry(db, { date, description: desc, source: kind, source_id: pid, user_id: user.id, lines });
    db.prepare('UPDATE documents SET paid=? WHERE id=?').run(round2(doc.paid + amount), doc.id);
    return db.prepare('SELECT * FROM payments WHERE id=?').get(pid);
  });
}

function voidPayment(db, user, id, date) {
  return tx(db, () => {
    const p = db.prepare('SELECT * FROM payments WHERE id=?').get(num(id));
    if (!p) throw new C.HttpError(404, 'Pago no encontrado');
    if (p.status !== 'activo') throw bad('El pago ya está anulado');
    date = needDate(date || today());
    db.prepare("UPDATE payments SET status='anulado' WHERE id=?").run(p.id);
    db.prepare('UPDATE documents SET paid=ROUND(paid-?,2) WHERE id=?').run(p.amount, p.doc_id);
    C.reverseEntries(db, p.kind, p.id, date, `Anulación de ${p.kind} #${p.id}`, user.id);
    return { ok: true };
  });
}

function voidDocument(db, user, id, date) {
  return tx(db, () => {
    const d = db.prepare('SELECT * FROM documents WHERE id=?').get(num(id));
    if (!d) throw new C.HttpError(404, 'Documento no encontrado');
    if (d.status !== 'activo') throw bad('El documento ya está anulado');
    if (db.prepare("SELECT 1 FROM payments WHERE doc_id=? AND status='activo'").get(d.id))
      throw bad('Primero anule los cobros/pagos aplicados a este documento');
    date = needDate(date || today());
    C.checkLock(db, date);
    if (d.type === 'compra') C.lotsVoidPurchase(db, d.id);
    if (d.type === 'venta') C.lotsRestore(db, d.id);
    const moves = db.prepare('SELECT * FROM stock_moves WHERE doc_id=? ORDER BY id DESC').all(d.id);
    for (const m of moves) {
      const p = db.prepare('SELECT * FROM products WHERE id=?').get(m.product_id);
      if (m.qty < 0) C.stockIn(db, p, date, 'anulacion', -m.qty, m.unit_cost, d.id, 'Anulación ' + d.number, -m.value);
      else {
        if (p.stock < m.qty - 1e-9 && C.getSetting(db, 'allow_negative_stock', '0') !== '1')
          throw bad(`No se puede anular: la mercancía de "${p.name}" ya se vendió o ajustó (existencia ${p.stock})`);
        C.stockOut(db, p, date, 'anulacion', m.qty, d.id, 'Anulación ' + d.number, m.unit_cost, m.value);
      }
    }
    C.reverseEntries(db, d.type, d.id, date, `Anulación ${d.number}`, user.id);
    db.prepare("UPDATE documents SET status='anulado' WHERE id=?").run(d.id);
    return getDocument(db, d.id);
  });
}

function createManualEntry(db, user, b) {
  return tx(db, () => {
    const id = C.postEntry(db, { date: b.date, description: b.description, source: 'manual', user_id: user.id, lines: b.lines });
    return { id };
  });
}
function voidManualEntry(db, user, id, date) {
  return tx(db, () => {
    const e = db.prepare('SELECT * FROM journal_entries WHERE id=?').get(num(id));
    if (!e) throw new C.HttpError(404, 'Asiento no encontrado');
    if (e.source !== 'manual') throw bad('Solo se anulan asientos manuales; los demás se anulan desde su documento');
    if (e.status !== 'activo') throw bad('El asiento ya está anulado');
    if (db.prepare("SELECT 1 FROM journal_entries WHERE source='manual-anul' AND source_id=?").get(e.id)) throw bad('El asiento ya fue anulado');
    date = needDate(date || today());
    // los asientos manuales usan su propio id como source_id para poder reversarse
    db.prepare('UPDATE journal_entries SET source_id=? WHERE id=?').run(e.id, e.id);
    C.reverseEntries(db, 'manual', e.id, date, `Anulación del asiento #${e.number}`, user.id);
    db.prepare("UPDATE journal_entries SET status='anulado' WHERE id=?").run(e.id); // informativo: los informes suman todos los asientos
    return { ok: true };
  });
}

module.exports = { createDocument, getDocument, registerPayment, voidPayment, voidDocument, createManualEntry, voidManualEntry };
