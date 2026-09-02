# Evidence

This is the reproducible claim matrix for Razorpay AI Buildathon Track 01.

| Claim | Evidence | Command |
|---|---|---|
| Core logic runs without credentials | 9 offline tests, including provider failure, concurrent-cap enforcement, and out-of-band single-use approval | `npm test` |
| The cap survives concurrent agents | Two simultaneous ₹600 requests under a ₹1000 cap produce one `executed`, one `blocked_pending_approval`, one provider call, ₹600 committed | `npm test` |
| Razorpay integration is real | Orders and Payment Links are created against Razorpay test mode; non-test keys are refused | `npm run day2` |
| MCP is real, not a direct function demo | Official MCP client spawns the stdio server and exercises catalog + checkout | `npm run mcp:test` |
| Human approval is out of band and single-use | Agent receives a pending id; human runs `npm run approve -- <id>`; `execute_approved` works once and replay fails | `npm run mcp` plus the approval command |
| A real AI buyer can drive it | Codex over MCP selected a product and created test order `order_TXJ0oLj5TOxt85`; a second hostile listing attempt returned `blocked_injection` with no order | `npm run agent:demo` (Codex CLI required) |
| The repository stays verifiable | GitHub Actions runs the offline suite on every push and pull request | `.github/workflows/test.yml` |

## Honest boundaries

- `executed` means Razorpay created an order and Payment Link. It does not mean the customer
  completed payment; payment capture/webhook reconciliation is not implemented.
- The seeded catalog is static and has one merchant.
- The regex description screen is defense-in-depth, not a complete injection detector. The
  hard boundary is server-authoritative product data plus deterministic budget accounting.
- Session ids are not authenticated principals. A production version needs merchant consent,
  user authentication, and revocation.
