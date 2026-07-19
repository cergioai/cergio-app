-- SPEC-86: the live leads_influencers.outreach_status CHECK rejected 'pending_review'
-- (23514), blocking the creator-harvest quality gate + the vetted seed. Rebuild the
-- CHECK as a guaranteed superset of every status already present + required sentinels.
-- (Applied live 2026-07-18 via the Supabase Management API launcher; recorded here.)
DO $$
DECLARE c text; vals text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.leads_influencers'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%outreach_status%'
  LOOP EXECUTE format('ALTER TABLE public.leads_influencers DROP CONSTRAINT %I', c); END LOOP;
  SELECT string_agg(quote_literal(v), ',') INTO vals FROM (
    SELECT DISTINCT outreach_status AS v FROM public.leads_influencers WHERE outreach_status IS NOT NULL
    UNION SELECT unnest(ARRAY['new','queued','contacted','delivered','opted_in',
                              'do_not_contact','pending_review','sendable','bounced','replied','failed'])
  ) s;
  EXECUTE 'ALTER TABLE public.leads_influencers ADD CONSTRAINT leads_influencers_outreach_status_check '
       || 'CHECK (outreach_status IN (' || vals || '))';
END $$;
