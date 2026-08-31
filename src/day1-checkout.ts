// Day 1: prove the raw Razorpay test-mode round trip works, before any governor
// code gets ported in. Nothing fancy — one order, one payment link, both real
// calls against api.razorpay.com. If this doesn't work in minutes, that's the
// signal to fix, not the governor.
//
// Usage: put real test-mode keys in .env (see .env.example), then:
//   npm run day1

import { checkKeys, createOrder, createPaymentLink } from "./razorpay.ts";

checkKeys();

const order = await createOrder(50000, `railgate-day1-${Date.now()}`); // ₹500, matches the pitch's demo
console.log("Order created:", order.id, order.status);

const link = await createPaymentLink(50000, "Railgate Day 1 — raw checkout round trip", order.id);
console.log("Payment link created:", link.short_url, link.status);

console.log("\nRound trip proven — safe to start Day 2 (wire this behind the governor).");
