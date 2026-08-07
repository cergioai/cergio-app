# SPEC-269 — CI search relay: the search runs where the engines answer

Date: 2026-08-07. MEASURED chain that forces this design:
- agent_runs.meta.engines (SPEC-268, live): from the SUPABASE edge egress ALL FOUR keyless
  engines wall — ddg-html/lite parse 0, bing serves a challenge shell on all 52 queries,
  mojeek refuses the fetch.
- search-probe run #1 (runner 172.208.23.71): **ddg-html serves GitHub runners — HTTP 200,
  10 result__a blocks** (lite 202-challenge, bing 0 b_algo, mojeek 403).
So: same code, same query — the RUNNER IP is served, the edge IP is not. The free creator
crawl works if and only if the SEARCH leg runs from CI. Everything else stays put.

## Design (ONE micro-feature; extraction truth stays SINGLE, in the edge worker)
The #204 lesson forbids porting extraction/gates to a second Node copy ("the copy nobody
tested is the one reporting to the founder"). So CI carries only the TRANSPORT:
1. creator-harvest gains two POST body modes (service-role bearer auth UNCHANGED, checked
   before any mode dispatch):
   - {mode:'queries'} → build the run's query slice exactly as a crawl run would (committed
     kill-switch, fresh self-stop, per-(category×metro) caps all run first) and RETURN it —
     no search, no writes beyond the agent_runs log.
   - {mode:'ingest', items:[{query,niche,city,results:[{url,title,snippet}…]}…]} → run the
     UNMODIFIED per-result pipeline (extraction, geo verify, blocked/business/suppression,
     handle dedupe, capped upsert) over the POSTED results. Items are validated: city must
     be a CITY_STATE key and niche.category a TARGET category, results bounded to 12/query,
     items to MAX_QUERIES. The quality gates all re-run at ingest, so a stale or hostile
     payload can produce nothing the crawl mode couldn't.
   - default cron mode: unchanged (ladder search — if an engine ever unwalls, the edge lane
     resumes being useful on its own).
2. scripts/creator-harvest-relay.mjs (Node, CI-only): queries mode → ddg-html fetch per
   query from the RUNNER (8s timeout, 10-12 results, jittered 300-700ms between queries so
   the runner IP is not burned the way the edge was) → ingest mode POST. Bearer =
   SUPABASE_SERVICE_ROLE_KEY (already a repo secret — the growth-setup kick step uses it).
3. .github/workflows/creator-harvest-relay.yml: every 15 min + workflow_dispatch.
   GitHub cron is best-effort (delays are normal) — the edge cron lanes keep ticking
   regardless, so the relay ADDS a working transport rather than replacing a schedule.

## Money/paid: $0, keyless, no vendor. PAID IG STAYS FORBIDDEN.

## Gate #269 (mutation-tested): auth precedes mode dispatch; queries mode returns without
searching; ingest validates city+category and bounds results; the injected-results path
feeds the SAME processQuery pipeline; relay script targets ddg-html and both modes; the
workflow schedules the relay and passes the service bearer from secrets.
