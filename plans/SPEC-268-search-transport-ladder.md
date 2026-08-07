# SPEC-268 — keyless search transport ladder (the measured DDG bot-wall fix)

Date: 2026-08-07. MEASURED via SPEC-267's runs surface (agent_runs meta, product DB):
every creator-harvest run builds 52 queries and gets raw_results=0 with EVERY skip counter
0 and site_fetches 0 — ddgSearch returns [] for every query on BOTH endpoints
(html.duckduckgo.com AND the lite fallback), while the SAME query from the founder's
residential browser returns 10 organic results. That is an IP-class bot-wall against the
Supabase egress, not endpoint death and not an extraction defect (extraction never runs).
site-enrich fetches arbitrary sites from the same egress fine — DDG specifically walls.

## Change (ONE micro-feature, creator-harvest only, $0, keyless)
ddgSearch becomes a TRANSPORT LADDER: ddg-html → ddg-lite → bing → mojeek. First engine
returning ≥1 parsed result wins; result shape unchanged ({url,title,snippet}), so every
downstream gate (extraction, geo, dedupe, caps) is untouched.
- Bing HTML (www.bing.com/search?q=): parse b_algo blocks; decode bing.com/ck/a redirect
  hrefs (base64url u= param, 'a1' prefix) so downstream sees REAL urls.
- Mojeek (www.mojeek.com/search?q=): independent index, plain hrefs.
- PER-ENGINE TELEMETRY: each run's meta gains engines:{<name>:{tried,got}} — the next tick
  MEASURES which transport works from the edge instead of anyone guessing again.
- Hard-fail cooldown: an engine whose FETCH failed (null/timeout — not merely 0 parsed
  results) is skipped for 10 min (module-level stamp, warm-worker scoped) so a dead engine
  costs one 8s timeout per cooldown window, not 8s × 52 queries × every run.
- Per-request timeout stays 8000ms per engine (the #265b rule: never buy reach with hangs).
- NO paid API, NO key, NO vendor: the founder's order is verbatim "not paid! IG".

## Gate #268 (mutation-tested): pins the ladder order (ddg first, lite second — #264b's
lite pin still holds), the bing + mojeek endpoints + the ck/a decode, the engines
telemetry write into logAgentRun meta, the 8s cap, and the fetch-fail-only cooldown rule.
