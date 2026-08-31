// The one runnable check on the MCP layer: spawn the real server as a subprocess, drive
// it with a real MCP client over stdio, and assert the three tools actually round-trip —
// not just that the functions work when called directly (day2-demo already proves that).
//
// Usage: npm run mcp:test

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";

const transport = new StdioClientTransport({
  command: "node",
  args: ["--env-file-if-exists=.env", "src/mcp-server.ts"],
});
const client = new Client({ name: "railgate-smoke-test", version: "0.0.1" });
await client.connect(transport);

function textOf(result: { content: { type: string; text?: string }[] }): string {
  const block = result.content.find((c) => c.type === "text");
  assert.ok(block?.text, "expected a text content block");
  return block.text;
}

const products = JSON.parse(
  textOf(await client.callTool({ name: "list_products", arguments: { merchantId: "candle-co" } }) as any),
);
assert.equal(products.length, 3, "catalog should have 3 seeded products");
console.log("✓ list_products returned the seeded catalog");

const candle = JSON.parse(
  textOf(await client.callTool({ name: "get_product", arguments: { productId: "prod_candle" } }) as any),
);
assert.equal(candle.name, "Scented candle");
console.log("✓ get_product fetched a single product");

const bought = JSON.parse(
  textOf(
    await client.callTool({
      name: "checkout",
      arguments: { sessionId: "smoke-test", productId: "prod_candle" },
    }) as any,
  ),
);
assert.equal(bought.status, "executed", "clean purchase under cap should execute");
assert.ok(bought.orderId?.startsWith("order_"), "should return a real Razorpay order id");
console.log("✓ checkout executed a real Razorpay order:", bought.orderId);

const poisoned = JSON.parse(
  textOf(
    await client.callTool({
      name: "checkout",
      arguments: { sessionId: "smoke-test", productId: "prod_bulk" },
    }) as any,
  ),
);
assert.equal(poisoned.status, "blocked_injection", "poisoned listing must be blocked, not executed");
console.log("✓ checkout blocked the poisoned listing before it reached Razorpay");

await client.close();
console.log("\nAll MCP round trips passed.");
