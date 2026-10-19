'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { open } = require('./db');
const { build } = require('./api');
const { HttpError } = require('./core');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1'; // detrás de Caddy/nginx: la IP real viene en X-Forwarded-For
const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'contabilidad.db');
const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

function createServer(db) {
  const api = build(db);
  const send = (res, status, data, headers = {}) => {
    const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  };
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
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
          if (chunks.length) { try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'JSON inválido'); } }
          const token = (req.headers.authorization || '').replace(/^Bearer /, '');
          const query = Object.fromEntries(url.searchParams);
          if (url.pathname === '/api/backup' && req.method === 'GET') {
            const u = api.authenticate(token);
            if (!u || u.role !== 'admin') throw new HttpError(403, 'Solo el administrador puede descargar copias');
            const tmp = path.join(require('os').tmpdir(), `backup-${Date.now()}.db`);
            db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
            const buf = fs.readFileSync(tmp); fs.unlinkSync(tmp);
            return send(res, 200, buf, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="contabilidad-${new Date().toISOString().slice(0, 10)}.db"` });
          }
          const out = api.dispatch(req.method, url.pathname, query, body, token, (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress, { raw: Buffer.concat(chunks).toString('utf8'), headers: req.headers });
          return Promise.resolve(out).then((r) => send(res, 200, r)).catch(fail);
        } catch (e) { fail(e); }
      });
      return;
    }
    // estáticos
    let rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

if (require.main === module) {
  const db = open(DB_FILE);
  createServer(db).listen(PORT, HOST, () => console.log(`Contabilidad lista en http://${HOST}:${PORT}  (base: ${DB_FILE})`));
}
module.exports = { createServer };
