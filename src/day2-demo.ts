// Day 2: the same Razorpay round trip from Day 1, now behind the governor. Three
// scenarios, in order — this is the actual demo reel for "one failure handled
// gracefully" (two failures, in fact: a spend-cap breach and a prompt injection).
//
//   A. A clean purchase under the session's spend ceiling — executes for real.
//   B. A second purchase that would breach the ceiling — blocked, pending_approval,
//      then a human approves it and it executes.
//   C. A purchase whose product description is a prompt-injection attempt — caught by
//      the screen, blocked, never reaches Razorpay at all.
//
// Usage: npm run day2

import { checkKeys } from "./razorpay.ts";
import { openDb } from "./db.ts";
import { approve, consumeApproval } from "./governor.ts";
import { attemptCheckout, executeApproved } from "./checkout.ts";

checkKeys();
const db = openDb(process.env.RAILGATE_DB ?? ":memory:");
const sessionId = "demo-session";

console.log("--- A. Clean purchase under the cap ---");
const a = await attemptCheckout(db, {
  sessionId,
  productId: "prod_candle",
});
console.log(a);

console.log("\n--- B. Second purchase breaches the ₹1000 session ceiling ---");
const b = await attemptCheckout(db, {
  sessionId,
  productId: "prod_diffuser",
});
console.log(b);

if (b.status === "blocked_pending_approval") {
  console.log("\n  Human reviews and approves it out of band...");
  approve(db, b.pendingId);
  consumeApproval(db, b.pendingId);
  const executed = await executeApproved(db, b.pendingId);
  console.log("  Now executed:", executed);
}

console.log("\n--- C. Poisoned product listing tries to jailbreak an oversized purchase ---");
const c = await attemptCheckout(db, {
  sessionId,
  productId: "prod_bulk",
});
console.log(c);

console.log("\n--- Audit trail ---");
console.log(db.prepare("SELECT ts, actor, action, new_value FROM audit_log ORDER BY id").all());

console.log("\n--- Incidents ---");
console.log(db.prepare("SELECT ts, kind, severity, detail FROM incidents ORDER BY id").all());
