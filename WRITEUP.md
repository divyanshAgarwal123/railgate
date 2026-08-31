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

Before writing any code, I ran the idea through an adversarial four-pass review — a Believer
making the strongest case for it, a Skeptic trying to kill it, an Investor asking whether the
underlying bet was actually testable, and a Judge weighing the three. The verdict came back
FIX FIRST, and the reason was the build order I'd planned: port the governor/ledger/
injection-screen safety layer first (the part I already had a proven pattern for), and only
wire the actual Razorpay API on day two. That's backwards risk sequencing on a five-day solo
clock with zero prior hands-on time against Razorpay's live API — I'd scheduled the *proven*
part first and the *unproven, external* part last, which is exactly the kind of ordering
mistake that quietly eats a hackathon's runway. The fix was mechanical: invert it. Day one
became nothing but a raw, ungated order + payment-link round trip against Razorpay
test-mode — no governor, no MCP, just proof the one genuinely unknown piece worked. Only once
that was real, live, and returning actual order IDs did the safety layer get ported in on day
two, and MCP on day three.

Two smaller, real catches worth naming because a hackathon judge reading a repo should be
able to tell the difference between "never broke" and "broke, in ways I actually noticed and
fixed": the first version of the day-one script used Node's `--env-file=.env` flag, which
throws on a missing file — so the very first run, before any keys existed, crashed with a raw
ENOENT instead of the readable "here's what to do" message it was supposed to give. Caught by
actually running it empty-handed instead of assuming the happy path; fixed with
`--env-file-if-exists=.env`. And when staging the first commit, the demo's own runtime
SQLite file (containing whatever test orders earlier runs had created) nearly went into
`git add -A` because `var/` wasn't in `.gitignore` yet — caught by reading `git status`
before committing rather than committing blind, which is the same discipline the project's
own audit trail is supposed to enforce on everything else.
