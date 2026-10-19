'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  salt TEXT NOT NULL, hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'vendedor', active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS accounts (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, nature TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS taxes (id INTEGER PRIMARY KEY, name TEXT NOT NULL, rate REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS thirds (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'cliente', doc_id TEXT, name TEXT NOT NULL, company TEXT,
  email TEXT, phone TEXT, address TEXT, price_list TEXT NOT NULL DEFAULT 'detal', doc_type TEXT NOT NULL DEFAULT '13', dv TEXT, city_code TEXT, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, category_id INTEGER, unit TEXT DEFAULT 'und',
  unit_code TEXT NOT NULL DEFAULT '94', price REAL NOT NULL DEFAULT 0, price2 REAL NOT NULL DEFAULT 0, brand TEXT, barcode TEXT, nso TEXT, cost REAL NOT NULL DEFAULT 0, stock REAL NOT NULL DEFAULT 0, min_stock REAL NOT NULL DEFAULT 0,
  tax_id INTEGER, is_service INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY, type TEXT NOT NULL, number TEXT NOT NULL, date TEXT NOT NULL, due_date TEXT,
  third_id INTEGER, subtotal REAL NOT NULL DEFAULT 0, discount REAL NOT NULL DEFAULT 0, tax REAL NOT NULL DEFAULT 0,
  withholding REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0, paid REAL NOT NULL DEFAULT 0, cogs REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'activo', ref TEXT, notes TEXT, user_id INTEGER, created_at TEXT,
  UNIQUE(type, number)
);
CREATE INDEX IF NOT EXISTS ix_doc_date ON documents(type, date);
CREATE TABLE IF NOT EXISTS doc_lines (
  id INTEGER PRIMARY KEY, doc_id INTEGER NOT NULL, product_id INTEGER, description TEXT, qty REAL NOT NULL,
  price REAL NOT NULL, disc_pct REAL NOT NULL DEFAULT 0, tax_id INTEGER, tax_rate REAL NOT NULL DEFAULT 0,
  base REAL NOT NULL, tax_amount REAL NOT NULL, total REAL NOT NULL, unit_cost REAL NOT NULL DEFAULT 0, account_code TEXT, lot TEXT, expiry TEXT
);
CREATE INDEX IF NOT EXISTS ix_line_doc ON doc_lines(doc_id);
CREATE TABLE IF NOT EXISTS withholdings (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, rate REAL NOT NULL, base TEXT NOT NULL DEFAULT 'subtotal',
  applies TEXT NOT NULL, account_code TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS doc_withholdings (
  id INTEGER PRIMARY KEY, doc_id INTEGER NOT NULL, name TEXT NOT NULL, rate REAL NOT NULL, base_amount REAL NOT NULL, amount REAL NOT NULL, account_code TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lots (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, lot TEXT, expiry TEXT, qty REAL NOT NULL, qty_left REAL NOT NULL, unit_cost REAL NOT NULL DEFAULT 0, doc_id INTEGER, date TEXT
);
CREATE INDEX IF NOT EXISTS ix_lot_prod ON lots(product_id, expiry);
CREATE TABLE IF NOT EXISTS lot_moves (id INTEGER PRIMARY KEY, doc_id INTEGER NOT NULL, lot_id INTEGER NOT NULL, qty REAL NOT NULL);
CREATE TABLE IF NOT EXISTS gateways (
  id INTEGER PRIMARY KEY, provider TEXT NOT NULL, name TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'sandbox',
  public_key TEXT, private_key_enc TEXT, events_secret_enc TEXT, link_template TEXT,
  account_code TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS gateway_links (
  id INTEGER PRIMARY KEY, gateway_id INTEGER NOT NULL, doc_id INTEGER NOT NULL, reference TEXT NOT NULL UNIQUE,
  external_id TEXT, url TEXT NOT NULL, amount REAL NOT NULL, created_at TEXT, user_id INTEGER
);
CREATE TABLE IF NOT EXISTS gateway_events (
  id INTEGER PRIMARY KEY, gateway_id INTEGER NOT NULL, tx_id TEXT NOT NULL, status TEXT, amount REAL, doc_id INTEGER,
  result TEXT, created_at TEXT, UNIQUE(gateway_id, tx_id)
);
CREATE TABLE IF NOT EXISTS einvoices (
  id INTEGER PRIMARY KEY, doc_id INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'factura', status TEXT NOT NULL,
  number TEXT, cufe TEXT, qr_url TEXT, pdf_url TEXT, provider TEXT, message TEXT, response TEXT, reason TEXT,
  created_at TEXT, updated_at TEXT, user_id INTEGER
);
CREATE INDEX IF NOT EXISTS ix_ei_doc ON einvoices(doc_id);
CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL, qty REAL NOT NULL,
  unit_cost REAL NOT NULL, value REAL NOT NULL, bal_qty REAL NOT NULL, bal_value REAL NOT NULL, doc_id INTEGER, notes TEXT
);
CREATE INDEX IF NOT EXISTS ix_move_prod ON stock_moves(product_id, id);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, date TEXT NOT NULL, doc_id INTEGER NOT NULL, third_id INTEGER,
  amount REAL NOT NULL, account_code TEXT NOT NULL, notes TEXT, status TEXT NOT NULL DEFAULT 'activo', user_id INTEGER
);
CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY, number INTEGER, date TEXT NOT NULL, description TEXT, source TEXT NOT NULL DEFAULT 'manual',
  source_id INTEGER, status TEXT NOT NULL DEFAULT 'activo', user_id INTEGER
);
CREATE INDEX IF NOT EXISTS ix_je_src ON journal_entries(source, source_id);
CREATE TABLE IF NOT EXISTS journal_lines (
  id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL, account_code TEXT NOT NULL, third_id INTEGER,
  debit REAL NOT NULL DEFAULT 0, credit REAL NOT NULL DEFAULT 0, memo TEXT
);
CREATE INDEX IF NOT EXISTS ix_jl_acc ON journal_lines(account_code);
CREATE INDEX IF NOT EXISTS ix_jl_entry ON journal_lines(entry_id);
`;

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  db.exec(SCHEMA);
  return db;
}

// Ejecuta fn dentro de una transacción (anidable con SAVEPOINT); revierte si lanza.
const depth = new WeakMap();
function tx(db, fn) {
  const d = depth.get(db) || 0;
  const sp = 'sp' + d;
  db.exec(d === 0 ? 'BEGIN' : 'SAVEPOINT ' + sp);
  depth.set(db, d + 1);
  try {
    const r = fn();
    db.exec(d === 0 ? 'COMMIT' : 'RELEASE ' + sp);
    return r;
  } catch (e) {
    try { db.exec(d === 0 ? 'ROLLBACK' : 'ROLLBACK TO ' + sp + '; RELEASE ' + sp); } catch (_) {}
    throw e;
  } finally { depth.set(db, d); }
}

module.exports = { open, tx };
