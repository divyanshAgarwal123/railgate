# Application form answers

Draft text for the two open-ended fields — "what it solves" and "what broke, and how you
got out." Trim to whatever the form's character limit turns out to be; longest-first so the
cut is easy.

## What it solves

Razorpay + NPCI already proved agentic UPI checkout works — Feb 2026, agentic payments live
inside Claude for Zomato, Swiggy and Zepto, secured by one-time consent plus per-merchant
spend limits, no PIN/OTP per transaction. What's still bespoke, redone per integration, is
the safety layer underneath that: how much can an agent spend before a human has to sign
off, what happens when a product listing itself tries to talk an agent past its own limit,
and how a merchant proves after the fact exactly why a transaction did or didn't happen.

Railgate is that layer, standalone: an MCP-exposed agent-readable catalog plus one gated
`checkout` action in front of Razorpay's test-mode Orders + Payment Links APIs. Every call
either executes for real, gets blocked with a `pending_approval` a human has to release, or
gets blocked as a flagged injection — never silently blocked, never silently executed. A
double-entry ledger and an append-only audit log mean "show the audit trail" is a query, not
a reconstruction. Verified live: a clean purchase executing, a spend-cap breach surfacing a
clean approval request, and a poisoned product description caught before it ever reached
Razorpay — all three over a real MCP client/server round trip, not a mocked demo.

## What broke, and how I got out

The demo worked and every sequential test passed, but the final adversarial review found the
core spend cap was still raceable. I fired two ₹600 checkouts concurrently at a fresh ₹1,000
session. Both read ₹0 spent before either Razorpay call returned, both passed the check, and
both executed: ₹1,200 committed under a ₹1,000 ceiling. The bug was a classic check-then-act
gap around an awaited network call—the exact kind of failure a payments system cannot hide
behind a successful happy-path demo.

I replaced the request-time comparison with an atomic reservation. An immediate SQLite
transaction now reads executed spend plus in-flight reservations and reserves the amount
before any Razorpay request starts. The external call then settles that reservation to
`executed` or releases it as `failed`. The regression test launches both ₹600 requests at
once and proves the invariant: one executes, one returns `blocked_pending_approval`, exactly
one Razorpay order call occurs, and committed spend remains ₹600. That test now runs in CI.

The same audit exposed two related gaps: the MCP smoke test passed a temporary database path
that `openDb()` silently ignored, so repeated runs leaked spend state; and the supposed human
approval in the demo was an automatic function call. `openDb()` now honours `RAILGATE_DB`,
the live MCP test passes repeatedly from a clean in-memory database, and approval is a real
out-of-band CLI action. The AI can execute that exact approved id once, but it has no tool to
approve itself and a replay is rejected.
