-- SPEC-220 — CI subagent reports live in the PRODUCT database, not on a git branch.
-- Founder: "need dashboard with live #'s and download a report of CI subagents... not github."
create table if not exists public.ci_subagent_runs (
  id            bigserial primary key,
  agent         text not null,
  title         text,
  priority      int,
  verdict       text not null,           -- GREEN | NEEDS WORK | CANNOT RUN | DID NOT RUN
  gates_pass    int default 0,
  gates_total   int default 0,
  defects       int default 0,
  build         text,
  wall          text,
  green_when    text,
  work_state    text,                    -- FIXED | ATTEMPTED | FINDING | NO FINDING | CANNOT RUN
  finding       text,
  evidence      text,
  fix           text,
  file_changed  text,
  why_not       text,
  ran_at        timestamptz not null default now()
);
create index if not exists ci_subagent_runs_agent_time on public.ci_subagent_runs (agent, ran_at desc);
alter table public.ci_subagent_runs enable row level security;
-- Admin-only read through the edge function (service role); no anon policy on purpose.
