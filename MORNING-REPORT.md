# Morning report — 2026-08-21 13:40 UTC

**0 of 9 agents GREEN.** Everything below is sorted worst first.

| agent | verdict | gates | defects |
|---|---|---|---|
| **payments** | **NEEDS WORK** | 2/2 | 4 |
| **booking-loop** | **NEEDS WORK** | 3/3 | 5 |
| **inbox** | **NEEDS WORK** | 1/1 | 4 |
| **profile-ux** | **NEEDS WORK** | 1/1 | 2 |
| **ig-verify** | **NEEDS WORK** | 1/1 | 4 |
| **ops-dashboard** | **NEEDS WORK** | 5/5 | 5 |
| **data-dashboard** | **NEEDS WORK** | 2/2 | 1 |
| **ci-health** | **NEEDS WORK** | 1/1 | 2 |
| **legal-copy** | **NEEDS WORK** | 1/1 | 1 |

**Green when:**

- **payments** — one real booking reaches paid_at with a Stripe charge id
- **booking-loop** — a live walk completes the loop with two real accounts
- **inbox** — every inbox row maps 1:1 to a distinct live DB row, every row carries a timestamp, and the founder can find any request + its replies in one place
- **profile-ux** — every profile surface names its owner correctly and a countered price follows the user onto the service page
- **ig-verify** — the IG verify flow enforces the highlight, links to the service, notifies the provider for approval, and /services/manage shows the intended form
- **ops-dashboard** — changing any filter changes the counts, and every facet list is derived from live rows
- **data-dashboard** — the screen total equals a direct count for the same filter
- **ci-health** — e2e is green and required, or deleted with the reason recorded — a permanently red advisory check is worse than no check
- **legal-copy** — legal review clears the copy, or it is de-securitised and the paraphrases are added to the gate

## What the CI subagents DID this run

- **profile-ux — ATTEMPTED and REVERTED** `src/screens/ProfileScreen.jsx`: FW-7 reply-offer context is not carried through location.state navigation to ServiceDetailScreen when a reply card navigates, so the preConfirmed booking CTA cannot wire to the offer details.
  Thrown away because qa gates failed. The working tree is byte-for-byte as it was. This is the loop working, not failing.
- **ig-verify — ATTEMPTED and REVERTED** `src/screens/ServiceListVerifyScreen.jsx`: ServiceListVerifyScreen.jsx does not enforce the story-highlight confirmation as a mandatory guard before submission, violating FW-10 fixed 2026-08-04.
  Thrown away because build failed. The working tree is byte-for-byte as it was. This is the loop working, not failing.
- **ops-dashboard — ATTEMPTED and REVERTED** `supabase/functions/_shared/opsPayload.ts`: The download filter does not apply city/location/category/time scoping, violating the spec contract that ALL counts and EVERY CSV obey the same five filters.
  Thrown away because qa gates failed. The working tree is byte-for-byte as it was. This is the loop working, not failing.
- **data-dashboard — ATTEMPTED and REVERTED** `src/screens/DataExportScreen.jsx`: The screen's 'Download view' button downloads `rows` (the client-side filtered set after legacy exclusion), but the count it displays comes from `data.filteredTotal` (the server count), which includes legacy rows when `showLegacy` is false — the populations diverge and the CSV will contradict the number.
  Thrown away because qa gates failed. The working tree is byte-for-byte as it was. This is the loop working, not failing.

## What the agents found this run

### booking-loop — confidence high

**acceptRequestWithTime does not write a booking.provider_id before returning, leaving the booking orphaned — a subsequent query for the provider's own bookings cannot find it.**

Evidence: `Line ~2575: `const { data, error } = await supabase.rpc('accept_request_with_time', ...)` returns only the booking id. The RPC is server-side; if it does not write provider_id, the client cannot. No subsequent UPDATE fixes it. A booking with provider_id=NULL cannot be found by 'WHERE provider_id = $`

Proposed: Verify the RPC 'accept_request_with_time' writes bookings.provider_id = p_service.owner_id before returning the booking id. If the RPC is correct, no change needed here; if not, the RPC must be fixed (outside these three files). If this agent owns the RPC, escalate immediately.

### inbox — confidence high · NEEDS YOU

**The timeAgo() function produces an empty string when given an invalid or missing ISO timestamp, but no error is logged or thrown, making silent failures invisible per house rule 'never swallow an error'.**

Evidence: `Lines 206–215: `if (!iso) return '';` and `if (Number.isNaN(ms)) return '';` and `try { return new Date(iso).toLocaleDateString(...); } catch { return ''; }` — all swallow errors and return silent empty strings.`

Proposed: Either guard all callers to never pass invalid timestamps (fail-fast before render), or log the invalid input so data defects surface: `console.warn('timeAgo: invalid iso', iso);` before returning empty string.

### ci-health — confidence high · NEEDS YOU

**e2e Playwright test is advisory (never blocks merge) despite being required by spec — the defect is baselined but never resolved, creating a permanently red advisory check which is worse than no check per house rules.**

Evidence: `ci.yml line 82-95: e2e job runs but has no `required: true` enforcement; spec says 'e2e is green and required, or deleted with the reason recorded' — the current state is neither (not required AND not deleted with reason).`

Proposed: Either make e2e a hard requirement in ci.yml branch protection (move it from advisory to blocking), or delete the e2e job entirely and document the reason in a committed comment explaining why it was removed, so the defect is resolved not baselined.

### legal-copy — confidence high · NEEDS YOU

**AboutScreen carries de-securitised APGI copy ('discretionary loyalty-style bonus, not a security') but gate #170 is not documented as having been updated to catch the paraphrased risk language, leaving the known defect from the spec unresolved.**

Evidence: `src/screens/AboutScreen.jsx line ~135: 'Every dollar earned can also add Asset Participation Growth Income (APGI) — a discretionary loyalty-style bonus, not a security and with no fixed dollar value.' The comment cites 'Terms §7 + gate #170' but the spec (under 'Open defects') explicitly flags that `

Proposed: Either (1) confirm gate #170 has been updated to catch this specific paraphrase and document that in the spec's Founder decisions section, or (2) file a gate update task to add the paraphrase to #170's banned patterns before this copy ships to production.

## What each agent is waiting on

### payments — Payment on accept — THE LAUNCH BLOCKER

- bookings_paid has been 0 for the life of the project — no card has ever been charged end to end
- counter-offer price shown vs charged (SPEC-211/212 shipped; needs live proof)
- FW-8 (founder walk 2026-08-02): enable Stripe TEST mode / dummy-card path so the booking E2E can be walked without real money ('enable card payments to pay with stripe ... or enable testing with dummy card')
- FW-9 (founder verbatim 2026-08-02, sharpens defect #1): 'user needs to pay when accepting a counter offer ... so their card is charged automatically... to eliminate the additional pay step... (funds kept until job done.. per spec release)'

Full report: `reports/payments.md`

### booking-loop — Request -> accept -> schedule -> complete

- FW-3 RESOLVED-AS-DATA (2026-08-03, live DB probe): request_responses.responder_id + services.owner_id are CONSISTENT — the 'Babysitter' listing is OWNED by the founder's own 'Tarik Sansal' account, so 'Tarik accepted' was factually correct. Residual UX hardening: the accept line should carry the SERVICE title next to the name so a self-test like this reads clearly. Do NOT change responder writes.
- core loop is auth-gated so it has only ever been verified in code, never walked live
- FW-2 FIXED IN CODE 2026-08-05: the intake time-question is now ENFORCED — a request cannot reach submission until the 'when' carries a real time signal (dates/days/windows, asap/now/tonight, or the flexible family); signal-less replies re-ask with the SAME existing copy. Typo-nudge deliberately out of scope. Verify live, then close.
- FW-5 FIXED IN CODE 2026-08-05: server-side send-once ledger (request_notify_ledger, migration 20260805100000, atomic ON CONFLICT DO NOTHING, backfilled from existing notifications) — a provider can never be re-announced the same request; fail-open only on ledger outage with loud logs. Verify live, then close.
- FW-6 RESOLVED-AS-DESIGN (2026-08-04, code-trace evidence): default IS Paid (App.jsx useState(false)); the founder's account flipped to free because SPEC-131 auto-classifies Connectors and FROZEN SPEC-71#3 sets CONNECTOR_MIN_FOLLOWERS=300 for testing — his profile satisfies it (cc_verified_at or ig_followers>=300). Remedy is data/config (clear the flag on the test account, or the frozen plan's 5000 threshold at soft launch), NOT app code. Founder may unfreeze SPEC-131/71 with one sentence if he wants different behavior.

Full report: `reports/booking-loop.md`

### inbox — Jobs inbox — one truthful card per event

- FW-1 FIXED IN CODE 2026-08-04: Home now has a persistent 'Your requests & replies' entry (signed-in) straight to /inbox?tab=Requests, and the inbox honors the tab deep-link. Verify live, then close.
- FW-1 FIXED IN CODE 2026-08-04: Home now has a persistent 'Your requests & replies' entry (signed-in) straight to /inbox?tab=Requests, and the inbox honors the tab deep-link. Verify live, then close.
- FW-1 FIXED IN CODE 2026-08-04: Home now has a persistent 'Your requests & replies' entry (signed-in) straight to /inbox?tab=Requests, and the inbox honors the tab deep-link. Verify live, then close.
- FW-16 FIXED IN CODE 2026-08-05: inbox request-match now uses the fan-out's bridge UNION (both request columns vs taxonomy∪category expanded sets) — a notified provider can never have the request hidden from his inbox again. Verify live: pending Driver request must appear for the driver account.

Full report: `reports/inbox.md`

### profile-ux — Profiles + service pages say WHO they are

- FW-4 FIXED IN CODE 2026-08-04: own-profile name now sources profiles.display_name first (auth metadata / email local-part as fallbacks) — the screen read only auth user_metadata, which is unset for accounts whose name lives in the profiles row. The 'provider profile shows requester name' half was already proven DATA-CONSISTENT. Verify live, then close.
- FW-7 FIXED IN CODE 2026-08-04: reply/counter context now travels to the service page — CTA reads 'Book · $X' at the reply's exact price (SPEC-211 seen==charged) wired to the same preConfirmed booking action as the reply card; direct visits unchanged. Verify live, then close.

Full report: `reports/profile-ux.md`

### ig-verify — IG post verify + listing management

- FW-10 FIXED IN CODE 2026-08-04: the Story-Highlight step is now a REQUIRED confirmation whenever a post is part of the submission (free barter always; paid once a link is pasted) — submit stays disabled until confirmed. Paid-no-post stays allowed per FROZEN SPEC-53; if the founder meant the post itself must be mandatory even when paid, that needs his one-line unfreeze. Verify live, then close.
- FW-11 FIXED IN CODE 2026-08-03 (Copy link now shares the SERVICE page when the reco has a service; recommender invite link only when no listing exists) — verify live after deploy, then close
- FW-12 FIXED IN CODE 2026-08-04: submitting an IG review/post now notifies the provider ('X posted an IG review of your service — review and approve') via the notify-request edge fn 'reviewed' action, incl. the previously-silent held-review and paid-no-link paths; also documented the broken bare-id notifyUser call. Edge fn redeploys via CI. Verify live, then close.
- FW-13 FIXED IN CODE 2026-08-05 (reading 3, backed by the founder's recorded no-popup rule 'cancel request should be in line (not a pop up from browser)'): ServiceDetailProviderScreen field edits are now INLINE (input + Save/Cancel), window.prompt removed. NOTE: CrossPostScreen.jsx:68 still has a live window.prompt — separate follow-up. Verify live, then close.

Full report: `reports/ig-verify.md`

### ops-dashboard — /ops/status — the founder's console

- every count and CSV must obey City (DMA), Location, Category, Time and Rows — the LIVE counts bypassed all of them and made working filters look broken
- DMAs and every facet must come FROM THE DATA, never a hardcoded list
- deleting an export from opsPayload crashed the whole console with 'SOURCES is not defined' — no count, no filter, no DMA
- exactly TWO creator sources; a list of six put four permanent zeros beside the real ones
- google_sponsored is folded into google_lsa, never shown as its own row

Full report: `reports/ops-dashboard.md`

### data-dashboard — /ops/data — every dataset live + downloadable

- screen counts have never been reconciled against a direct REST count

Full report: `reports/data-dashboard.md`

### ci-health — CI honesty

- the e2e Playwright suite has been RED on main since roughly CI #11 and is advisory, so it never blocks a merge
- 9 duplicate gate IDs baselined in qa-id-baseline.json

Full report: `reports/ci-health.md`

### legal-copy — Securities language

- /rainmaker/apply carries securities-PARAPHRASE copy that gate #170 is blind to — it bans 5 exact phrasings, not the risk

Full report: `reports/legal-copy.md`

## The honest limit of this page

The gate suite is STATIC — it reads source and makes no network calls. A GREEN agent
means "the code says the right thing and its guards are in place". It does NOT mean
"this works in production". Every item needing live proof is listed as an open defect
and stays open until an artifact exists: an HTTP status, a screenshot, or a DB row.

No agent in this fleet edits code unattended. They verify and report. Fixes are
approved in the morning and applied one at a time inside a cell.
