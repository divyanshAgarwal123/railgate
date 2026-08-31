// Every money action, gated. This is the only path allowed to call Razorpay — nothing
// else in the codebase is permitted to reach api.razorpay.com directly.

import type { Db } from "./db.ts";
import { audit, incident } from "./db.ts";
import { CheckoutGateBlocked, requireCheckoutApproval, screenText } from "./governor.ts";
import { recordPurchase } from "./ledger.ts";
import { createOrder, createPaymentLink, type RazorpayPaymentLink } from "./razorpay.ts";

export type CheckoutResult =
  | { status: "executed"; orderId: string; paymentLink: RazorpayPaymentLink }
  | { status: "blocked_injection"; reason: string }
  | { status: "blocked_pending_approval"; pendingId: string; reason: string }
  | { status: "error"; reason: string };

export interface CheckoutInput {
  sessionId: string;
  merchantId: string;
  amountPaise: number;
  product: string;
  /** Freeform text from the merchant's catalog — outside the trust boundary, always screened. */
  description: string;
}

/**
 * The only place that actually calls Razorpay. A network blip, a rejected request, a
 * malformed response — none of it should crash the caller (the MCP server, mid-session).
 * It's logged as an incident and comes back as a clean `error` result instead, same rule
 * as the spend gate and the injection screen: a failure is data the caller gets to see,
 * never a silent crash.
 */
async function executeRazorpayOrder(
  db: Db,
  args: {
    sessionId: string;
    merchantId: string;
    amountPaise: number;
    product: string;
    auditAction: string;
    auditExtra?: Record<string, unknown>;
  },
): Promise<CheckoutResult> {
  try {
    const order = await createOrder(args.amountPaise, `railgate-${args.sessionId}-${Date.now()}`);
    const link = await createPaymentLink(args.amountPaise, args.product, order.id);

    recordPurchase(db, args.sessionId, args.merchantId, args.amountPaise, args.product, order.id);
    audit(db, {
      actor: "governor",
      action: args.auditAction,
      newValue: { sessionId: args.sessionId, orderId: order.id, amountPaise: args.amountPaise, ...args.auditExtra },
    });

    return { status: "executed", orderId: order.id, paymentLink: link };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    incident(db, { sessionId: args.sessionId, kind: "razorpay_error", severity: "critical", detail: reason });
    audit(db, {
      actor: "governor",
      action: "checkout.failed",
      newValue: { sessionId: args.sessionId, amountPaise: args.amountPaise, reason },
    });
    return { status: "error", reason };
  }
}

export async function attemptCheckout(db: Db, req: CheckoutInput): Promise<CheckoutResult> {
  // 1. Screen anything ingested from outside the trust boundary before it can influence
  //    the purchase at all.
  if (screenText(db, req.sessionId, "catalog_description", req.description)) {
    return { status: "blocked_injection", reason: "Product description flagged as instruction-like text" };
  }

  // 2. Gate the spend. Throws if this would breach the session's ceiling.
  try {
    requireCheckoutApproval(db, req);
  } catch (err) {
    if (err instanceof CheckoutGateBlocked) {
      return { status: "blocked_pending_approval", pendingId: err.pendingId, reason: err.message };
    }
    throw err;
  }

  // 3. Inside the bound — execute for real, against Razorpay test-mode.
  return executeRazorpayOrder(db, {
    sessionId: req.sessionId,
    merchantId: req.merchantId,
    amountPaise: req.amountPaise,
    product: req.product,
    auditAction: "checkout.executed",
  });
}

/** Executes a previously-approved pending request — called after a human approves it. */
export function executeApproved(
  db: Db,
  pending: { id: string; session_id: string; merchant_id: string; amount_paise: number; product: string },
): Promise<CheckoutResult> {
  return executeRazorpayOrder(db, {
    sessionId: pending.session_id,
    merchantId: pending.merchant_id,
    amountPaise: pending.amount_paise,
    product: pending.product,
    auditAction: "checkout.executed_after_approval",
    auditExtra: { pendingId: pending.id },
  });
}
