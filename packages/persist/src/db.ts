/**
 * SQLite persistence (Node 22 `node:sqlite` / DatabaseSync).
 * Chargé via `process.getBuiltinModule` pour éviter le bundling Vitest/Vite.
 * No better-sqlite3 — engines never import this module.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

type SqliteModule = typeof import("node:sqlite");
type DatabaseSync = InstanceType<SqliteModule["DatabaseSync"]>;

export type SqliteDb = DatabaseSync;

function loadSqlite(): SqliteModule {
  const getter = (
    process as NodeJS.Process & {
      getBuiltinModule?: (id: string) => unknown;
    }
  ).getBuiltinModule;
  if (typeof getter !== "function") {
    throw new Error("node:sqlite requires Node.js >= 22 (process.getBuiltinModule)");
  }
  return getter("node:sqlite") as SqliteModule;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  kyc_status TEXT NOT NULL DEFAULT 'pending',
  sgi_id TEXT NOT NULL,
  cash INTEGER NOT NULL DEFAULT 0,
  cash_locked INTEGER NOT NULL DEFAULT 0,
  mfa_secret TEXT,
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS holdings (
  user_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, asset_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settlements (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  summary TEXT NOT NULL,
  severity TEXT NOT NULL,
  correlation_id TEXT,
  details_json TEXT
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sgi_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS governance_proposals (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  proposed_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_intents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('deposit', 'withdraw')),
  amount INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
`;

export function resolveDbPath(dbPath?: string): string {
  return dbPath ?? process.env.AOTC_DB_PATH ?? ".data/aotc.sqlite";
}

export function openDatabase(dbPath?: string): SqliteDb {
  const path = resolveDbPath(dbPath);
  mkdirSync(dirname(path), { recursive: true });
  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}
