-- SPEC-93: schedule the LIVE verification suite. This is the layer that was missing:
-- qa.mjs is static-only and qa-suite was never scheduled, so two user-facing bugs
-- (create-setup-intent 500; spotlight IG link) shipped unseen. Runs every 3h.
select cron.schedule('cergio_qa_live_verify', '7 */3 * * *', $$ select public.cergio_call_edge('qa-live-verify'); $$);
-- Also schedule the existing DB-observable qa-suite, which was NEVER scheduled.
select cron.schedule('cergio_qa_suite', '17 */6 * * *', $$ select public.cergio_call_edge('qa-suite'); $$);
