-- ─────────────────────────────────────────────────────────────────────────────
-- Cergio — SPEC-69: periodic workers (makes the pipeline self-running).
--
-- pg_cron calls our edge functions on a schedule via pg_net. The service-role
-- bearer is read from Vault so no secret is committed to git.
--
-- Scheduled here (all idempotent / safe no-ops until their prerequisites exist):
--   fulfill-crawl       every 15 min  — source businesses for no-data searches + notify searcher
--   enrich-influencers  every 30 min  — fill creator emails/phones from bio/website
--   crawl-health-check  every  2 h    — email admin if crawls stall/fail/empty
--   release-funds       every 15 min  — release held booking funds when due (no-op unless HOLD_RELEASE_ENABLED)
--
-- NOT scheduled: outreach-send. Cold email/SMS stays MANUAL (the launcher) until
-- you explicitly choose to automate the blast — we don't auto-send on a timer.
--
-- ── ONE-TIME SETUP (run once, then this migration) ───────────────────────────
--   insert into vault.secrets (name, secret)
--   values ('edge_fn_bearer', 'Bearer <YOUR SUPABASE_SERVICE_ROLE_KEY>')
--   on conflict (name) do update set secret = excluded.secret;
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

create or replace function public.cergio_call_edge(fn text)
returns void language plpgsql security definer as $$
declare bearer text;
begin
  select decrypted_secret into bearer from vault.decrypted_secrets where name = 'edge_fn_bearer';
  if bearer is null then
    raise notice 'cergio_call_edge: vault secret edge_fn_bearer not set; skipping %', fn;
    return;
  end if;
  perform net.http_post(
    url     := 'https://vjmwnbftfquyquwaklue.functions.supabase.co/' || fn,
    headers := jsonb_build_object('Content-Type','application/json','Authorization', bearer),
    body    := '{}'::jsonb
  );
end $$;

do $$
declare j text;
begin
  foreach j in array array['cergio_fulfill_crawl','cergio_enrich_influencers','cergio_crawl_health','cergio_release_funds'] loop
    if exists (select 1 from cron.job where jobname = j) then perform cron.unschedule(j); end if;
  end loop;
end $$;

select cron.schedule('cergio_fulfill_crawl',      '*/15 * * * *', $$ select public.cergio_call_edge('fulfill-crawl'); $$);
select cron.schedule('cergio_enrich_influencers', '*/30 * * * *', $$ select public.cergio_call_edge('enrich-influencers'); $$);
select cron.schedule('cergio_crawl_health',       '0 */2 * * *',  $$ select public.cergio_call_edge('crawl-health-check'); $$);
select cron.schedule('cergio_release_funds',      '*/15 * * * *', $$ select public.cergio_call_edge('release-funds'); $$);

-- To stop all: select cron.unschedule(jobname) from cron.job where jobname like 'cergio_%';
