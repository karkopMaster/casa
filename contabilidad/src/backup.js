'use strict';
// Copia consistente (VACUUM INTO, segura con la app en marcha) de la base de la plataforma y de CADA empresa,
// y limpieza de copias antiguas. Uso: node src/backup.js <carpeta_destino> [dias_a_conservar=30]
// La carpeta de datos sale de DATA_DIR, o de la carpeta de DB_FILE.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const dest = process.argv[2];
const keepDays = parseInt(process.argv[3] || '30', 10);
const dataDir = process.env.DATA_DIR || (process.env.DB_FILE ? path.dirname(process.env.DB_FILE) : path.join(__dirname, '..', 'data'));
if (!dest) { console.error('Uso: node src/backup.js <carpeta_destino> [dias]'); process.exit(2); }

const sources = [];
if (fs.existsSync(path.join(dataDir, 'platform.db'))) sources.push(['plataforma', path.join(dataDir, 'platform.db')]);
const td = path.join(dataDir, 'tenants');
if (fs.existsSync(td)) for (const f of fs.readdirSync(td)) if (/^[a-z0-9-]+\.db$/.test(f)) sources.push([f.slice(0, -3), path.join(td, f)]);
if (!sources.length) { console.error('No se encontraron bases en ' + dataDir); process.exit(1); }

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
let fallos = 0;
for (const [name, file] of sources) {
  const out = path.join(dest, `${name}-${stamp}.db`);
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`); db.close();
    fs.chmodSync(out, 0o600);
  } catch (e) { fallos++; console.error(`Falló la copia de ${name}: ${e.message}`); }
}
const limit = Date.now() - keepDays * 86400000;
for (const f of fs.readdirSync(dest)) {
  const fp = path.join(dest, f);
  if (/^[a-z0-9-]+-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.db$/.test(f) && fs.statSync(fp).mtimeMs < limit) fs.unlinkSync(fp);
}
console.log(`Copias creadas: ${sources.length - fallos}/${sources.length} en ${dest}`);
process.exit(fallos ? 1 : 0);
