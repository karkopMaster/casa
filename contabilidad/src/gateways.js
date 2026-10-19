'use strict';
// Pasarelas de pago: enlaces de cobro, confirmación automática por webhook y liquidación contable.
// Implementado: Wompi (enlaces de pago + eventos firmados) y "Webhook genérico" (HMAC-SHA256) para cualquier otra pasarela.
const crypto = require('crypto');
const { tx } = require('./db');
const C = require('./core');
const D = require('./docs');
const { bad, round2, num } = C;

const PROVIDERS = {
  wompi: { label: 'Wompi (Bancolombia)', api: { sandbox: 'https://sandbox.wompi.co/v1', production: 'https://production.wompi.co/v1' } },
  generico: { label: 'Otra pasarela (webhook genérico)' },
};

// ---- secretos cifrados en reposo (AES-256-GCM). La llave sale de SECRET_KEY o, si no existe, se genera y guarda en la base. ----
function masterKey(db) {
  let raw = process.env.SECRET_KEY;
  if (!raw) {
    raw = C.getSetting(db, 'secret_key', '');
    if (!raw) { raw = crypto.randomBytes(32).toString('hex'); C.setSetting(db, 'secret_key', raw); }
  }
  return crypto.createHash('sha256').update(raw).digest();
}
function seal(db, text) {
  if (!text) return null;
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', masterKey(db), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
function open(db, blob) {
  if (!blob) return '';
  const [iv, tag, enc] = blob.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', masterKey(db), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

const publicView = (g) => ({
  id: g.id, provider: g.provider, provider_label: (PROVIDERS[g.provider] || {}).label, name: g.name, mode: g.mode, public_key: g.public_key,
  link_template: g.link_template, account_code: g.account_code, active: g.active,
  has_private_key: !!g.private_key_enc, has_events_secret: !!g.events_secret_enc,
});
const listGateways = (db) => db.prepare('SELECT * FROM gateways ORDER BY id').all().map(publicView);

function saveGateway(db, id, b) {
  if (!PROVIDERS[b.provider]) throw bad('Pasarela no soportada');
  const name = String(b.name || '').trim();
  if (!name) throw bad('Indique un nombre');
  const acc = db.prepare('SELECT type FROM accounts WHERE code=?').get(String(b.account_code || ''));
  if (!acc || acc.type !== 'activo') throw bad('Elija la cuenta de activo donde se registran los cobros (ej. 111015 Datáfono / pasarela por liquidar)');
  const mode = b.mode === 'production' ? 'production' : 'sandbox';
  if (b.provider === 'generico' && b.link_template && !/^https:\/\//.test(b.link_template)) throw bad('La plantilla del enlace debe empezar por https://');
  const prev = id ? db.prepare('SELECT * FROM gateways WHERE id=?').get(id) : null;
  if (id && !prev) throw new C.HttpError(404, 'Pasarela no encontrada');
  // un campo secreto vacío conserva el valor guardado
  const priv = b.private_key ? seal(db, String(b.private_key).trim()) : prev && prev.private_key_enc;
  const evs = b.events_secret ? seal(db, String(b.events_secret).trim()) : prev && prev.events_secret_enc;
  const vals = [b.provider, name, mode, String(b.public_key || '').trim() || null, priv || null, evs || null, String(b.link_template || '').trim() || null, acc && String(b.account_code), b.active === false ? 0 : 1];
  if (id) { db.prepare('UPDATE gateways SET provider=?,name=?,mode=?,public_key=?,private_key_enc=?,events_secret_enc=?,link_template=?,account_code=?,active=? WHERE id=?').run(...vals, id); return id; }
  return Number(db.prepare('INSERT INTO gateways(provider,name,mode,public_key,private_key_enc,events_secret_enc,link_template,account_code,active) VALUES(?,?,?,?,?,?,?,?,?)').run(...vals).lastInsertRowid);
}

// ---- enlace de pago para el saldo de una factura ----
async function createPayLink(db, user, { gateway_id, doc_id }, fetchFn = fetch) {
  const g = db.prepare('SELECT * FROM gateways WHERE id=? AND active=1').get(num(gateway_id));
  if (!g) throw bad('Seleccione una pasarela activa');
  const doc = D.getDocument(db, num(doc_id));
  if (doc.type !== 'venta') throw bad('Solo se generan enlaces de cobro para ventas');
  if (doc.status !== 'activo') throw bad('El documento está anulado');
  if (doc.balance <= 0.004) throw bad('La factura no tiene saldo pendiente');
  const reference = `${doc.number}-${crypto.randomBytes(3).toString('hex')}`;
  let url, external = null;
  if (g.provider === 'wompi') {
    const key = open(db, g.private_key_enc);
    if (!key) throw bad('Falta la llave privada de Wompi en la configuración');
    if (doc.balance < 1500) throw bad('Wompi exige un valor mínimo de $1.500');
    const r = await fetchFn(PROVIDERS.wompi.api[g.mode] + '/payment_links', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ name: `Factura ${doc.number}`.slice(0, 60), description: `Pago de la factura ${doc.number} - ${C.getSetting(db, 'company_name', '')}`.slice(0, 200), single_use: true, collect_shipping: false, currency: 'COP', amount_in_cents: Math.round(doc.balance * 100), sku: doc.number }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.data || !j.data.id) throw bad('Wompi rechazó la solicitud: ' + ((j.error && (j.error.reason || JSON.stringify(j.error.messages || j.error))) || 'HTTP ' + r.status));
    external = j.data.id; url = 'https://checkout.wompi.co/l/' + external;
  } else {
    if (!g.link_template) throw bad('Configure la plantilla del enlace de esta pasarela');
    url = g.link_template.replace('{reference}', encodeURIComponent(reference)).replace('{amount}', String(doc.balance)).replace('{number}', encodeURIComponent(doc.number));
  }
  db.prepare('INSERT INTO gateway_links(gateway_id,doc_id,reference,external_id,url,amount,created_at,user_id) VALUES(?,?,?,?,?,?,?,?)')
    .run(g.id, doc.id, reference, external, url, doc.balance, new Date().toISOString(), user.id);
  return { url, reference, amount: doc.balance, number: doc.number };
}

// ---- webhook: verifica la firma, evita duplicados y registra el cobro ----
const eq = (a, b) => { const x = Buffer.from(String(a).toLowerCase()), y = Buffer.from(String(b).toLowerCase()); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const dig = (o, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), o);

function parseEvent(db, g, headers, raw, body) {
  const secret = open(db, g.events_secret_enc);
  if (!secret) throw new C.HttpError(400, 'La pasarela no tiene secreto de eventos configurado');
  if (g.provider === 'wompi') {
    const sig = body.signature;
    if (!sig || !Array.isArray(sig.properties) || !sig.checksum || body.timestamp === undefined) throw new C.HttpError(401, 'Firma ausente');
    const concat = sig.properties.map((p) => dig(body.data, p)).join('') + body.timestamp + secret;
    if (!eq(crypto.createHash('sha256').update(concat).digest('hex'), sig.checksum)) throw new C.HttpError(401, 'Firma inválida');
    if (body.event !== 'transaction.updated') return null;
    const t = body.data && body.data.transaction;
    if (!t) return null;
    return { tx_id: String(t.id), status: t.status, approved: t.status === 'APPROVED', amount: round2(num(t.amount_in_cents) / 100), external_id: t.payment_link_id || null, reference: t.reference || null, method: t.payment_method_type || '' };
  }
  const given = headers['x-signature'];
  if (!given || !eq(crypto.createHmac('sha256', secret).update(raw).digest('hex'), given)) throw new C.HttpError(401, 'Firma inválida');
  const st = String(body.status || '').toLowerCase();
  if (!body.transaction_id || !body.reference) throw new C.HttpError(400, 'Faltan transaction_id o reference');
  return { tx_id: String(body.transaction_id), status: st, approved: ['approved', 'paid', 'aprobado', 'pagado', 'success'].includes(st), amount: round2(num(body.amount)), external_id: null, reference: String(body.reference), method: '' };
}

function handleWebhook(db, gatewayId, headers, raw, body) {
  const g = db.prepare('SELECT * FROM gateways WHERE id=? AND active=1').get(num(gatewayId));
  if (!g) throw new C.HttpError(404, 'Pasarela no encontrada');
  const ev = parseEvent(db, g, headers, raw, body);
  if (!ev) return { ok: true, ignored: true };
  return tx(db, () => {
    if (db.prepare('SELECT 1 FROM gateway_events WHERE gateway_id=? AND tx_id=?').get(g.id, ev.tx_id)) return { ok: true, duplicate: true };
    const log = (docId, result) => { db.prepare('INSERT INTO gateway_events(gateway_id,tx_id,status,amount,doc_id,result,created_at) VALUES(?,?,?,?,?,?,?)').run(g.id, ev.tx_id, ev.status, ev.amount, docId, result, new Date().toISOString()); return { ok: true, result }; };
    if (!ev.approved) return log(null, 'Sin pago (' + ev.status + ')');
    const link = db.prepare('SELECT * FROM gateway_links WHERE gateway_id=? AND ((external_id IS NOT NULL AND external_id=?) OR reference=?) ORDER BY id DESC').get(g.id, ev.external_id || '', ev.reference || '');
    if (!link) return log(null, 'Pago aprobado sin factura asociada: revíselo manualmente');
    const doc = db.prepare('SELECT * FROM documents WHERE id=?').get(link.doc_id);
    const balance = round2(doc.total - doc.paid);
    if (doc.status !== 'activo' || balance <= 0.004) return log(doc.id, 'Pago aprobado pero la factura ya estaba pagada o anulada: reembolse o aplique manualmente');
    const amount = Math.min(ev.amount, balance);
    D.registerPayment(db, { id: null }, { doc_id: doc.id, amount, date: C.today(), account_code: g.account_code, notes: `${g.name} · transacción ${ev.tx_id}${ev.method ? ' · ' + ev.method : ''}` });
    return log(doc.id, `Cobro registrado ${amount}` + (ev.amount > balance ? ` (la pasarela cobró ${ev.amount}, excede el saldo: revise)` : ''));
  });
}

// ---- liquidación: la pasarela deposita en el banco el valor menos su comisión ----
function settle(db, user, b) {
  return tx(db, () => {
    const g = db.prepare('SELECT * FROM gateways WHERE id=?').get(num(b.gateway_id));
    if (!g) throw bad('Seleccione la pasarela');
    const received = round2(num(b.received)), fee = round2(num(b.fee));
    if (!(received > 0) || fee < 0) throw bad('Indique el valor recibido en el banco y la comisión');
    const bank = db.prepare('SELECT type FROM accounts WHERE code=?').get(String(b.bank_account || ''));
    if (!bank || bank.type !== 'activo') throw bad('Elija la cuenta de banco que recibe el depósito');
    const date = C.needDate(b.date || C.today());
    const lines = [{ account_code: String(b.bank_account), debit: received }, { account_code: g.account_code, credit: round2(received + fee) }];
    if (fee > 0) lines.splice(1, 0, { account_code: String(b.fee_account || '530505'), debit: fee, memo: 'Comisión pasarela' });
    const id = C.postEntry(db, { date, description: `Liquidación ${g.name}${b.notes ? ' · ' + b.notes : ''}`, source: 'manual', user_id: user.id, lines });
    return { id, gross: round2(received + fee) };
  });
}

function recentEvents(db) {
  return db.prepare(`SELECT e.*, g.name gateway, d.number doc_number FROM gateway_events e JOIN gateways g ON g.id=e.gateway_id LEFT JOIN documents d ON d.id=e.doc_id ORDER BY e.id DESC LIMIT 50`).all();
}

module.exports = { PROVIDERS, listGateways, saveGateway, createPayLink, handleWebhook, settle, recentEvents, seal, open };
