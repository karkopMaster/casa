import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "./config";

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new Database(path.join(config.dataDir, "olt-manager.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT UNIQUE NOT NULL,
  clave_hash TEXT NOT NULL,
  creado TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  hash TEXT UNIQUE NOT NULL,
  creada TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS olts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT UNIQUE NOT NULL,
  marca TEXT NOT NULL DEFAULT 'huawei',
  host TEXT NOT NULL,
  puerto INTEGER NOT NULL DEFAULT 22,
  usuario TEXT NOT NULL,
  clave_cifrada TEXT NOT NULL,
  ultimo_sondeo TEXT,
  ultimo_error TEXT
);
CREATE TABLE IF NOT EXISTS perfiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  olt_id INTEGER NOT NULL REFERENCES olts(id) ON DELETE CASCADE,
  line_profile TEXT NOT NULL,
  srv_profile TEXT NOT NULL,
  nombre TEXT NOT NULL
);
-- external_id = "unique external ID" de SmartOLT: es el valor que ConectaPro guarda en contrato.onuIdentificador
CREATE TABLE IF NOT EXISTS onus (
  external_id TEXT PRIMARY KEY,
  olt_id INTEGER NOT NULL REFERENCES olts(id) ON DELETE CASCADE,
  frame INTEGER NOT NULL, slot INTEGER NOT NULL, port INTEGER NOT NULL, ont_id INTEGER NOT NULL,
  sn TEXT NOT NULL,
  nombre TEXT NOT NULL DEFAULT '',
  direccion TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'desconocido',   -- online | offline | desconocido
  admin_estado TEXT NOT NULL DEFAULT 'Enabled',  -- Enabled | Disabled
  rx_onu REAL, tx_onu REAL, rx_olt REAL,
  tr069_id TEXT,
  actualizado TEXT,
  UNIQUE (olt_id, frame, slot, port, ont_id)
);
CREATE INDEX IF NOT EXISTS onus_sn ON onus(sn);
CREATE TABLE IF NOT EXISTS pendientes (
  olt_id INTEGER NOT NULL REFERENCES olts(id) ON DELETE CASCADE,
  frame INTEGER, slot INTEGER, port INTEGER,
  sn TEXT NOT NULL, equipo TEXT, visto TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (olt_id, sn)
);
CREATE TABLE IF NOT EXISTS bitacora (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT NOT NULL, accion TEXT NOT NULL, detalle TEXT, ok INTEGER NOT NULL DEFAULT 1
);
`);

export function bitacora(actor: string, accion: string, detalle: string, ok = true) {
  db.prepare("INSERT INTO bitacora (actor, accion, detalle, ok) VALUES (?,?,?,?)").run(actor, accion, detalle.slice(0, 500), ok ? 1 : 0);
}
