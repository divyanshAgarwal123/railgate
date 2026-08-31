// Double-entry ledger, ported from vivarium/src/economy/ledger.ts. Same invariant:
// every transaction's legs sum to zero or it's rejected — that's what makes "show the
// audit trail" a query instead of a reconstruction.
//
// Unit is paise (Razorpay's own smallest unit) — no invented currency abstraction needed
// for a single-currency demo.

import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";

export interface Leg {
  account: string;
  amountPaise: number;
}

export interface TxnInput {
  sessionId: string;
  kind: "purchase" | "refund";
  reason: string;
  legs: Leg[];
  ref?: string | null;
}

export class UnbalancedTransaction extends Error {}

export const sessionAccount = (sessionId: string) => `session:${sessionId}`;
export const merchantAccount = (merchantId: string) => `merchant:${merchantId}`;

export function post(db: Db, txn: TxnInput): string {
  const sum = txn.legs.reduce((acc, l) => acc + l.amountPaise, 0);
  if (sum !== 0) {
    throw new UnbalancedTransaction(`Ledger legs must sum to zero, got ${sum} paise for "${txn.reason}"`);
  }
  if (txn.legs.length < 2) throw new UnbalancedTransaction("A transaction needs at least two legs");

  const id = `txn_${randomUUID().replaceAll("-", "")}`;
  db.transaction(() => {
    db.prepare(
      "INSERT INTO ledger_txns (id, ts, session_id, kind, reason, ref) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, new Date().toISOString(), txn.sessionId, txn.kind, txn.reason, txn.ref ?? null);
    const insertLeg = db.prepare(
      "INSERT INTO ledger_legs (txn_id, account, amount_paise) VALUES (?, ?, ?)",
    );
    for (const leg of txn.legs) insertLeg.run(id, leg.account, leg.amountPaise);
  })();

  return id;
}

export function balanceOf(db: Db, account: string): number {
  const row = db
    .prepare("SELECT COALESCE(SUM(amount_paise), 0) AS bal FROM ledger_legs WHERE account = ?")
    .get(account) as { bal: number };
  return row.bal;
}

/** What a session has spent so far — this is what the spend ceiling checks against. */
export function sessionSpend(db: Db, sessionId: string): number {
  return -balanceOf(db, sessionAccount(sessionId));
}

/** Record an executed purchase: money leaves the session, lands on the merchant. */
export function recordPurchase(
  db: Db,
  sessionId: string,
  merchantId: string,
  amountPaise: number,
  reason: string,
  ref: string,
): string {
  return post(db, {
    sessionId,
    kind: "purchase",
    reason,
    ref,
    legs: [
      { account: sessionAccount(sessionId), amountPaise: -amountPaise },
      { account: merchantAccount(merchantId), amountPaise },
    ],
  });
}
