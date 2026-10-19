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

const SLUG = /^[a-z0-9][a-z0-9-]{1,30}$/;
const RESERVED = new Set(['plataforma', 'api', 'admin', 'www', 'e', 't', 'static', 'public', 'login', 'root', 'soporte', 'platform']);
const MAX_OPEN = 40;
const SESSION_MS = 12 * 3600 * 1000;

const PLATFORM_SCHEMA = `
CREATE TABLE IF NOT EXISTS platform_users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS platform_sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'activo',
  sector TEXT, note TEXT, created_at TEXT, last_login TEXT, admin_user TEXT
);`;

const genPassword = () => { const a = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRTUVWXYZ2346789'; let s = ''; for (const b of crypto.randomBytes(12)) s += a[b % a.length]; return s; };

class Platform {
  constructor(dir) {
    this.dir = path.resolve(dir);
    fs.mkdirSync(path.join(this.dir, 'tenants'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(this.dir, 'archivo'), { recursive: true, mode: 0o700 });
    this.pdb = new DatabaseSync(path.join(this.dir, 'platform.db'));
    this.pdb.exec('PRAGMA journal_mode=WAL;');
    this.pdb.exec(PLATFORM_SCHEMA);
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
    t = { db, api: build(db, { multi: true }) };
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
      const { salt, hash } = C.hashPassword(pass);
      db.prepare('UPDATE users SET salt=?, hash=?, active=1 WHERE id=?').run(salt, hash, u.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
      return { username: u.username, password: pass };
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
  touchLogin(slug) { this.pdb.prepare('UPDATE tenants SET last_login=? WHERE slug=?').run(new Date().toISOString(), slug); }

  // ---------- API de la plataforma (/api/plataforma/...) ----------
  authenticate(token) {
    if (!token) return null;
    const s = this.pdb.prepare('SELECT * FROM platform_sessions WHERE token=? AND expires>?').get(token, Date.now());
    return s ? this.pdb.prepare('SELECT * FROM platform_users WHERE id=? AND active=1').get(s.user_id) || null : null;
  }
  handle(method, rest, body, token, ip) {
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
    if (method === 'GET' && key === 'tenants') return this.listTenants();
    if (method === 'POST' && key === 'tenants') return this.createTenant(body);
    if (seg[0] === 'tenants' && seg[1]) {
      const slug = seg[1];
      if (method === 'POST' && seg[2] === 'estado') { if (!['activo', 'suspendido'].includes(body.status)) throw bad('Estado inválido'); this.setStatus(slug, body.status); return { ok: true }; }
      if (method === 'POST' && seg[2] === 'reset-admin') return this.resetAdmin(slug, body.username, body.password);
      if (method === 'POST' && seg[2] === 'archivar') { if (body.confirm !== slug) throw bad('Escriba el código de la empresa para confirmar'); this.archiveTenant(slug); return { ok: true }; }
      if (method === 'GET' && seg[2] === 'backup') return { __download: this.backupTenant(slug), filename: `${slug}-${new Date().toISOString().slice(0, 10)}.db` };
      if (method === 'PUT' && !seg[2]) { if (!this.row(slug)) throw new HttpError(404, 'Empresa no encontrada'); P.prepare('UPDATE tenants SET name=COALESCE(?,name), note=? WHERE slug=?').run(String(body.name || '').trim() || null, body.note || null, slug); return { ok: true }; }
    }
    throw new HttpError(404, 'Ruta no encontrada');
  }
}

module.exports = { Platform, SLUG };
