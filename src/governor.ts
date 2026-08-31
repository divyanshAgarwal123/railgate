/**
 * THE GOVERNOR — ported pattern from vivarium/src/governor/index.ts, same rule: enforced
 * in code and checked before the action, never by asking the model nicely. The agent has
 * no tool that bypasses this. Inside the bound: executes immediately. Outside it: a
 * pending_approval a human must confirm — never a silent block, never a silent execution.
 */

import { randomUUID } from "node:crypto";
import { audit, incident, type Db } from "./db.ts";
import { sessionSpend } from "./ledger.ts";

// ponytail: fixed caps for the demo, not read from config — raise if the buildathon judges
// want to see a bigger number live; this is the one knob a real deployment would move to
// per-merchant config.
export const CAPS = {
  SESSION_SPEND_CEILING_PAISE: 100_000, // ₹1000 per session before anything needs a human
};

export class CheckoutGateBlocked extends Error {
  name = "CheckoutGateBlocked";
  pendingId: string;
  constructor(message: string, pendingId: string) {
    super(message);
    this.pendingId = pendingId;
  }
}

export interface CheckoutRequest {
  sessionId: string;
  merchantId: string;
  amountPaise: number;
  product: string;
}

/**
 * Gate a checkout. Passes through silently if the session's cumulative spend (including
 * this purchase) stays under the ceiling. Otherwise files a pending request and THROWS —
 * the agent does not get the purchase. A human releases it with `approve(id)`.
 */
export function requireCheckoutApproval(db: Db, req: CheckoutRequest): void {
  const spent = sessionSpend(db, req.sessionId);
  const after = spent + req.amountPaise;
  if (after <= CAPS.SESSION_SPEND_CEILING_PAISE) return;

  const id = `pend_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  db.prepare(
    `INSERT INTO checkout_pending (id, session_id, ts, merchant_id, amount_paise, product, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
  ).run(id, req.sessionId, new Date().toISOString(), req.merchantId, req.amountPaise, req.product);

  audit(db, {
    actor: "governor",
    action: "checkout.blocked",
    newValue: { id, sessionId: req.sessionId, amountPaise: req.amountPaise, wouldTotal: after },
  });

  throw new CheckoutGateBlocked(
    `Session spend ceiling would be breached: ₹${after / 100} > ₹${CAPS.SESSION_SPEND_CEILING_PAISE / 100}. ` +
      `Blocked pending your approval: approve(${id})`,
    id,
  );
}

export function approve(db: Db, id: string, by = "human"): void {
  const row = db.prepare("SELECT status FROM checkout_pending WHERE id = ?").get(id) as
    | { status: string }
    | undefined;
  if (!row) throw new Error(`No pending request ${id}`);
  if (row.status !== "pending") throw new Error(`Request ${id} is already ${row.status}`);

  db.prepare(
    "UPDATE checkout_pending SET status = 'approved', resolved_at = ?, resolved_by = ? WHERE id = ?",
  ).run(new Date().toISOString(), by, id);
  audit(db, { actor: "human", action: "checkout.approved", newValue: { id, by } });
}

export function deny(db: Db, id: string, by = "human"): void {
  db.prepare(
    "UPDATE checkout_pending SET status = 'denied', resolved_at = ?, resolved_by = ? WHERE id = ?",
  ).run(new Date().toISOString(), by, id);
  audit(db, { actor: "human", action: "checkout.denied", newValue: { id, by } });
}

/** Single-use: consuming one approval never authorises the next purchase, even identical. */
export function consumeApproval(db: Db, id: string): boolean {
  const changed = db
    .prepare("UPDATE checkout_pending SET status = 'consumed' WHERE id = ? AND status = 'approved'")
    .run(id).changes;
  if (changed === 1) {
    audit(db, { actor: "governor", action: "checkout.consumed", newValue: { id } });
    return true;
  }
  return false;
}

export function getPending(db: Db, id: string) {
  return db.prepare("SELECT * FROM checkout_pending WHERE id = ?").get(id) as
    | { id: string; session_id: string; merchant_id: string; amount_paise: number; product: string; status: string }
    | undefined;
}

/**
 * Tool output is data, never instruction. Same patterns as vivarium's screenToolOutput —
 * a poisoned product listing trying to talk its way past the spend cap is the same shape
 * of attack as a compromised tool result, just arriving from a merchant's catalog field
 * instead of a sibling organism's inbox.
 */
const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore (all |your |previous )?(prior |above )?(instructions|rules|caps|limits)/i,
  /you are (now )?(authoris|authoriz)ed/i,
  /(raise|remove|disable|bypass|lift|skip|override)\s+(your|the|its)?\s*(\w+\s+){0,2}(caps?|ceilings?|limits?|governor|approvals?|guardrails?)\b/i,
  /(system|admin|razorpay|merchant) (override|instruction|command)/i,
  /new (system )?prompt:/i,
];

export function screenText(db: Db, sessionId: string, source: string, text: string): boolean {
  const hit = INJECTION_PATTERNS.find((re) => re.test(text));
  if (!hit) return false;
  incident(db, {
    sessionId,
    kind: "injection",
    severity: "warn",
    detail: `Instruction-like text from ${source} matched ${hit}: ${text.slice(0, 300)}`,
  });
  return true;
}
