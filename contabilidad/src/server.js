'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Platform } = require('./platform');
const { HttpError } = require('./core');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1'; // detrás de Caddy/nginx: la IP real viene en X-Forwarded-For
// DATA_DIR: carpeta con platform.db y tenants/<empresa>.db. Compatibilidad: si solo hay DB_FILE se usa su carpeta.
const DATA_DIR = process.env.DATA_DIR || (process.env.DB_FILE ? path.dirname(process.env.DB_FILE) : path.join(__dirname, '..', 'data'));
const PUBLIC = path.join(__dirname, '..', 'public');
// identificador de la instalación (lo escribe el script de actualización) para comprobar qué versión corre realmente
const BUILD = (() => { try { return fs.readFileSync(path.join(__dirname, '..', 'build-id'), 'utf8').trim(); } catch { return ''; } })();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

function createServer(platform) {
  const send = (res, status, data, headers = {}) => {
    const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  };
  const download = (res, buf, filename) => send(res, 200, buf, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${filename}"` });

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/')) return serveStatic(url, res);
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 5e6) req.destroy(); else chunks.push(c); });
    req.on('end', () => {
      const fail = (e) => {
        if (e instanceof HttpError) return send(res, e.status, { error: e.message });
        if (/UNIQUE constraint/.test(String(e.message))) return send(res, 400, { error: 'Ya existe un registro con ese valor único (código, número o usuario)' });
        console.error(e);
        send(res, 500, { error: 'Error interno del servidor' });
      };
      try {
        let body = {};
        const raw = Buffer.concat(chunks).toString('utf8');
        if (raw) { try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'JSON inválido'); } }
        const token = (req.headers.authorization || '').replace(/^Bearer /, '');
        const query = Object.fromEntries(url.searchParams);
        const ip = (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;

        if (url.pathname === '/api/health') return send(res, 200, { ok: true, build: BUILD, platform_setup: platform.isSetup(), public_demo: platform.publicDemoEnabled() });
        if (url.pathname === '/api/demo/start' && req.method === 'POST') return platform.startPublicDemo(ip).then((r) => send(res, 200, r)).catch(fail);

        // ---- administración de la plataforma ----
        if (url.pathname.startsWith('/api/plataforma/')) {
          return platform.handle(req.method, url.pathname.slice('/api/plataforma/'.length), body, token, ip)
            .then((out) => (out && out.__download ? download(res, out.__download, out.filename) : send(res, 200, out))).catch(fail);
        }

        // ---- negocio: se identifica por /api/e/<codigo>/..., cabecera X-Empresa o ?e= ----
        let pathname = url.pathname, slug = String(req.headers['x-empresa'] || query.e || '').toLowerCase();
        const m = /^\/api\/e\/([a-z0-9-]+)(\/.*)$/.exec(pathname);
        if (m) { slug = m[1]; pathname = '/api' + m[2]; }
        if (!slug) throw new HttpError(400, 'Falta el código de empresa');
        const t = platform.tenant(slug);
        if (!t) throw new HttpError(401, 'Empresa, usuario o contraseña incorrectos'); // no revela si la empresa existe
        if (pathname === '/api/backup' && req.method === 'GET') {
          if (platform.row(slug).is_demo) throw new HttpError(403, 'No disponible en la demo');
          const u = t.api.authenticate(token);
          if (!u || u.role !== 'admin') throw new HttpError(403, 'Solo el administrador puede descargar copias');
          const tmp = path.join(os.tmpdir(), `backup-${crypto.randomBytes(6).toString('hex')}.db`);
          t.db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
          const buf = fs.readFileSync(tmp); fs.unlinkSync(tmp);
          return download(res, buf, `${slug}-${new Date().toISOString().slice(0, 10)}.db`);
        }
        const out = t.api.dispatch(req.method, pathname, query, body, token, ip, { raw, headers: req.headers });
        Promise.resolve(out).then((r) => {
          if (pathname === '/api/login' && r && r.token) platform.touchLogin(slug);
          send(res, 200, r);
        }).catch(fail);
      } catch (e) { fail(e); }
    });
  });
}

function serveStatic(url, res) {
  const rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('No encontrado'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

if (require.main === module) {
  const platform = new Platform(DATA_DIR);
  if (!platform.isSetup() && !process.env.SETUP_TOKEN) {
    process.env.SETUP_TOKEN = crypto.randomBytes(8).toString('hex');
    console.log(`Plataforma sin configurar. Código de instalación de esta sesión: ${process.env.SETUP_TOKEN}`);
  }
  platform.purgeExpired();
  setInterval(() => { try { const n = platform.purgeExpired(); if (n) console.log(`Demos vencidas eliminadas: ${n}`); } catch (e) { console.error(e); } }, 3600000).unref();
  createServer(platform).listen(PORT, HOST, () => console.log(`Contabilidad (multi-empresa) lista en http://${HOST}:${PORT}  (datos: ${DATA_DIR})`));
}
module.exports = { createServer };
