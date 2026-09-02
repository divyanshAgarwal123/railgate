// A Razorpay API failure — network blip, rejected request — must not crash the caller.
// Stubs globalThis.fetch (no library, no real network) to force that path.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.ts";
import { attemptCheckout, executeApproved } from "../src/checkout.ts";
import { sessionSpend } from "../src/ledger.ts";
import { approve, consumeApproval } from "../src/governor.ts";

test("checkout: a Razorpay failure is caught and logged, not thrown", async () => {
  const db = openDb(":memory:");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { description: "simulated outage" } }), { status: 500 })) as typeof fetch;

  try {
    const result = await attemptCheckout(db, {
      sessionId: "s1",
      productId: "prod_candle",
    });
    assert.equal(result.status, "error");

    const incidents = db.prepare("SELECT kind FROM incidents WHERE kind = 'razorpay_error'").all();
    assert.equal(incidents.length, 1, "the failure should be on the record, not silent");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("checkout: concurrent requests cannot race past the session ceiling", async () => {
  const db = openDb(":memory:");
  const realFetch = globalThis.fetch;
  let orderCalls = 0;
  globalThis.fetch = (async (url) => {
    if (String(url).endsWith("/orders")) {
      orderCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(JSON.stringify({ id: `order_${orderCalls}`, status: "created" }));
    }
    return new Response(
      JSON.stringify({ id: "plink_1", short_url: "https://example.test/pay", status: "created" }),
    );
  }) as typeof fetch;

  try {
    const request = {
      sessionId: "race",
      productId: "prod_diffuser",
    };
    const results = await Promise.all([attemptCheckout(db, request), attemptCheckout(db, request)]);
    assert.deepEqual(
      results.map((result) => result.status).sort(),
      ["blocked_pending_approval", "executed"],
    );
    assert.equal(orderCalls, 1, "only the reserved checkout may reach Razorpay");
    assert.equal(sessionSpend(db, "race"), 60_000, "committed spend must remain below the ₹1000 ceiling");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("checkout: approval from a separate connection executes once", async () => {
  const directory = mkdtempSync(join(tmpdir(), "railgate-approval-"));
  const dbPath = join(directory, "railgate.db");
  const serverDb = openDb(dbPath);
  const realFetch = globalThis.fetch;
  let orderCalls = 0;
  globalThis.fetch = (async (url) => {
    if (String(url).endsWith("/orders")) {
      orderCalls += 1;
      return new Response(JSON.stringify({ id: `order_${orderCalls}`, status: "created" }));
    }
    return new Response(
      JSON.stringify({ id: `plink_${orderCalls}`, short_url: "https://example.test/pay", status: "created" }),
    );
  }) as typeof fetch;

  try {
    assert.equal((await attemptCheckout(serverDb, { sessionId: "s1", productId: "prod_candle" })).status, "executed");
    const blocked = await attemptCheckout(serverDb, { sessionId: "s1", productId: "prod_diffuser" });
    assert.equal(blocked.status, "blocked_pending_approval");
    if (blocked.status !== "blocked_pending_approval") return;

    const humanDb = openDb(dbPath);
    approve(humanDb, blocked.pendingId);
    humanDb.close();

    assert.equal(consumeApproval(serverDb, blocked.pendingId), true);
    assert.equal((await executeApproved(serverDb, blocked.pendingId)).status, "executed");
    assert.equal(consumeApproval(serverDb, blocked.pendingId), false, "the same approval cannot be replayed");
    assert.equal(orderCalls, 2);
  } finally {
    globalThis.fetch = realFetch;
    serverDb.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
