-- SPEC-89: blast-radius cap on the autonomous COO's SQL execution hand.
--
-- ROOT CAUSE (Forensic Auditor 2026-07-21): cergio_coo_exec_sql validated the
-- SHAPE of a COO-proposed UPDATE (single reversible UPDATE of a lead table, has a
-- WHERE, no prohibited verbs) but placed NO bound on HOW MANY ROWS the WHERE
-- matches. coo-brain is explicitly told to AUTO-RUN (requires_approval=false)
-- category quarantines like
--     UPDATE leads_services SET outreach_status='do_not_contact'
--     WHERE outreach_status IN ('queued','new')
--       AND lower(coalesce(service_type,'')||' '||coalesce(name,'')) ~ 'restaurant|cafe|...'
-- On the BROAD services table a single over-wide regex matches tens of thousands
-- of rows and executes unattended. That is the mechanism of the 2026-07-18..19
-- event that dumped ~33,000 businesses into do_not_contact (Miami services -> 0),
-- a Miami-first / soft-launch regression. It can recur on any coo-execute tick.
--
-- FIX: run the UPDATE inside a plpgsql subtransaction, capture the affected count,
-- and if it exceeds a sane blast-radius cap, RAISE — which rolls the subtransaction
-- back so NO rows are changed — and report the overreach. The caller (coo-execute)
-- routes a capped statement to the founder's approval queue (requires_approval=true)
-- instead of auto-running it. This operationalizes coo-brain's own rule that
-- large/destructive changes must be gated to a human. Small, targeted, on-spec
-- quarantines/relabels (the intended use — a handful of mislabeled leads) run
-- unchanged. Fully reversible; changes no data on the capped path.
--
-- Cap = 2000 rows: comfortably above any legitimate targeted fix, far below a
-- table-wide sweep. A genuinely large but correct quarantine still lands in the
-- approval queue for one founder click rather than firing blind.

create or replace function public.cergio_coo_exec_sql(stmt text)
returns integer language plpgsql security definer
set search_path = public as $fn$
declare
  n integer;
  cap constant integer := 2000;
  s text := lower(coalesce(stmt, ''));
begin
  -- Must be exactly one statement (no stacking).
  if position(';' in rtrim(stmt, ' ' || chr(10) || chr(9) || ';')) > 0 then
    raise exception 'coo_exec_sql: multiple statements are not allowed';
  end if;
  -- Must be an UPDATE (the only reversible write shape we permit here).
  if s !~ '^\s*update\s' then
    raise exception 'coo_exec_sql: only single UPDATE statements are permitted';
  end if;
  -- Hard-deny irreversible / privileged / send / auth verbs anywhere in the text.
  if s ~ '(delete|drop|truncate|grant|revoke|alter\s+role|alter\s+table|create\s|insert\s|update\s+auth\.|auth\.|storage\.|vault\.|pg_catalog|information_schema|copy\s|call\s|do\s+\$|;\s*\S)' then
    raise exception 'coo_exec_sql: statement contains a prohibited verb/target';
  end if;
  -- Only these safe tables may be written.
  if s !~ '^\s*update\s+(public\.)?(leads_services|leads_influencers)\s' then
    raise exception 'coo_exec_sql: only leads_services / leads_influencers may be updated';
  end if;
  -- Must be scoped (a WHERE clause) so it can never rewrite an entire table.
  if s !~ '\swhere\s' then
    raise exception 'coo_exec_sql: UPDATE must have a WHERE clause';
  end if;

  -- BLAST-RADIUS CAP (SPEC-89): apply inside a subtransaction so an over-broad
  -- WHERE is rolled back to a NO-OP rather than dumping the pool. The BEGIN/
  -- EXCEPTION block is a Postgres savepoint: raising inside it undoes `execute
  -- stmt` entirely, then we re-raise so the caller parks it for human approval.
  begin
    execute stmt;
    get diagnostics n = row_count;
    if n > cap then
      raise exception
        'coo_exec_sql: blast radius % exceeds cap of % rows — refused (route to human approval)',
        n, cap using errcode = 'raise_exception';
    end if;
  exception
    when others then
      -- Subtransaction has rolled back: zero rows changed. Re-raise verbatim so
      -- coo-execute records the refusal and gates the proposal to the founder.
      raise;
  end;

  return n;
end $fn$;

revoke all on function public.cergio_coo_exec_sql(text) from public, anon, authenticated;
grant execute on function public.cergio_coo_exec_sql(text) to service_role;
