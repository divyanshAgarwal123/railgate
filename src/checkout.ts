// Every money action, gated. This is the only path allowed to call Razorpay — nothing
// else in the codebase is permitted to reach api.razorpay.com directly.

import type { Db } from "./db.ts";
import { audit } from "./db.ts";
import { CheckoutGateBlocked, requireCheckoutApproval, screenText } from "./governor.ts";
import { recordPurchase } from "./ledger.ts";
import { createOrder, createPaymentLink, type RazorpayPaymentLink } from "./razorpay.ts";

export type CheckoutResult =
  | { status: "executed"; orderId: string; paymentLink: RazorpayPaymentLink }
  | { status: "blocked_injection"; reason: string }
  | { status: "blocked_pending_approval"; pendingId: string; reason: string };

export interface CheckoutInput {
  sessionId: string;
  merchantId: string;
  amountPaise: number;
  product: string;
  /** Freeform text from the merchant's catalog — outside the trust boundary, always screened. */
  description: string;
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
  const order = await createOrder(req.amountPaise, `railgate-${req.sessionId}-${Date.now()}`);
  const link = await createPaymentLink(req.amountPaise, req.product, order.id);

  recordPurchase(db, req.sessionId, req.merchantId, req.amountPaise, req.product, order.id);
  audit(db, {
    actor: "governor",
    action: "checkout.executed",
    newValue: { sessionId: req.sessionId, orderId: order.id, amountPaise: req.amountPaise },
  });

  return { status: "executed", orderId: order.id, paymentLink: link };
}

/** Executes a previously-approved pending request — called after a human approves it. */
export async function executeApproved(
  db: Db,
  pending: { id: string; session_id: string; merchant_id: string; amount_paise: number; product: string },
): Promise<CheckoutResult> {
  const order = await createOrder(pending.amount_paise, `railgate-${pending.session_id}-${Date.now()}`);
  const link = await createPaymentLink(pending.amount_paise, pending.product, order.id);

  recordPurchase(db, pending.session_id, pending.merchant_id, pending.amount_paise, pending.product, order.id);
  audit(db, {
    actor: "governor",
    action: "checkout.executed_after_approval",
    newValue: { pendingId: pending.id, orderId: order.id },
  });

  return { status: "executed", orderId: order.id, paymentLink: link };
}
