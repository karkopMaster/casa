'use strict';
// Copia consistente de la base (VACUUM INTO, seguro con la app en marcha) y limpieza de copias antiguas.
// Uso: node src/backup.js <carpeta_destino> [dias_a_conservar=30]   (DB_FILE indica la base)
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const dest = process.argv[2];
const keepDays = parseInt(process.argv[3] || '30', 10);
const dbFile = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'contabilidad.db');
if (!dest) { console.error('Uso: node src/backup.js <carpeta_destino> [dias]'); process.exit(2); }
if (!fs.existsSync(dbFile)) { console.error('No existe la base: ' + dbFile); process.exit(1); }
fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
const out = path.join(dest, `contabilidad-${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.db`);
const db = new DatabaseSync(dbFile, { readOnly: true });
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
db.close();
fs.chmodSync(out, 0o600);
const limit = Date.now() - keepDays * 86400000;
for (const f of fs.readdirSync(dest)) {
  const fp = path.join(dest, f);
  if (/^contabilidad-.*\.db$/.test(f) && fs.statSync(fp).mtimeMs < limit) fs.unlinkSync(fp);
}
console.log('Copia creada: ' + out);
