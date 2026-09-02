#!/usr/bin/env node
// Day 3: the same governed checkout, now over MCP — so Claude (or any MCP client) drives
// it directly instead of a demo script. Four tools: an agent-readable catalog
// (list_products / get_product) and two gated actions (checkout / execute_approved) that are the only
// path allowed to reach Razorpay. create_order and checkout collapse into one tool here —
// attemptCheckout already does both, and splitting them added a step with no real demo
// value.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { checkKeys } from "./razorpay.ts";
import { openDb } from "./db.ts";
import { attemptCheckout, executeApproved } from "./checkout.ts";
import { consumeApproval } from "./governor.ts";
import { getProduct, listProducts } from "./catalog.ts";

checkKeys();
const db = openDb();

const server = new McpServer({ name: "railgate", version: "0.0.1" });

server.registerTool(
  "list_products",
  {
    title: "List a merchant's products",
    description: "Agent-readable catalog for a Razorpay merchant.",
    inputSchema: { merchantId: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ merchantId }) => ({
    content: [{ type: "text", text: JSON.stringify(listProducts(merchantId)) }],
  }),
);

server.registerTool(
  "execute_approved",
  {
    title: "Execute a human-approved checkout",
    description:
      "Execute one pending checkout after a human has approved its exact id out of band. " +
      "The approval is single-use; calling this without approval or calling it twice fails.",
    inputSchema: { pendingId: z.string() },
    annotations: { destructiveHint: true },
  },
  async ({ pendingId }) => {
    if (!consumeApproval(db, pendingId)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ status: "error", reason: "Approval is missing or already consumed" }),
          },
        ],
        isError: true,
      };
    }
    const result = await executeApproved(db, pendingId);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  "get_product",
  {
    title: "Get one product",
    description: "Fetch a single product's price and description by id.",
    inputSchema: { productId: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ productId }) => {
    const product = getProduct(productId);
    if (!product) return { content: [{ type: "text", text: "Not found" }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(product) }] };
  },
);

server.registerTool(
  "checkout",
  {
    title: "Buy a product",
    description:
      "Attempt to buy a product for a shopper session. Bounded and gated: a purchase " +
      "that would breach the session's spend ceiling comes back as blocked_pending_approval " +
      "instead of executing or silently failing; a poisoned product description comes back " +
      "as blocked_injection and never reaches Razorpay.",
    inputSchema: { sessionId: z.string(), productId: z.string() },
    annotations: { destructiveHint: true },
  },
  async ({ sessionId, productId }) => {
    const product = getProduct(productId);
    if (!product) return { content: [{ type: "text", text: "Not found" }], isError: true };

    const result = await attemptCheckout(db, { sessionId, productId });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Railgate MCP server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
