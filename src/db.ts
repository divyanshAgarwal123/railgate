// Database + schema. Ported pattern from vivarium/src/state/db.ts — same reasons:
// WAL + synchronous=FULL because an audit trail that can lose a write it acknowledged
// isn't an audit trail.

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type Db = Database.Database;

export function openDb(path: string = process.env.RAILGATE_DB ?? resolve(process.cwd(), "var/railgate.db")): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT
    );

    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      session_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL,
      detail TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS checkout_pending (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      ts TEXT NOT NULL,
      merchant_id TEXT NOT NULL,
      amount_paise INTEGER NOT NULL,
      product TEXT NOT NULL,
      status TEXT NOT NULL,
      resolved_at TEXT,
      resolved_by TEXT
    );

    CREATE TABLE IF NOT EXISTS ledger_txns (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      session_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      reason TEXT NOT NULL,
      ref TEXT
    );

    CREATE TABLE IF NOT EXISTS ledger_legs (
      txn_id TEXT NOT NULL,
      account TEXT NOT NULL,
      amount_paise INTEGER NOT NULL
    );
  `);

  return db;
}

export function audit(
  db: Db,
  row: { actor: string; action: string; oldValue?: unknown; newValue?: unknown },
): void {
  db.prepare(
    "INSERT INTO audit_log (ts, actor, action, old_value, new_value) VALUES (?, ?, ?, ?, ?)",
  ).run(
    new Date().toISOString(),
    row.actor,
    row.action,
    row.oldValue !== undefined ? JSON.stringify(row.oldValue) : null,
    row.newValue !== undefined ? JSON.stringify(row.newValue) : null,
  );
}

export function incident(
  db: Db,
  row: { sessionId: string; kind: string; severity: string; detail: string },
): void {
  db.prepare(
    "INSERT INTO incidents (ts, session_id, kind, severity, detail) VALUES (?, ?, ?, ?, ?)",
  ).run(new Date().toISOString(), row.sessionId, row.kind, row.severity, row.detail);
}
