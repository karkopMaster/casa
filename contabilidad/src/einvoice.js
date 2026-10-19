'use strict';
// Facturación electrónica (DIAN, Colombia) a través de un proveedor tecnológico autorizado.
// El sistema arma un documento normalizado con los datos que exige la DIAN y lo entrega a un adaptador:
//   simulador → pruebas locales sin validez fiscal · generico → POST JSON a la URL del proveedor/puente configurado.
// Los adaptadores propios de cada proveedor (Factus, Alegra, Siigo…) se añaden en ADAPTERS cuando se tenga su documentación y credenciales.
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const { tx } = require('./db');
const C = require('./core');
const D = require('./docs');
const G = require('./gateways');
const { bad, round2, num } = C;

const DOC_TYPES = { '13': 'Cédula de ciudadanía', '31': 'NIT', '22': 'Cédula de extranjería', '41': 'Pasaporte', '12': 'Tarjeta de identidad', '42': 'Documento de identificación extranjero' };
const FINAL_CONSUMER = { id_type_code: '13', id_number: '222222222222', dv: null, name: 'Consumidor final', email: null, phone: null, address: null, city_code: null };
const ACCEPTED = ['accepted', 'aceptada', 'aceptado', 'approved', 'validated', 'validada', 'validado', 'success', 'ok', 'autorizada'];
const REJECTED = ['rejected', 'rechazada', 'rechazado', 'failed', 'error', 'denegada'];
// Evita que un negocio use la facturación electrónica para atacar servicios internos del servidor (SSRF).
function isPrivateIp(ip) {
  ip = String(ip).toLowerCase();
  if (ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7))) ip = ip.slice(7);
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0);
  }
  if (net.isIPv6(ip)) return ip === '::' || ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
  return true;
}
function urlProblem(u) { // comprobaciones sin red; devuelve el motivo o null
  let url; try { url = new URL(u); } catch { return 'URL inválida'; }
  if (url.protocol !== 'https:') return 'La URL debe usar https';
  if (url.port && url.port !== '443') return 'Solo se permite el puerto 443';
  if (url.username || url.password) return 'La URL no puede incluir usuario o clave';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return 'Dirección no permitida';
  if (net.isIP(host) && isPrivateIp(host)) return 'No se permiten direcciones internas';
  return null;
}
async function assertPublicUrl(u) { // además resuelve el dominio y rechaza si apunta a una dirección interna
  const p = urlProblem(u); if (p) throw bad(p);
  const host = new URL(u).hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return;
  let addrs; try { addrs = await dns.lookup(host, { all: true }); } catch { throw bad('No se pudo resolver el dominio del proveedor'); }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw bad('El dominio apunta a una dirección interna: no permitido');
}
const dig = (o, path) => (path ? path.split('.').reduce((v, k) => (v == null ? v : v[k]), o) : undefined);

// ---- configuración (el secreto se guarda cifrado) ----
const KEYS = ['provider', 'mode', 'url', 'url_nc', 'auth', 'user', 'header', 'map_status', 'map_number', 'map_cufe', 'map_qr', 'map_pdf', 'resolution', 'autosend'];
function getConfig(db) {
  const c = {};
  for (const k of KEYS) c[k] = C.getSetting(db, 'einv_' + k, '');
  c.provider = c.provider || 'none'; c.mode = c.mode || 'sandbox'; c.auth = c.auth || 'bearer';
  return c;
}
function publicConfig(db) {
  const c = getConfig(db);
  c.has_secret = !!C.getSetting(db, 'einv_secret', ''); c.has_webhook_secret = !!C.getSetting(db, 'einv_webhook_secret', '');
  c.providers = [{ id: 'none', label: 'Sin facturación electrónica' }, { id: 'simulador', label: 'Simulador (pruebas, sin validez ante la DIAN)' }, { id: 'generico', label: 'Proveedor por API REST/JSON (configurable)' }];
  return c;
}
function saveConfig(db, b) {
  if (!['none', 'simulador', 'generico'].includes(b.provider)) throw bad('Proveedor no soportado');
  if (b.provider === 'generico') {
    const p1 = urlProblem(String(b.url || '')) || (b.url_nc ? urlProblem(String(b.url_nc)) : null);
    if (p1) throw bad('URL del proveedor: ' + p1);
  }
  return tx(db, () => {
    for (const k of KEYS) if (b[k] !== undefined) C.setSetting(db, 'einv_' + k, k === 'autosend' ? (b[k] === true || b[k] === '1' ? '1' : '0') : String(b[k]).trim());
    if (b.secret) C.setSetting(db, 'einv_secret', G.seal(db, String(b.secret).trim()));
    if (b.webhook_secret) C.setSetting(db, 'einv_webhook_secret', G.seal(db, String(b.webhook_secret).trim()));
    for (const k of ['company_dv', 'company_city_code', 'company_email']) if (b[k] !== undefined) C.setSetting(db, k, String(b[k]).trim());
    return publicConfig(db);
  });
}

// ---- documento normalizado ----
function paymentMethodCode(db, doc) {
  const p = doc.payments.find((x) => x.status === 'activo');
  if (!p) return '1'; // instrumento no definido (venta a crédito)
  return p.account_code.startsWith('1105') ? '10' : p.account_code === '111015' ? '48' : '47';
}
function buildPayload(db, docId, kind, opts = {}) {
  const doc = D.getDocument(db, docId);
  const cfg = getConfig(db), S = C.getSettings(db);
  const t = doc.third_id ? db.prepare('SELECT * FROM thirds WHERE id=?').get(doc.third_id) : null;
  const customer = t ? { id_type_code: t.doc_type || '13', id_number: String(t.doc_id || '').replace(/[^0-9A-Za-z]/g, ''), dv: t.dv || null, name: t.company || t.name, email: t.email, phone: t.phone, address: t.address, city_code: t.city_code } : { ...FINAL_CONSUMER };
  const units = new Map(db.prepare('SELECT id, unit_code, code FROM products').all().map((p) => [p.id, p]));
  const lines = doc.lines.map((l, i) => {
    const gross = round2(l.qty * l.price), p = l.product_id ? units.get(l.product_id) : null;
    return { n: i + 1, code: p ? p.code : 'SERV', description: l.description, quantity: l.qty, unit_code: p ? p.unit_code : '94', unit_price: l.price, discount_pct: l.disc_pct, discount_amount: round2(gross - l.base),
      tax: { code: '01', name: 'IVA', rate: l.tax_rate, base: l.base, amount: l.tax_amount }, line_total: l.base };
  });
  const payload = {
    type: kind === 'nota_credito' ? 'credit_note' : 'invoice', environment: cfg.mode, number: doc.number, issue_date: doc.date, due_date: doc.due_date, currency: 'COP',
    payment_form: doc.balance > 0.004 && doc.paid === 0 ? { code: '2', name: 'Crédito' } : { code: '1', name: 'Contado' }, payment_method_code: paymentMethodCode(db, doc),
    resolution: cfg.resolution || null,
    supplier: { name: S.company_name, id_type_code: '31', id_number: String(S.company_nit || '').split('-')[0].replace(/\D/g, ''), dv: S.company_dv || String(S.company_nit || '').split('-')[1] || null, address: S.company_address, phone: S.company_phone, email: S.company_email || null, city_code: S.company_city_code || null },
    customer, lines,
    totals: { subtotal: doc.subtotal, discount: doc.discount, tax_total: doc.tax, withholding: doc.withholding, total: round2(doc.subtotal + doc.tax), payable: doc.total },
    notes: doc.notes || null,
  };
  if (kind === 'nota_credito') {
    const orig = db.prepare("SELECT * FROM einvoices WHERE doc_id=? AND kind='factura' AND status='aceptada' ORDER BY id DESC").get(docId);
    payload.reference = { number: orig && orig.number, cufe: orig && orig.cufe, date: doc.date };
    payload.credit_note_reason = { code: '2', description: opts.reason || 'Anulación de factura electrónica' }; // 2 = anulación
  }
  return payload;
}

// Revisa lo mínimo que la DIAN rechazaría. errors bloquean el envío; warnings solo avisan.
function readiness(db, docId, payload) {
  const errors = [], warnings = [];
  const s = payload.supplier, c = payload.customer;
  if (!s.id_number) errors.push('Falta el NIT de la empresa (Configuración → Empresa).');
  if (!s.dv) errors.push('Falta el dígito de verificación del NIT (escriba el NIT como 900123456-7).');
  if (!s.address) errors.push('Falta la dirección de la empresa.');
  if (!payload.resolution && payload.environment === 'production') errors.push('Falta la resolución de numeración DIAN.');
  if (!c.id_number) errors.push('El cliente no tiene número de documento.');
  if (c.id_type_code === '31' && !c.dv) errors.push('El cliente con NIT necesita dígito de verificación.');
  if (!c.email && c.id_number !== FINAL_CONSUMER.id_number) warnings.push('El cliente no tiene correo: no recibirá la factura electrónica.');
  if (!payload.lines.length) errors.push('La factura no tiene líneas.');
  return { errors, warnings };
}

// ---- adaptadores ----
const ADAPTERS = {
  simulador: async (db, cfg, payload) => {
    const cufe = crypto.createHash('sha384').update(JSON.stringify(payload) + Date.now()).digest('hex');
    return { status: 'aceptada', number: payload.number, cufe, qr_url: `https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=${cufe}`, pdf_url: null, message: 'SIMULACIÓN: sin validez ante la DIAN' };
  },
  generico: async (db, cfg, payload, fetchFn) => {
    const url = payload.type === 'credit_note' ? (cfg.url_nc || cfg.url) : cfg.url;
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    const secret = G.open(db, C.getSetting(db, 'einv_secret', ''));
    if (cfg.auth === 'bearer' && secret) headers.Authorization = 'Bearer ' + secret;
    else if (cfg.auth === 'basic') headers.Authorization = 'Basic ' + Buffer.from(cfg.user + ':' + secret).toString('base64');
    else if (cfg.auth === 'header' && cfg.header && secret) headers[cfg.header] = secret;
    let r;
    try {
      if (fetchFn === fetch) await assertPublicUrl(url); // en producción: nunca hacia direcciones internas
      r = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(payload), redirect: 'manual' });
    }
    catch (e) { return { status: 'error', message: 'No se pudo contactar al proveedor: ' + e.message }; }
    const text = await r.text(), json = (() => { try { return JSON.parse(text); } catch { return null; } })();
    const msg = (json && (json.message || json.error || (json.errors && JSON.stringify(json.errors)))) || text.slice(0, 300);
    if (!r.ok) return { status: r.status >= 500 ? 'error' : 'rechazada', message: `HTTP ${r.status}: ${msg}`, response: text.slice(0, 4000) };
    const st = String(dig(json, cfg.map_status) ?? '').toLowerCase();
    const status = !cfg.map_status ? 'enviada' : ACCEPTED.includes(st) ? 'aceptada' : REJECTED.includes(st) ? 'rechazada' : 'enviada';
    return { status, number: dig(json, cfg.map_number) || null, cufe: dig(json, cfg.map_cufe) || null, qr_url: dig(json, cfg.map_qr) || null, pdf_url: dig(json, cfg.map_pdf) || null, message: status === 'enviada' ? 'Enviada; pendiente de confirmación de la DIAN' : (json && json.message) || '', response: text.slice(0, 4000) };
  },
};

function getRow(db, id) { return db.prepare('SELECT * FROM einvoices WHERE id=?').get(id); }
const now = () => new Date().toISOString();

// Emite factura o nota crédito. Nunca lanza por fallos del proveedor: deja la fila en 'error'/'rechazada' para reintentar.
async function emit(db, user, docId, kind = 'factura', opts = {}, fetchFn = fetch) {
  const cfg = getConfig(db);
  if (cfg.provider === 'none' || !ADAPTERS[cfg.provider]) throw bad('Configure un proveedor de facturación electrónica (Configuración → Facturación electrónica)');
  const doc = D.getDocument(db, num(docId));
  if (doc.type !== 'venta') throw bad('Solo se facturan electrónicamente las ventas');
  if (kind === 'factura') {
    if (doc.status !== 'activo') throw bad('El documento está anulado');
    if (db.prepare("SELECT 1 FROM einvoices WHERE doc_id=? AND kind='factura' AND status IN ('aceptada','enviada')").get(doc.id)) throw bad('Esta venta ya tiene factura electrónica enviada o aceptada');
  } else if (!db.prepare("SELECT 1 FROM einvoices WHERE doc_id=? AND kind='factura' AND status='aceptada'").get(doc.id)) throw bad('No hay factura electrónica aceptada para generar la nota crédito');
  const payload = buildPayload(db, doc.id, kind, opts);
  const chk = readiness(db, doc.id, payload);
  if (chk.errors.length) throw bad('No se puede enviar a la DIAN: ' + chk.errors.join(' '));
  const id = Number(db.prepare('INSERT INTO einvoices(doc_id,kind,status,provider,reason,created_at,updated_at,user_id) VALUES(?,?,?,?,?,?,?,?)').run(doc.id, kind, 'pendiente', cfg.provider, opts.reason || null, now(), now(), user && user.id).lastInsertRowid);
  let res;
  try { res = await ADAPTERS[cfg.provider](db, cfg, payload, fetchFn); } catch (e) { res = { status: 'error', message: 'Error interno del adaptador: ' + e.message }; }
  db.prepare('UPDATE einvoices SET status=?, number=?, cufe=?, qr_url=?, pdf_url=?, message=?, response=?, updated_at=? WHERE id=?')
    .run(res.status, res.number || null, res.cufe || null, res.qr_url || null, res.pdf_url || null, res.message || null, res.response || null, now(), id);
  if (res.status === 'aceptada' && kind === 'factura' && res.number) db.prepare("UPDATE documents SET ref=? WHERE id=? AND (ref IS NULL OR ref='')").run(res.number, doc.id);
  const row = getRow(db, id); row.warnings = chk.warnings;
  return row;
}

// Confirmación asíncrona del proveedor (la DIAN valida después de recibir): POST firmado con HMAC-SHA256 en X-Signature.
function handleWebhook(db, headers, raw, body) {
  const secret = G.open(db, C.getSetting(db, 'einv_webhook_secret', ''));
  if (!secret) throw new C.HttpError(400, 'Configure el secreto de eventos de facturación electrónica');
  const given = String(headers['x-signature'] || ''), want = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  if (given.length !== want.length || !crypto.timingSafeEqual(Buffer.from(given.toLowerCase()), Buffer.from(want))) throw new C.HttpError(401, 'Firma inválida');
  let row = body.einvoice_id ? getRow(db, num(body.einvoice_id)) : null;
  if (!row && body.reference) row = db.prepare("SELECT e.* FROM einvoices e JOIN documents d ON d.id=e.doc_id WHERE d.number=? ORDER BY e.id DESC").get(String(body.reference));
  if (!row) throw new C.HttpError(404, 'Factura electrónica no encontrada');
  const st = String(body.status || '').toLowerCase();
  const status = ACCEPTED.includes(st) ? 'aceptada' : REJECTED.includes(st) ? 'rechazada' : row.status;
  db.prepare('UPDATE einvoices SET status=?, number=COALESCE(?,number), cufe=COALESCE(?,cufe), qr_url=COALESCE(?,qr_url), pdf_url=COALESCE(?,pdf_url), message=COALESCE(?,message), updated_at=? WHERE id=?')
    .run(status, body.number || null, body.cufe || null, body.qr_url || null, body.pdf_url || null, body.message || null, now(), row.id);
  if (status === 'aceptada' && row.kind === 'factura' && body.number) db.prepare("UPDATE documents SET ref=? WHERE id=? AND (ref IS NULL OR ref='')").run(body.number, row.doc_id);
  return { ok: true, status };
}

// Antes de anular una venta ya aceptada por la DIAN hay que emitir la nota crédito; si no se acepta, no se anula.
async function creditNoteIfNeeded(db, user, docId, reason, fetchFn = fetch) {
  const fac = db.prepare("SELECT * FROM einvoices WHERE doc_id=? AND kind='factura' ORDER BY id DESC").get(docId);
  if (!fac || ['pendiente', 'rechazada', 'error'].includes(fac.status)) return null;
  if (fac.status === 'enviada') throw bad('La factura electrónica está pendiente de confirmación de la DIAN. Espere la confirmación para generar la nota crédito.');
  if (db.prepare("SELECT 1 FROM einvoices WHERE doc_id=? AND kind='nota_credito' AND status='aceptada'").get(docId)) return null;
  const nc = await emit(db, user, docId, 'nota_credito', { reason }, fetchFn);
  if (nc.status !== 'aceptada') throw bad('La nota crédito no fue aceptada (' + (nc.message || nc.status) + '). La venta no se anuló.');
  return nc;
}

function listPending(db) {
  return db.prepare(`SELECT e.*, d.number doc_number, d.total FROM einvoices e JOIN documents d ON d.id=e.doc_id WHERE e.status IN ('error','rechazada','enviada') ORDER BY e.id DESC LIMIT 100`).all();
}
function forDoc(db, docId) { return db.prepare('SELECT id,kind,status,number,cufe,qr_url,pdf_url,provider,message,created_at FROM einvoices WHERE doc_id=? ORDER BY id DESC').all(docId); }

module.exports = { isPrivateIp, urlProblem, assertPublicUrl, DOC_TYPES, getConfig, publicConfig, saveConfig, buildPayload, readiness, emit, handleWebhook, creditNoteIfNeeded, listPending, forDoc };
