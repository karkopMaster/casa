'use strict';
// Rutas de la API REST (JSON). Cada ruta declara los roles permitidos.
const crypto = require('crypto');
const { tx } = require('./db');
const C = require('./core');
const D = require('./docs');
const R = require('./reports');
const G = require('./gateways');
const EI = require('./einvoice');
const { HttpError, bad, num, round2 } = C;

const ALL = ['admin', 'contador', 'vendedor'], ACC = ['admin', 'contador'], ADMIN = ['admin'];
const SESSION_MS = 12 * 3600 * 1000;
// identificador de la instalación (lo escribe el script de actualización) para comprobar qué versión corre realmente
const BUILD = (() => { try { return require('fs').readFileSync(require('path').join(__dirname, '..', 'build-id'), 'utf8').trim(); } catch { return ''; } })();

function build(db) {
  const routes = [];
  const on = (method, path, roles, fn) => {
    const keys = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, re, keys, roles, fn });
  };
  const sanitize = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, active: u.active });
  const str = (v) => (v === undefined || v === null ? null : String(v).trim() || null);
  const attempts = new Map();

  // ---------- público ----------
  // Código de instalación (SETUP_TOKEN): sin él nadie puede crear el primer administrador aunque conozca la dirección.
  const setupAttempts = { n: 0, t: 0 };
  on('GET', '/api/status', null, () => ({ build: BUILD, setup: C.isSetup(db), setup_token_required: !!process.env.SETUP_TOKEN && !C.isSetup(db) }));
  on('POST', '/api/setup', null, ({ body }) => {
    const want = process.env.SETUP_TOKEN;
    if (want) {
      if (Date.now() - setupAttempts.t > 600000) setupAttempts.n = 0;
      if (setupAttempts.n >= 10) throw new HttpError(429, 'Demasiados intentos. Espere 10 minutos.');
      const given = Buffer.from(String(body.setup_token || '').trim()), exp = Buffer.from(want);
      if (given.length !== exp.length || !crypto.timingSafeEqual(given, exp)) {
        setupAttempts.n++; setupAttempts.t = Date.now();
        throw new HttpError(403, 'Código de instalación incorrecto');
      }
    }
    C.setupCompany(db, body); return { ok: true };
  });
  on('POST', '/api/login', null, ({ body, ip }) => {
    const key = ip + '|' + String(body.username || '').toLowerCase();
    const a = attempts.get(key) || { n: 0, t: 0 };
    if (Date.now() - a.t > 300000) { a.n = 0; }
    if (a.n >= 8) throw new HttpError(429, 'Demasiados intentos. Espere 5 minutos.');
    const u = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(String(body.username || '').trim().toLowerCase());
    if (!u || !C.checkPassword(String(body.password || ''), u.salt, u.hash)) {
      attempts.set(key, { n: a.n + 1, t: Date.now() });
      throw new HttpError(401, 'Usuario o contraseña incorrectos');
    }
    attempts.delete(key);
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)').run(token, u.id, Date.now() + SESSION_MS);
    return { token, user: sanitize(u) };
  });
  on('POST', '/api/logout', ALL, ({ token }) => { db.prepare('DELETE FROM sessions WHERE token=?').run(token); return { ok: true }; });
  on('GET', '/api/me', ALL, ({ user }) => ({ user: sanitize(user), settings: publicSettings() }));
  on('POST', '/api/me/password', ALL, ({ user, body }) => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    if (!C.checkPassword(String(body.current || ''), u.salt, u.hash)) throw bad('La contraseña actual no es correcta');
    if (String(body.password || '').length < 8) throw bad('La nueva contraseña debe tener al menos 8 caracteres');
    const { salt, hash } = C.hashPassword(String(body.password));
    db.prepare('UPDATE users SET salt=?, hash=? WHERE id=?').run(salt, hash, user.id);
    return { ok: true };
  });

  function publicSettings() {
    const s = C.getSettings(db);
    for (const k of ['secret_key', 'einv_secret', 'einv_webhook_secret']) delete s[k]; // jamás se envían al navegador
    s.taxes = db.prepare('SELECT * FROM taxes WHERE active=1 ORDER BY id').all();
    s.gateways = db.prepare('SELECT id, name, provider FROM gateways WHERE active=1 ORDER BY id').all();
    s.withholdings = db.prepare('SELECT * FROM withholdings WHERE active=1 ORDER BY applies, id').all();
    s.categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
    s.pay_accounts = db.prepare("SELECT code,name FROM accounts WHERE type='activo' AND active=1 AND code LIKE '11%' ORDER BY code").all();
    return s;
  }

  // ---------- configuración ----------
  on('GET', '/api/settings', ALL, () => publicSettings());
  const SETTING_KEYS = ['company_name', 'company_nit', 'company_address', 'company_phone', 'currency', 'allow_negative_stock', 'lock_date',
    'pfx_venta', 'pfx_compra', 'pfx_gasto', 'use_inventory', 'track_lots', 'expiry_tiers', 'company_dv', 'company_city_code', 'company_email', 'decimals', 'dian_text', 'print_footer', ...Object.keys(C.DEFAULT_ROLES)];
  on('PUT', '/api/settings', ADMIN, ({ body }) => tx(db, () => {
    for (const k of SETTING_KEYS) {
      if (body[k] === undefined) continue;
      let v = String(body[k]);
      if (k === 'lock_date' && v) C.needDate(v, 'fecha de cierre');
      if (k.startsWith('acc_') && !db.prepare('SELECT 1 FROM accounts WHERE code=?').get(v)) throw bad(`La cuenta ${v} no existe`);
      if (k === 'expiry_tiers' && !R.parseTiers(v).length) throw bad('Formato de descuentos: días:porcentaje separados por coma, ej. 30:30,60:20,90:10');
      if (k === 'decimals') v = String(Math.min(2, Math.max(0, parseInt(v, 10) || 0)));
      if (k === 'allow_negative_stock' || k === 'use_inventory' || k === 'track_lots') v = v === '1' || v === 'true' ? '1' : '0';
      C.setSetting(db, k, v);
    }
    return publicSettings();
  }));
  on('POST', '/api/taxes', ADMIN, ({ body }) => {
    const rate = num(body.rate, -1);
    if (!str(body.name) || rate < 0 || rate > 100) throw bad('Indique nombre y una tarifa entre 0 y 100');
    const r = db.prepare('INSERT INTO taxes(name,rate) VALUES(?,?)').run(str(body.name), rate);
    return db.prepare('SELECT * FROM taxes WHERE id=?').get(Number(r.lastInsertRowid));
  });
  on('DELETE', '/api/taxes/:id', ADMIN, ({ params }) => {
    if (db.prepare('SELECT 1 FROM doc_lines WHERE tax_id=? LIMIT 1').get(params.id)) db.prepare('UPDATE taxes SET active=0 WHERE id=?').run(params.id);
    else { db.prepare('UPDATE products SET tax_id=NULL WHERE tax_id=?').run(params.id); db.prepare('DELETE FROM taxes WHERE id=?').run(params.id); }
    return { ok: true };
  });
  on('POST', '/api/withholdings', ADMIN, ({ body }) => {
    const rate = num(body.rate, -1);
    if (!str(body.name) || rate < 0 || rate > 100) throw bad('Indique nombre y una tarifa entre 0 y 100');
    if (!['compra', 'venta'].includes(body.applies)) throw bad('Indique si aplica a compras o a ventas');
    if (!['subtotal', 'iva'].includes(body.base)) throw bad('La base es el subtotal o el IVA');
    if (!db.prepare('SELECT 1 FROM accounts WHERE code=?').get(String(body.account_code))) throw bad('La cuenta no existe');
    const r = db.prepare('INSERT INTO withholdings(name,rate,base,applies,account_code) VALUES(?,?,?,?,?)').run(str(body.name), rate, body.base, body.applies, String(body.account_code));
    return db.prepare('SELECT * FROM withholdings WHERE id=?').get(Number(r.lastInsertRowid));
  });
  on('DELETE', '/api/withholdings/:id', ADMIN, ({ params }) => { db.prepare('UPDATE withholdings SET active=0 WHERE id=?').run(params.id); return { ok: true }; });
  on('POST', '/api/categories', ACC, ({ body }) => {
    if (!str(body.name)) throw bad('Indique el nombre');
    try { const r = db.prepare('INSERT INTO categories(name) VALUES(?)').run(str(body.name)); return { id: Number(r.lastInsertRowid), name: str(body.name) }; }
    catch (e) { throw bad('Esa categoría ya existe'); }
  });
  on('DELETE', '/api/categories/:id', ACC, ({ params }) => {
    db.prepare('UPDATE products SET category_id=NULL WHERE category_id=?').run(params.id);
    db.prepare('DELETE FROM categories WHERE id=?').run(params.id);
    return { ok: true };
  });

  // ---------- usuarios ----------
  on('GET', '/api/users', ADMIN, () => db.prepare('SELECT id,username,name,role,active FROM users ORDER BY id').all());
  on('POST', '/api/users', ADMIN, ({ body }) => {
    const username = String(body.username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw bad('Usuario: 3 a 30 caracteres (letras, números, . _ -)');
    if (String(body.password || '').length < 8) throw bad('La contraseña debe tener al menos 8 caracteres');
    if (!ALL.includes(body.role)) throw bad('Rol inválido');
    if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) throw bad('Ese usuario ya existe');
    const { salt, hash } = C.hashPassword(String(body.password));
    const r = db.prepare('INSERT INTO users(username,name,salt,hash,role) VALUES(?,?,?,?,?)').run(username, str(body.name) || username, salt, hash, body.role);
    return sanitize(db.prepare('SELECT * FROM users WHERE id=?').get(Number(r.lastInsertRowid)));
  });
  on('PUT', '/api/users/:id', ADMIN, ({ params, body, user }) => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(params.id);
    if (!u) throw new HttpError(404, 'Usuario no encontrado');
    const role = body.role ?? u.role, active = body.active === undefined ? u.active : (body.active ? 1 : 0);
    if (!ALL.includes(role)) throw bad('Rol inválido');
    if (u.id === user.id && (role !== 'admin' || !active)) throw bad('No puede quitarse a sí mismo el acceso de administrador');
    if (body.password) {
      if (String(body.password).length < 8) throw bad('La contraseña debe tener al menos 8 caracteres');
      const { salt, hash } = C.hashPassword(String(body.password));
      db.prepare('UPDATE users SET salt=?, hash=? WHERE id=?').run(salt, hash, u.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
    }
    db.prepare('UPDATE users SET name=?, role=?, active=? WHERE id=?').run(str(body.name) || u.name, role, active, u.id);
    if (!active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
    return sanitize(db.prepare('SELECT * FROM users WHERE id=?').get(u.id));
  });

  // ---------- terceros (clientes / proveedores) ----------
  on('GET', '/api/thirds', ALL, ({ query }) => {
    const kind = query.kind, q = '%' + String(query.q || '').trim() + '%';
    let sql = `SELECT t.*, COALESCE((SELECT SUM(total-paid) FROM documents WHERE third_id=t.id AND status='activo' AND type='venta'),0) receivable,
      COALESCE((SELECT SUM(total-paid) FROM documents WHERE third_id=t.id AND status='activo' AND type<>'venta'),0) payable
      FROM thirds t WHERE (t.name LIKE ? OR t.company LIKE ? OR t.doc_id LIKE ?)`;
    const args = [q, q, q];
    if (kind === 'cliente') sql += " AND t.kind IN ('cliente','ambos')";
    else if (kind === 'proveedor') sql += " AND t.kind IN ('proveedor','ambos')";
    if (query.all !== '1') sql += ' AND t.active=1';
    return db.prepare(sql + ' ORDER BY t.name LIMIT 500').all(...args);
  });
  const thirdArgs = (b) => {
    if (!str(b.name)) throw bad('Indique el nombre');
    const kind = ['cliente', 'proveedor', 'ambos'].includes(b.kind) ? b.kind : 'cliente';
    return [kind, str(b.doc_id), str(b.name), str(b.company), str(b.email), str(b.phone), str(b.address), b.price_list === 'mayorista' ? 'mayorista' : 'detal', EI.DOC_TYPES[b.doc_type] ? b.doc_type : '13', str(b.dv), str(b.city_code)];
  };
  on('POST', '/api/thirds', ALL, ({ body }) => {
    const r = db.prepare('INSERT INTO thirds(kind,doc_id,name,company,email,phone,address,price_list,doc_type,dv,city_code) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(...thirdArgs(body));
    return db.prepare('SELECT * FROM thirds WHERE id=?').get(Number(r.lastInsertRowid));
  });
  on('PUT', '/api/thirds/:id', ALL, ({ params, body }) => {
    db.prepare('UPDATE thirds SET kind=?,doc_id=?,name=?,company=?,email=?,phone=?,address=?,price_list=?,doc_type=?,dv=?,city_code=?,active=? WHERE id=?')
      .run(...thirdArgs(body), body.active === false || body.active === 0 ? 0 : 1, params.id);
    return db.prepare('SELECT * FROM thirds WHERE id=?').get(params.id);
  });
  on('GET', '/api/thirds/:id/statement', ALL, ({ params }) => {
    const t = db.prepare('SELECT * FROM thirds WHERE id=?').get(params.id);
    if (!t) throw new HttpError(404, 'No encontrado');
    const docs = db.prepare("SELECT id,type,number,date,due_date,total,paid,status FROM documents WHERE third_id=? ORDER BY date DESC, id DESC LIMIT 300").all(t.id);
    return { third: t, docs };
  });

  // ---------- productos ----------
  on('GET', '/api/products', ALL, ({ query, user }) => {
    const q = '%' + String(query.q || '').trim() + '%';
    let sql = `SELECT p.*, c.name category, t.rate tax_rate FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN taxes t ON t.id=p.tax_id
      WHERE (p.name LIKE ? OR p.code LIKE ? OR p.barcode LIKE ? OR p.brand LIKE ?)`;
    if (query.all !== '1') sql += ' AND p.active=1';
    const rows = db.prepare(sql + ' ORDER BY p.name LIMIT 1000').all(q, q, q, q);
    if (C.lotsOn(db)) { // sugerencia de descuento por el lote que saldrá primero (FEFO)
      const tiers = R.parseTiers(C.getSetting(db, 'expiry_tiers', '')), now = C.today(), first = new Map();
      for (const l of db.prepare('SELECT product_id, lot, expiry, qty_left FROM lots WHERE qty_left>0 AND expiry IS NOT NULL ORDER BY expiry, id').all()) if (!first.has(l.product_id)) first.set(l.product_id, l);
      for (const r of rows) {
        const l = first.get(r.id);
        if (!l) continue;
        const days = Math.floor((Date.parse(l.expiry) - Date.parse(now)) / 86400000);
        r.next_lot = { lot: l.lot, expiry: l.expiry, qty_left: l.qty_left, days_left: days, expired: days < 0 };
        r.sug = R.suggestDiscount(days, r.price, r.cost, tiers);
        r.sug2 = r.price2 > 0 ? R.suggestDiscount(days, r.price2, r.cost, tiers) : null;
      }
    }
    if (user.role === 'vendedor') for (const r of rows) { delete r.cost; } // el vendedor no ve costos
    return rows;
  });
  const productArgs = (b, id) => {
    const code = str(b.code), name = str(b.name);
    if (!code || !name) throw bad('Código y nombre son obligatorios');
    if (num(b.price) < 0 || num(b.min_stock) < 0) throw bad('Precio y mínimo no pueden ser negativos');
    if (db.prepare('SELECT 1 FROM products WHERE code=? AND id<>?').get(code, id || 0)) throw bad('Ya existe un producto con ese código');
    const barcode = str(b.barcode);
    if (barcode && db.prepare('SELECT 1 FROM products WHERE barcode=? AND id<>?').get(barcode, id || 0)) throw bad('Ya existe un producto con ese código de barras');
    if (num(b.price2) < 0) throw bad('El precio mayorista no puede ser negativo');
    return [code, name, b.category_id ? num(b.category_id) : null, str(b.unit) || 'und', num(b.price), num(b.min_stock), b.tax_id ? num(b.tax_id) : null, b.is_service ? 1 : 0, str(b.brand), barcode, str(b.nso), num(b.price2), ['94', 'MLT', 'GRM', 'KGM', 'LTR'].includes(b.unit_code) ? b.unit_code : '94'];
  };
  on('POST', '/api/products', ACC, ({ body }) => {
    const r = db.prepare('INSERT INTO products(code,name,category_id,unit,price,min_stock,tax_id,is_service,brand,barcode,nso,price2,unit_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...productArgs(body));
    return db.prepare('SELECT * FROM products WHERE id=?').get(Number(r.lastInsertRowid));
  });
  on('PUT', '/api/products/:id', ACC, ({ params, body }) => {
    const p = db.prepare('SELECT * FROM products WHERE id=?').get(params.id);
    if (!p) throw new HttpError(404, 'No encontrado');
    const a = productArgs(body, p.id);
    if (a[7] !== p.is_service && (p.stock !== 0 || db.prepare('SELECT 1 FROM stock_moves WHERE product_id=? LIMIT 1').get(p.id)))
      throw bad('No se puede cambiar entre producto y servicio si ya tiene movimientos de inventario');
    db.prepare('UPDATE products SET code=?,name=?,category_id=?,unit=?,price=?,min_stock=?,tax_id=?,is_service=?,brand=?,barcode=?,nso=?,price2=?,unit_code=?,active=? WHERE id=?')
      .run(...a, body.active === false || body.active === 0 ? 0 : 1, p.id);
    return db.prepare('SELECT * FROM products WHERE id=?').get(p.id);
  });
  on('POST', '/api/products/adjust', ACC, ({ body, user }) => C.adjustStock(db, user, body));
  on('POST', '/api/import/:what', ACC, ({ params, body, user }) => importRows(params.what, body.rows, user));

  function importRows(what, rows, user) {
    if (!Array.isArray(rows) || !rows.length) throw bad('No hay filas para importar');
    if (rows.length > 5000) throw bad('Máximo 5000 filas por importación');
    return tx(db, () => {
      let created = 0, updated = 0;
      const errors = [];
      rows.forEach((r, i) => {
        try {
          if (what === 'productos') {
            const code = str(r.code), name = str(r.name);
            if (!code || !name) throw new Error('falta código o nombre');
            let cat = null;
            if (str(r.category)) {
              db.prepare('INSERT OR IGNORE INTO categories(name) VALUES(?)').run(str(r.category));
              cat = db.prepare('SELECT id FROM categories WHERE name=?').get(str(r.category)).id;
            }
            const rate = str(r.iva) === null ? 19 : num(r.iva);
            const tx = db.prepare('SELECT id FROM taxes WHERE active=1 AND rate=? ORDER BY id').get(rate) || db.prepare('SELECT id FROM taxes WHERE active=1 ORDER BY id').get();
            const ex = db.prepare('SELECT id FROM products WHERE code=?').get(code);
            if (ex) { db.prepare('UPDATE products SET name=?, category_id=COALESCE(?,category_id), unit=COALESCE(?,unit), price=?, price2=?, brand=COALESCE(?,brand), barcode=COALESCE(?,barcode), nso=COALESCE(?,nso) WHERE id=?').run(name, cat, str(r.unit), num(r.price), num(r.price2), str(r.brand), str(r.barcode), str(r.nso), ex.id); updated++; }
            else {
              const ins = db.prepare('INSERT INTO products(code,name,category_id,unit,price,price2,min_stock,is_service,brand,barcode,nso,tax_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
                .run(code, name, cat, str(r.unit) || 'und', num(r.price), num(r.price2), num(r.min_stock), r.is_service ? 1 : 0, str(r.brand), str(r.barcode), str(r.nso), tx ? tx.id : null);
              created++;
              if (num(r.stock) > 0 && !r.is_service && num(r.cost) > 0)
                C.adjustStock(db, user, { product_id: Number(ins.lastInsertRowid), qty: num(r.stock), unit_cost: num(r.cost), kind: 'inicial', date: C.today(), notes: 'Importación', lot: r.lot, expiry: r.expiry || null });
            }
          } else if (what === 'terceros') {
            if (!str(r.name)) throw new Error('falta nombre');
            const kind = ['cliente', 'proveedor', 'ambos'].includes(r.kind) ? r.kind : 'cliente';
            db.prepare('INSERT INTO thirds(kind,doc_id,name,company,email,phone,address) VALUES(?,?,?,?,?,?,?)')
              .run(kind, str(r.doc_id), str(r.name), str(r.company), str(r.email), str(r.phone), str(r.address));
            created++;
          } else throw new Error('tipo desconocido');
        } catch (e) { errors.push(`Fila ${i + 1}: ${e.message}`); }
      });
      return { created, updated, errors: errors.slice(0, 50), error_count: errors.length };
    });
  }

  // ---------- documentos ----------
  const docTypeOk = (t) => { if (!['venta', 'compra', 'gasto'].includes(t)) throw bad('Tipo inválido'); return t; };
  on('GET', '/api/documents', ALL, ({ query, user }) => {
    const type = docTypeOk(query.type);
    if (user.role === 'vendedor' && type !== 'venta') throw new HttpError(403, 'Sin permiso');
    const args = [type];
    let sql = `SELECT d.id,d.number,d.date,d.due_date,d.total,d.paid,d.status,d.ref,t.name third FROM documents d LEFT JOIN thirds t ON t.id=d.third_id WHERE d.type=?`;
    if (query.from) { sql += ' AND d.date>=?'; args.push(C.needDate(query.from)); }
    if (query.to) { sql += ' AND d.date<=?'; args.push(C.needDate(query.to)); }
    if (query.q) { sql += ' AND (d.number LIKE ? OR t.name LIKE ?)'; args.push('%' + query.q + '%', '%' + query.q + '%'); }
    if (query.pending === '1') sql += " AND d.status='activo' AND d.total-d.paid>0.004";
    return db.prepare(sql + ' ORDER BY d.date DESC, d.id DESC LIMIT 500').all(...args);
  });
  on('GET', '/api/documents/:id', ALL, ({ params, user }) => {
    const d = D.getDocument(db, params.id);
    if (user.role === 'vendedor' && d.type !== 'venta') throw new HttpError(403, 'Sin permiso');
    d.einvoices = EI.forDoc(db, d.id);
    return d;
  });
  on('POST', '/api/documents', ALL, ({ body, user }) => {
    docTypeOk(body.type);
    if (user.role === 'vendedor' && body.type !== 'venta') throw new HttpError(403, 'Sin permiso');
    const doc = D.createDocument(db, user, body);
    // envío automático a la DIAN: si falla, la venta queda registrada y se puede reintentar desde la factura
    if (doc.type === 'venta' && C.getSetting(db, 'einv_autosend', '0') === '1' && EI.getConfig(db).provider !== 'none') {
      return EI.emit(db, user, doc.id, 'factura').then(() => D.getDocument(db, doc.id)).catch(() => doc);
    }
    return doc;
  });
  on('POST', '/api/documents/:id/void', ACC, async ({ params, body, user }) => {
    const id = num(params.id);
    if (db.prepare("SELECT 1 FROM documents WHERE id=? AND type='venta' AND status='activo'").get(id)) await EI.creditNoteIfNeeded(db, user, id, body.reason);
    return D.voidDocument(db, user, id, body.date);
  });
  // ---------- facturación electrónica ----------
  on('GET', '/api/einvoice/config', ADMIN, () => EI.publicConfig(db));
  on('PUT', '/api/einvoice/config', ADMIN, ({ body }) => EI.saveConfig(db, body));
  on('GET', '/api/einvoice/pending', ACC, () => EI.listPending(db));
  on('GET', '/api/documents/:id/einvoice/check', ALL, ({ params }) => {
    const p = EI.buildPayload(db, num(params.id), 'factura');
    return { ...EI.readiness(db, num(params.id), p), provider: EI.getConfig(db).provider };
  });
  on('POST', '/api/documents/:id/einvoice', ALL, ({ params, user }) => EI.emit(db, user, num(params.id), 'factura'));
  on('POST', '/api/einvoice/webhook', null, ({ body, raw, headers }) => EI.handleWebhook(db, headers || {}, raw || '', body));
  on('POST', '/api/payments', ALL, ({ body, user }) => {
    if (user.role === 'vendedor') {
      const d = db.prepare('SELECT type FROM documents WHERE id=?').get(num(body.doc_id));
      if (!d || d.type !== 'venta') throw new HttpError(403, 'Sin permiso');
    }
    return D.registerPayment(db, user, body);
  });
  on('POST', '/api/payments/:id/void', ACC, ({ params, body, user }) => D.voidPayment(db, user, params.id, body.date));
  on('GET', '/api/payments', ACC, ({ query }) => {
    const { from, to } = { from: query.from || '0000-01-01', to: query.to || '9999-12-31' };
    return db.prepare(`SELECT p.*, d.number doc_number, t.name third FROM payments p JOIN documents d ON d.id=p.doc_id LEFT JOIN thirds t ON t.id=p.third_id
      WHERE p.date>=? AND p.date<=? ORDER BY p.date DESC, p.id DESC LIMIT 500`).all(from, to);
  });

  // ---------- contabilidad ----------
  on('GET', '/api/accounts', ACC, () => db.prepare('SELECT * FROM accounts ORDER BY code').all());
  on('POST', '/api/accounts', ACC, ({ body }) => {
    const code = str(body.code), name = str(body.name);
    if (!code || !/^\d{1,12}$/.test(code) || !name) throw bad('Código numérico y nombre son obligatorios');
    if (!C.ACCOUNT_TYPES.includes(body.type)) throw bad('Tipo de cuenta inválido');
    if (db.prepare('SELECT 1 FROM accounts WHERE code=?').get(code)) throw bad('Ya existe una cuenta con ese código');
    db.prepare('INSERT INTO accounts(code,name,type,nature) VALUES(?,?,?,?)').run(code, name, body.type, C.natureOf(body.type));
    return db.prepare('SELECT * FROM accounts WHERE code=?').get(code);
  });
  on('PUT', '/api/accounts/:code', ACC, ({ params, body }) => {
    const a = db.prepare('SELECT * FROM accounts WHERE code=?').get(params.code);
    if (!a) throw new HttpError(404, 'No encontrada');
    const roleUse = Object.keys(C.DEFAULT_ROLES).find((k) => C.getSetting(db, k, C.DEFAULT_ROLES[k]) === a.code);
    if (body.active === false && roleUse) throw bad('Esta cuenta está en uso en la configuración; cámbiela primero');
    db.prepare('UPDATE accounts SET name=?, active=? WHERE code=?').run(str(body.name) || a.name, body.active === false ? 0 : 1, a.code);
    return db.prepare('SELECT * FROM accounts WHERE code=?').get(a.code);
  });
  on('POST', '/api/entries', ACC, ({ body, user }) => D.createManualEntry(db, user, body));
  on('POST', '/api/entries/:id/void', ACC, ({ params, body, user }) => D.voidManualEntry(db, user, params.id, body.date));

  // ---------- pasarelas de pago ----------
  on('GET', '/api/gateways', ADMIN, () => ({ gateways: G.listGateways(db), providers: Object.entries(G.PROVIDERS).map(([k, v]) => ({ id: k, label: v.label })), events: G.recentEvents(db) }));
  on('POST', '/api/gateways', ADMIN, ({ body }) => ({ id: G.saveGateway(db, null, body) }));
  on('PUT', '/api/gateways/:id', ADMIN, ({ params, body }) => ({ id: G.saveGateway(db, num(params.id), body) }));
  on('DELETE', '/api/gateways/:id', ADMIN, ({ params }) => { db.prepare('UPDATE gateways SET active=0 WHERE id=?').run(params.id); return { ok: true }; });
  on('POST', '/api/gateways/settle', ACC, ({ body, user }) => G.settle(db, user, body));
  on('POST', '/api/documents/:id/pay-link', ALL, ({ params, body, user }) => G.createPayLink(db, user, { gateway_id: body.gateway_id, doc_id: params.id }));
  // público: lo llama la pasarela; la autenticidad se comprueba con la firma del evento
  on('POST', '/api/gateways/:id/webhook', null, ({ params, body, raw, headers }) => G.handleWebhook(db, params.id, headers || {}, raw || '', body));

  // ---------- informes ----------
  on('GET', '/api/reports/dashboard', ACC, () => R.dashboard(db));
  on('GET', '/api/reports/trial', ACC, ({ query }) => R.trialBalance(db, query));
  on('GET', '/api/reports/income', ACC, ({ query }) => R.incomeStatement(db, query));
  on('GET', '/api/reports/balance', ACC, ({ query }) => R.balanceSheet(db, query));
  on('GET', '/api/reports/ledger', ACC, ({ query }) => R.ledger(db, query));
  on('GET', '/api/reports/journal', ACC, ({ query }) => R.journal(db, query));
  on('GET', '/api/reports/sales', ACC, ({ query }) => R.salesReport(db, query));
  on('GET', '/api/reports/aging', ACC, ({ query }) => R.agingReport(db, query));
  on('GET', '/api/reports/inventory', ACC, () => R.inventoryReport(db));
  on('GET', '/api/reports/lots', ACC, ({ query }) => R.lotsReport(db, query));
  on('GET', '/api/reports/kardex', ACC, ({ query }) => R.kardex(db, query));
  // el vendedor ve un resumen propio simple
  on('GET', '/api/reports/my-sales', ALL, ({ user }) => db.prepare(`SELECT date, COUNT(*) n, ROUND(SUM(total),2) total FROM documents WHERE type='venta' AND status='activo' AND user_id=? GROUP BY date ORDER BY date DESC LIMIT 15`).all(user.id));

  function authenticate(token) {
    if (!token) return null;
    const s = db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(token, Date.now());
    if (!s) return null;
    return db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(s.user_id) || null;
  }

  function dispatch(method, path, query, body, token, ip, extra = {}) {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      let user = null;
      if (r.roles) {
        user = authenticate(token);
        if (!user) throw new HttpError(401, 'Sesión expirada. Ingrese de nuevo.');
        if (!r.roles.includes(user.role)) throw new HttpError(403, 'No tiene permiso para esta acción');
      }
      return r.fn({ params, query, body: body || {}, user, token, ip, raw: extra.raw, headers: extra.headers });
    }
    throw new HttpError(404, 'Ruta no encontrada');
  }
  return { dispatch, authenticate };
}

module.exports = { build };
