# SPEC-244 — the DMA is its own definition, not the state column

**Founder, 2026-08-03, verbatim:** "THE DMA is technically held by it's own DMA
definition (that's unrelated to state)... orlando is also a key DMA in FL... NYC DMA
includes Jersey City (state of new jersey)... this is standard DMA ... use a standard
DMA definition / boundary"

Corrects SPEC-240's keying: the quota map used the state column ('NY'/'FL') as a DMA
proxy. A state is not a DMA — Florida holds Miami-Ft. Lauderdale AND Orlando AND Tampa;
the New York DMA reaches into NJ (Jersey City, Newark) and CT.

## The change, one micro-feature

1. `_shared/opsPayload.ts` — the ONE committed DMA definition: `DMAS` (Nielsen codes
   501 = New York, 528 = Miami-Ft. Lauderdale; households from Nielsen 2024-25 "Local
   Television Market Universe Estimates" — cited, gate-pinned), `LOCATION_DMA`
   (founder-named: Jersey City → 501, Newark → 501; further NJ/CT locations are a
   standing TODO against the Nielsen county list — never from memory),
   `DMA_STATE_SPELLINGS` (NJ/CT spellings inside 501 — those rows are IN-target now),
   `resolveDma()` (legacy 'NY'/'FL' still resolve). Membership = LOCATION first, then
   state spelling; only a row matching neither is off-target. LIVE counter re-keyed;
   miami_target now comes from the quota map (it had drifted to a 20,000 nobody set).
2. `growth-controls.json` — PHASE1_CITY_QUOTA re-keyed `{"501":50000,"528":11700}`.
3. `fulfill-crawl/index.ts` — P1_DMA re-keyed 501/528 + Jersey City/Newark (gate #240
   weld holds: both lists updated identically).
4. `scripts/_growth-scope.mjs` — DMA_LOCATIONS re-keyed; activeCities matches cities
   to DMAs through DMA_LOCATIONS membership, not the state tuple.
5. `leads-dashboard/index.ts` — metro filter is a DMA code (legacy accepted), matched
   via the spelling set (`.in`), never one `eq`; byCity keyed by Nielsen DMA names.
6. `DataExportScreen.jsx` — City options carry DMA codes 501/528.
7. Gate `#207` re-pinned to the DMA-code keys; new gate `#244` mutation-tested 7 ways
   (state keys back, Jersey City dropped, NJ spelling dropped, membership state-only,
   P1_DMA state key, single-eq filter, state-tuple activeCities).

## Not invented

No county lists were added from memory. Only the founder-named locations (Jersey City,
Newark) joined the 501 bucket; the TODO for other NJ/CT locations stands in the code
with the Philadelphia-DMA caveat recorded.
