# Cergio — project constitution

Read at the start of every session. Survives compaction. If anything below conflicts with
an instruction later in a conversation, **this file wins** unless Tarik overrides it explicitly.

## What Cergio is
A services marketplace: AI + friend recommendations. Consumers request a service; providers
and "Connectors" (creators who spotlight providers on Instagram) respond. Soft launch is
Miami + NYC only.

## Who I work for
Tarik — founder, **non-developer**. He relays my status to investors, so overstated language
becomes misrepresentation. He wants small, confirmed, incremental deliveries.

## Architecture
- **Frontend**: React + Vite SPA, react-router-dom v6, Tailwind. Deployed on Vercel.
- **Product DB**: Supabase `vjmwnbftfquyquwaklue` — auth, profiles, services, requests,
  bookings, agent_runs, qa_findings.
- **Growth DB**: a SEPARATE Supabase project — `crawl_requests`, `leads_services`,
  `leads_influencers`. Reached ONLY through `growthDb()` / `growthClient()`.
- **Workers**: Supabase edge functions (Deno), driven by pg_cron + GitHub Actions.
- **Ship path**: sandbox pushes `ship/**` → auto-ship opens a PR → CI `build-and-qa` is a
  REQUIRED check → squash-merge to `main`. I never push to `main` directly.

## Key commands
- `node scripts/qa.mjs` — the gate suite (0 dependencies, pure static, runs anywhere)
- `npx vite build` — build check
- Growth truth: `git show origin/growth-status:GROWTH-STATUS.md`

## CRITICAL RULES

### Verification
- **NEVER guess. Measure first.** "Candidate cause" is the only permitted phrasing before
  a measurement. Three production outages came from asserting a cause I had not measured.
- **No claim without LIVE evidence** — an HTTP status, a screenshot, or a DB row, in the
  same message. Otherwise say exactly: "merged; static checks pass; NOT verified live."
- **Every new gate must be MUTATION-TESTED**: break the thing it guards, watch it FAIL,
  restore it. I once shipped 9 gates that were incapable of failing.
- `qa.mjs` fails on a **thrown assert**. `return 'message'` is TRUTHY and silently passes.
  Always `assert(!(badCondition), 'why this matters')`.
- Wrap greps in `stripComments()` when the term also appears in the fix's own comment.

### Changes
- **ONE micro-feature at a time.** WIP limit is 1. Never two changes in flight.
- Every PR must be revertible on its own. Never bundle two features.
- Plan FIRST, code SECOND. For anything non-trivial, write the plan to `./plans/` first.
- Never delete or weaken a passing gate to make a change fit.
- Before using an identifier, confirm the binding exists **in that scope** — do not infer
  it from another usage elsewhere in the file. Hook dependency arrays must sit BELOW every
  const they name. Module-level helpers must not close over handler-scoped consts.

### Money
- **Never spend $1 without proven output.** Paid sources get a $1 tranche and may not
  advance until that dollar produced leads at ≤$0.05/lead.
- Aborting an HTTP request does **NOT** cancel a metered vendor run — it keeps billing.
  Always pass the vendor's own timeout/cancel parameter.
- Diagnose a paid vendor's 4xx against its BILLING state before its credentials.
- Never propose paid expansion or new geography as a fix for low yield. Yield is an
  engineering problem. Exhaust free sources first.

### Product
- Read `FROZEN_SPEC.md` before ANY code change. Confirmed chat behaviour is frozen spec.
- Consult `design-spec.md` before UI work. Never eyeball colours.
- **Never ship fake or mock data on a real screen.**
- Instagram scraping: **permitted by explicit founder override** (Tarik, 2026-08-01:
  "didn't agree.. specifically said to continue running IG (override)"). ig_services runs
  Apify IG user search by founder order. The pre-override rule ("first-party API only")
  is superseded; do not re-park ig_services on its account.
- Blocked categories never surface: massage, tattoo, makeup, personal chef, surgery,
  drugs, alcohol, tobacco, gambling, firearms, adult, nightclub-DJ.
- No securities / equity / IPO language anywhere users see (Howey risk).
- Never cold-blast automated SMS (TCPA/FTSA).

### Communication
- Tarik does not read long prose. Ship the fix, then report in a few lines.
- Failures and zeros FIRST, then what works.
- Anything I cannot verify myself (payments, passwords, vendor account state) becomes a
  named founder action with the exact click path — never buried in prose.

## Agents
- Use `planner` before any complex task — it writes to `./plans/`, never code.
- Use `source-doctor` for ONE crawl source at a time; it may not touch another source.
- Use `feature-builder` for ONE micro-feature; small diffs, gate + live proof required.
- Use `verifier` after code changes — mutation-tests new gates, runs the live walk.
- Use `spend-auditor` before enabling or widening any paid source.

## Definition of Done
A micro-feature is DONE only with all five: (1) spec line with an ID in `FROZEN_SPEC.md`,
(2) code in one revertible PR, (3) a mutation-tested gate, (4) a dated live-proof artifact,
(5) a `SPEC-REGISTRY.md` row flipped to PROVEN. Miss one and it is not done.
