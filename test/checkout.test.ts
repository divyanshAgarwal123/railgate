// A Razorpay API failure — network blip, rejected request — must not crash the caller.
// Stubs globalThis.fetch (no library, no real network) to force that path.

import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.ts";
import { attemptCheckout } from "../src/checkout.ts";

test("checkout: a Razorpay failure is caught and logged, not thrown", async () => {
  const db = openDb(":memory:");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { description: "simulated outage" } }), { status: 500 })) as typeof fetch;

  try {
    const result = await attemptCheckout(db, {
      sessionId: "s1",
      merchantId: "m1",
      amountPaise: 50_000,
      product: "candle",
      description: "A hand-poured soy candle.",
    });
    assert.equal(result.status, "error");

    const incidents = db.prepare("SELECT kind FROM incidents WHERE kind = 'razorpay_error'").all();
    assert.equal(incidents.length, 1, "the failure should be on the record, not silent");
  } finally {
    globalThis.fetch = realFetch;
  }
});
