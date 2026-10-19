'use strict';
// Plataforma multi-negocio: una base de datos SQLite por negocio (aislamiento total) + una base propia de la plataforma
// con el dueño (administrador de plataforma) y el listado de negocios. Un negocio solo puede abrir SU archivo: el código
// de empresa se valida estrictamente y nunca se usa sin comprobar antes de formar una ruta.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { open: openTenantDb } = require('./db');
const C = require('./core');
const { build } = require('./api');
const { HttpError, bad } = C;
const { seedDemo } = require('./demo');

const SLUG = /^[a-z0-9][a-z0-9-]{1,30}$/;
const RESERVED = new Set(['plataforma', 'api', 'admin', 'www', 'e', 't', 'static', 'public', 'login', 'root', 'soporte', 'platform']);
const MAX_OPEN = 40;
const SESSION_MS = 12 * 3600 * 1000;

const PLATFORM_SCHEMA = `
CREATE TABLE IF NOT EXISTS platform_users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS platform_sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'activo',
  sector TEXT, note TEXT, created_at TEXT, last_login TEXT, admin_user TEXT, is_demo INTEGER NOT NULL DEFAULT 0, expires_at TEXT
);
CREATE TABLE IF NOT EXISTS papelera (id INTEGER PRIMARY KEY, slug TEXT NOT NULL, name TEXT NOT NULL, file TEXT NOT NULL, snapshot TEXT, deleted_at TEXT, expires_at TEXT);
CREATE TABLE IF NOT EXISTS platform_settings (key TEXT PRIMARY KEY, value TEXT);`;

const genPassword = () => { const a = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRTUVWXYZ2346789'; let s = ''; for (const b of crypto.randomBytes(12)) s += a[b % a.length]; return s; };

class Platform {
  constructor(dir) {
    this.dir = path.resolve(dir);
    fs.mkdirSync(path.join(this.dir, 'tenants'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(this.dir, 'archivo'), { recursive: true, mode: 0o700 });
    this.pdb = new DatabaseSync(path.join(this.dir, 'platform.db'));
    this.pdb.exec('PRAGMA journal_mode=WAL;');
    this.pdb.exec(PLATFORM_SCHEMA);
    // migración: bases creadas por versiones anteriores
    const cols = this.pdb.prepare('PRAGMA table_info(tenants)').all().map((c) => c.name);
    if (!cols.includes('is_demo')) this.pdb.exec('ALTER TABLE tenants ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0');
    if (!cols.includes('expires_at')) this.pdb.exec('ALTER TABLE tenants ADD COLUMN expires_at TEXT');
    this.demoHits = new Map();
    this.cache = new Map();
    this.attempts = new Map();
  }
  isSetup() { return this.pdb.prepare('SELECT COUNT(*) n FROM platform_users').get().n > 0; }
  validSlug(s) { return typeof s === 'string' && SLUG.test(s) && !RESERVED.has(s); }
  fileFor(slug) {
    if (!this.validSlug(slug)) throw bad('Código de empresa inválido');
    const f = path.join(this.dir, 'tenants', slug + '.db');
    if (path.dirname(f) !== path.join(this.dir, 'tenants')) throw bad('Código de empresa inválido'); // defensa extra contra rutas
    return f;
  }
  row(slug) { return this.validSlug(slug) ? this.pdb.prepare('SELECT * FROM tenants WHERE slug=?').get(slug) : null; }

  // Devuelve {db, api} del negocio, o null si no existe. Lanza 403 si está suspendido.
  tenant(slug) {
    const r = this.row(slug);
    if (!r || r.status === 'archivado') return null;
    if (r.status !== 'activo') throw new HttpError(403, 'Esta empresa está suspendida. Comuníquese con el administrador de la plataforma.');
    let t = this.cache.get(slug);
    if (t) { this.cache.delete(slug); this.cache.set(slug, t); return t; }
    const db = openTenantDb(this.fileFor(slug));
    t = { db, api: build(db, { multi: true, demo: !!r.is_demo }) };
    this.cache.set(slug, t);
    while (this.cache.size > MAX_OPEN) { const [k, v] = this.cache.entries().next().value; try { v.db.close(); } catch (_) {} this.cache.delete(k); }
    return t;
  }
  closeTenant(slug) { const t = this.cache.get(slug); if (t) { try { t.db.close(); } catch (_) {} this.cache.delete(slug); } }

  createTenant(b) {
    const name = String(b.name || '').trim();
    if (!name) throw bad('Indique el nombre del negocio');
    const slug = String(b.slug || name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 31);
    if (!this.validSlug(slug)) throw bad('No se pudo formar un código de empresa válido (use letras y números, 2 a 31 caracteres)');
    if (this.pdb.prepare('SELECT 1 FROM tenants WHERE slug=?').get(slug)) throw bad(`El código "${slug}" ya existe`);
    const adminUser = String(b.admin_user || 'admin').trim().toLowerCase();
    const password = String(b.password || '').trim() || genPassword();
    const file = this.fileFor(slug);
    if (fs.existsSync(file)) throw bad('Ya existe un archivo de datos para ese código');
    const db = openTenantDb(file);
    try {
      C.setupCompany(db, { company_name: name, company_nit: b.nit || '', company_address: b.address || '', company_phone: b.phone || '', profile: b.profile || 'comercio', sector: b.sector === 'general' ? 'general' : 'cabello', username: adminUser, admin_name: b.admin_name || adminUser, password });
    } catch (e) { db.close(); for (const x of ['', '-wal', '-shm']) fs.rmSync(file + x, { force: true }); throw e; }
    db.close();
    this.pdb.prepare('INSERT INTO tenants(slug,name,sector,note,created_at,admin_user) VALUES(?,?,?,?,?,?)').run(slug, name, b.sector === 'general' ? 'general' : 'cabello', b.note || null, new Date().toISOString(), adminUser);
    return { slug, name, admin_user: adminUser, password };
  }
  listTenants() {
    return this.pdb.prepare('SELECT * FROM tenants ORDER BY created_at DESC').all().map((t) => {
      let size = 0; try { size = fs.statSync(this.fileFor(t.slug)).size; } catch (_) {}
      return { ...t, size_kb: Math.round(size / 1024) };
    });
  }
  setStatus(slug, status) {
    if (!this.row(slug)) throw new HttpError(404, 'Empresa no encontrada');
    this.pdb.prepare('UPDATE tenants SET status=? WHERE slug=?').run(status, slug);
    if (status !== 'activo') this.closeTenant(slug);
  }
  resetAdmin(slug, username, password) {
    const r = this.row(slug);
    if (!r || r.status === 'archivado') throw new HttpError(404, 'Empresa no encontrada');
    const db = openTenantDb(this.fileFor(slug));
    try {
      const u = db.prepare('SELECT * FROM users WHERE username=?').get(String(username || r.admin_user).toLowerCase());
      if (!u) throw bad('Usuario no encontrado en esa empresa');
      const pass = String(password || '').trim() || genPassword();
      // en una demo los tres usuarios (demo, vendedor, contador) comparten contraseña: se restablecen juntos
      const targets = r.is_demo ? db.prepare("SELECT * FROM users WHERE username IN ('demo','vendedor','contador')").all() : [u];
      const { salt, hash } = C.hashPassword(pass);
      for (const t of targets) { db.prepare('UPDATE users SET salt=?, hash=?, active=1 WHERE id=?').run(salt, hash, t.id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(t.id); }
      return { username: u.username, password: pass, users: targets.map((t) => t.username) };
    } finally { db.close(); }
  }
  backupTenant(slug) {
    if (!this.row(slug)) throw new HttpError(404, 'Empresa no encontrada');
    const out = path.join(require('os').tmpdir(), `bk-${slug}-${Date.now()}.db`);
    const db = new DatabaseSync(this.fileFor(slug), { readOnly: true });
    try { db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`); } finally { db.close(); }
    const buf = fs.readFileSync(out); fs.unlinkSync(out); return buf;
  }
  archiveTenant(slug) { // no borra: mueve el archivo a /archivo y reserva el código
    const r = this.row(slug);
    if (!r) throw new HttpError(404, 'Empresa no encontrada');
    this.closeTenant(slug);
    const f = this.fileFor(slug);
    for (const x of ['', '-wal', '-shm']) if (fs.existsSync(f + x)) fs.renameSync(f + x, path.join(this.dir, 'archivo', `${slug}-${Date.now()}.db${x}`));
    this.pdb.prepare("UPDATE tenants SET status='archivado' WHERE slug=?").run(slug);
  }
  // ---------- demos ----------
  getSetting(k, def = '') { const r = this.pdb.prepare('SELECT value FROM platform_settings WHERE key=?').get(k); return r ? r.value : def; }
  setSetting(k, v) { this.pdb.prepare('INSERT INTO platform_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v)); }
  publicDemoEnabled() { return this.getSetting('public_demo', '0') === '1'; }

  // Crea un negocio de demostración con datos de ejemplo y fecha de vencimiento (se borra solo al vencer).
  async createDemo({ name, days = 3, note = null } = {}) {
    days = Math.min(Math.max(parseInt(days, 10) || 3, 1), 60);
    let slug; do slug = 'demo-' + crypto.randomBytes(3).toString('hex'); while (this.row(slug));
    const password = genPassword();
    const creds = this.createTenant({ name: String(name || '').trim() || 'Demo Distribuidora Capilar', slug, admin_user: 'demo', admin_name: 'Administrador demo', password, sector: 'cabello', profile: 'comercio' });
    const expires = new Date(Date.now() + days * 86400000).toISOString();
    const db = openTenantDb(this.fileFor(slug));
    try {
      const user = db.prepare("SELECT * FROM users WHERE username='demo'").get();
      C.setSetting(db, 'is_demo', '1'); C.setSetting(db, 'demo_expires', expires.slice(0, 10));
      const summary = await seedDemo(db, user, { password });
      this.pdb.prepare('UPDATE tenants SET is_demo=1, expires_at=?, note=? WHERE slug=?').run(expires, note, slug);
      return { ...creds, expires_at: expires, users: ['demo', 'vendedor', 'contador'], summary };
    } catch (e) {
      db.close(); this.purgeTenantFiles(slug); this.pdb.prepare('DELETE FROM tenants WHERE slug=?').run(slug); throw e;
    } finally { try { db.close(); } catch (_) {} }
  }
  purgeTenantFiles(slug) { const f = this.fileFor(slug); for (const x of ['', '-wal', '-shm']) fs.rmSync(f + x, { force: true }); }
  purgeExpired() { // solo demos vencidas: se eliminan definitivamente (son descartables)
    let n = 0;
    for (const t of this.pdb.prepare("SELECT slug FROM tenants WHERE is_demo=1 AND expires_at<?").all(new Date().toISOString())) {
      this.closeTenant(t.slug); this.purgeTenantFiles(t.slug); this.pdb.prepare('DELETE FROM tenants WHERE slug=?').run(t.slug); n++;
    }
    return n + this.purgeTrashExpired();
  }
  // Demo abierta al público desde la pantalla de ingreso (si el dueño la activó): con límites por IP y por cantidad.
  async startPublicDemo(ip) {
    if (!this.publicDemoEnabled()) throw new HttpError(403, 'La demo pública no está habilitada');
    const now = Date.now(), hits = (this.demoHits.get(ip) || []).filter((t) => now - t < 3600000);
    if (hits.length >= 3) throw new HttpError(429, 'Ya creó varias demos. Intente de nuevo en una hora.');
    const max = parseInt(this.getSetting('public_demo_max', '25'), 10) || 25;
    this.purgeExpired();
    if (this.pdb.prepare("SELECT COUNT(*) n FROM tenants WHERE is_demo=1 AND note='publica'").get().n >= max) throw new HttpError(429, 'Hay muchas demos activas en este momento. Intente más tarde.');
    hits.push(now); this.demoHits.set(ip, hits);
    const d = await this.createDemo({ days: 1, note: 'publica', name: 'Demo Distribuidora Capilar' });
    const t = this.tenant(d.slug);
    const login = t.api.dispatch('POST', '/api/login', {}, { username: 'demo', password: d.password }, '', ip);
    return { empresa: d.slug, token: login.token, expires_at: d.expires_at };
  }

  // ---------- editar / eliminar ----------
  detail(slug) {
    const r = this.row(slug);
    if (!r || r.status === 'archivado') throw new HttpError(404, 'Empresa no encontrada');
    const db = openTenantDb(this.fileFor(slug)); // solo se leen los datos de contacto de la empresa, nada contable
    try { const g = (k) => C.getSetting(db, k, ''); return { slug, name: r.name, note: r.note, status: r.status, is_demo: r.is_demo, expires_at: r.expires_at, admin_user: r.admin_user, nit: g('company_nit'), address: g('company_address'), phone: g('company_phone') }; }
    finally { db.close(); }
  }
  updateTenant(slug, b) {
    const r = this.row(slug);
    if (!r || r.status === 'archivado') throw new HttpError(404, 'Empresa no encontrada');
    const name = String(b.name === undefined ? r.name : b.name).trim();
    if (!name) throw bad('El nombre no puede quedar vacío');
    this.closeTenant(slug); // se cierra la conexión en caché mientras se edita
    const db = openTenantDb(this.fileFor(slug));
    try {
      C.setSetting(db, 'company_name', name);
      for (const [k, f] of [['company_nit', 'nit'], ['company_address', 'address'], ['company_phone', 'phone']]) if (b[f] !== undefined) C.setSetting(db, k, String(b[f]).trim());
      let expires = r.expires_at;
      if (r.is_demo && b.extend_days) {
        const d = Math.min(Math.max(parseInt(b.extend_days, 10) || 0, 0), 60);
        if (d) { expires = new Date(Math.max(Date.now(), Date.parse(r.expires_at || 0) || 0) + d * 86400000).toISOString(); C.setSetting(db, 'demo_expires', expires.slice(0, 10)); }
      }
      this.pdb.prepare('UPDATE tenants SET name=?, note=?, expires_at=? WHERE slug=?').run(name, b.note === undefined ? r.note : (String(b.note).trim() || null), expires, slug);
    } finally { db.close(); }
    return this.detail(slug);
  }
  // Eliminar = papelera: se saca de servicio, se libera el código y los datos se conservan 30 días (restaurables).
  deleteTenant(slug) {
    const r = this.row(slug);
    if (!r) throw new HttpError(404, 'Empresa no encontrada');
    this.closeTenant(slug);
    const f = this.fileFor(slug), dest = path.join(this.dir, 'archivo', `${slug}-${Date.now()}.db`);
    if (r.status !== 'archivado' && fs.existsSync(f)) {
      for (const x of ['', '-wal', '-shm']) if (fs.existsSync(f + x)) fs.renameSync(f + x, dest + x);
      this.pdb.prepare('INSERT INTO papelera(slug,name,file,snapshot,deleted_at,expires_at) VALUES(?,?,?,?,?,?)')
        .run(slug, r.name, path.basename(dest), JSON.stringify(r), new Date().toISOString(), new Date(Date.now() + 30 * 86400000).toISOString());
    }
    this.pdb.prepare('DELETE FROM tenants WHERE slug=?').run(slug);
  }
  listTrash() { return this.pdb.prepare('SELECT id, slug, name, deleted_at, expires_at FROM papelera ORDER BY id DESC').all(); }
  restoreTrash(id) {
    const t = this.pdb.prepare('SELECT * FROM papelera WHERE id=?').get(id);
    if (!t) throw new HttpError(404, 'No está en la papelera');
    if (this.row(t.slug)) throw bad(`El código "${t.slug}" ya lo usa otra empresa: no se puede restaurar`);
    const src = path.join(this.dir, 'archivo', t.file), dest = this.fileFor(t.slug);
    if (!fs.existsSync(src)) throw bad('Los datos ya no están en la papelera');
    for (const x of ['', '-wal', '-shm']) if (fs.existsSync(src + x)) fs.renameSync(src + x, dest + x);
    const o = JSON.parse(t.snapshot || '{}');
    this.pdb.prepare('INSERT INTO tenants(slug,name,status,sector,note,created_at,last_login,admin_user,is_demo,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(t.slug, o.name || t.name, 'activo', o.sector || null, o.note || null, o.created_at || new Date().toISOString(), o.last_login || null, o.admin_user || null, o.is_demo || 0, o.expires_at || null);
    this.pdb.prepare('DELETE FROM papelera WHERE id=?').run(id);
    return { slug: t.slug };
  }
  purgeTrash(id) { // borrado definitivo
    const t = this.pdb.prepare('SELECT * FROM papelera WHERE id=?').get(id);
    if (!t) throw new HttpError(404, 'No está en la papelera');
    for (const x of ['', '-wal', '-shm']) fs.rmSync(path.join(this.dir, 'archivo', t.file + x), { force: true });
    this.pdb.prepare('DELETE FROM papelera WHERE id=?').run(id);
  }
  purgeTrashExpired() { let n = 0; for (const t of this.pdb.prepare('SELECT id FROM papelera WHERE expires_at<?').all(new Date().toISOString())) { this.purgeTrash(t.id); n++; } return n; }

  touchLogin(slug) { this.pdb.prepare('UPDATE tenants SET last_login=? WHERE slug=?').run(new Date().toISOString(), slug); }

  // ---------- API de la plataforma (/api/plataforma/...) ----------
  authenticate(token) {
    if (!token) return null;
    const s = this.pdb.prepare('SELECT * FROM platform_sessions WHERE token=? AND expires>?').get(token, Date.now());
    return s ? this.pdb.prepare('SELECT * FROM platform_users WHERE id=? AND active=1').get(s.user_id) || null : null;
  }
  async handle(method, rest, body, token, ip) {
    const P = this.pdb;
    const need = () => { const u = this.authenticate(token); if (!u) throw new HttpError(401, 'Sesión expirada. Ingrese de nuevo.'); return u; };
    const seg = rest.split('/').filter(Boolean);
    const key = seg.join('/');
    if (method === 'GET' && key === 'status') return { setup: this.isSetup(), setup_token_required: !this.isSetup() };
    if (method === 'POST' && key === 'setup') {
      if (this.isSetup()) throw new HttpError(409, 'La plataforma ya fue configurada');
      const want = process.env.SETUP_TOKEN || '';
      const given = Buffer.from(String(body.setup_token || '').trim()), exp = Buffer.from(want);
      if (!want || given.length !== exp.length || !crypto.timingSafeEqual(given, exp)) throw new HttpError(403, 'Código de instalación incorrecto');
      const username = String(body.username || '').trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw bad('Usuario: 3 a 30 caracteres (letras, números, . _ -)');
      if (String(body.password || '').length < 10) throw bad('La contraseña de la plataforma debe tener al menos 10 caracteres');
      const { salt, hash } = C.hashPassword(String(body.password));
      P.prepare('INSERT INTO platform_users(username,name,salt,hash) VALUES(?,?,?,?)').run(username, String(body.name || username), salt, hash);
      return { ok: true };
    }
    if (method === 'POST' && key === 'login') {
      const k = ip + '|' + String(body.username || '').toLowerCase(), a = this.attempts.get(k) || { n: 0, t: 0 };
      if (Date.now() - a.t > 300000) a.n = 0;
      if (a.n >= 6) throw new HttpError(429, 'Demasiados intentos. Espere 5 minutos.');
      const u = P.prepare('SELECT * FROM platform_users WHERE username=? AND active=1').get(String(body.username || '').trim().toLowerCase());
      if (!u || !C.checkPassword(String(body.password || ''), u.salt, u.hash)) { this.attempts.set(k, { n: a.n + 1, t: Date.now() }); throw new HttpError(401, 'Usuario o contraseña incorrectos'); }
      this.attempts.delete(k);
      P.prepare('DELETE FROM platform_sessions WHERE expires<?').run(Date.now());
      const tk = crypto.randomBytes(32).toString('hex');
      P.prepare('INSERT INTO platform_sessions(token,user_id,expires) VALUES(?,?,?)').run(tk, u.id, Date.now() + SESSION_MS);
      return { token: tk, user: { username: u.username, name: u.name } };
    }
    if (method === 'POST' && key === 'logout') { P.prepare('DELETE FROM platform_sessions WHERE token=?').run(token || ''); return { ok: true }; }
    const u = need();
    if (method === 'GET' && key === 'me') return { user: { username: u.username, name: u.name } };
    if (method === 'POST' && key === 'password') {
      if (!C.checkPassword(String(body.current || ''), u.salt, u.hash)) throw bad('La contraseña actual no es correcta');
      if (String(body.password || '').length < 10) throw bad('La nueva contraseña debe tener al menos 10 caracteres');
      const { salt, hash } = C.hashPassword(String(body.password));
      P.prepare('UPDATE platform_users SET salt=?, hash=? WHERE id=?').run(salt, hash, u.id);
      return { ok: true };
    }
    if (method === 'GET' && key === 'settings') return { public_demo: this.publicDemoEnabled(), public_demo_max: parseInt(this.getSetting('public_demo_max', '25'), 10) };
    if (method === 'PUT' && key === 'settings') {
      if (body.public_demo !== undefined) this.setSetting('public_demo', body.public_demo ? '1' : '0');
      if (body.public_demo_max !== undefined) this.setSetting('public_demo_max', Math.min(Math.max(parseInt(body.public_demo_max, 10) || 25, 1), 200));
      return { ok: true };
    }
    if (method === 'POST' && key === 'tenants/demo') return await this.createDemo({ name: body.name, days: body.days, note: 'manual' });
    if (method === 'GET' && key === 'papelera') return this.listTrash();
    if (seg[0] === 'papelera' && seg[1] && method === 'POST' && seg[2] === 'restaurar') return this.restoreTrash(parseInt(seg[1], 10));
    if (seg[0] === 'papelera' && seg[1] && method === 'POST' && seg[2] === 'borrar') {
      const t = P.prepare('SELECT slug FROM papelera WHERE id=?').get(parseInt(seg[1], 10));
      if (!t) throw new HttpError(404, 'No está en la papelera');
      if (body.confirm !== t.slug) throw bad('Escriba el código de la empresa para confirmar');
      this.purgeTrash(parseInt(seg[1], 10)); return { ok: true };
    }
    if (method === 'POST' && key === 'purgar-demos') return { purgadas: this.purgeExpired() };
    if (method === 'GET' && key === 'tenants') return this.listTenants();
    if (method === 'POST' && key === 'tenants') return this.createTenant(body);
    if (seg[0] === 'tenants' && seg[1]) {
      const slug = seg[1];
      if (method === 'POST' && seg[2] === 'estado') { if (!['activo', 'suspendido'].includes(body.status)) throw bad('Estado inválido'); this.setStatus(slug, body.status); return { ok: true }; }
      if (method === 'POST' && seg[2] === 'reset-admin') return this.resetAdmin(slug, body.username, body.password);
      if (method === 'POST' && (seg[2] === 'eliminar' || seg[2] === 'archivar')) { if (body.confirm !== slug) throw bad('Escriba el código de la empresa para confirmar'); this.deleteTenant(slug); return { ok: true }; }
      if (method === 'GET' && !seg[2]) return this.detail(slug);
      if (method === 'GET' && seg[2] === 'backup') return { __download: this.backupTenant(slug), filename: `${slug}-${new Date().toISOString().slice(0, 10)}.db` };
      if (method === 'PUT' && !seg[2]) return this.updateTenant(slug, body);
    }
    throw new HttpError(404, 'Ruta no encontrada');
  }
}

module.exports = { Platform, SLUG };
