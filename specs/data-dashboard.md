# /ops/data — every dataset live + downloadable

**CI subagent:** `data-dashboard` · **priority** 6

> This file is the SOURCE OF TRUTH for this area, not the code. If the code and this file
> disagree, the code is wrong. Adapted from GitHub Spec Kit's core rule and Geoffrey
> Huntley's /specs/ pattern: progress accumulates in FILES and git history, never in a
> model's context window.

## Green when

the screen total equals a direct count for the same filter

## Owned files

- `src/screens/DataExportScreen.jsx`\n- `supabase/functions/leads-dashboard/index.ts`

## Guards

- #203\n- #210

## Open defects

- [ ] screen counts have never been reconciled against a direct REST count

## Founder decisions on record

_(Nothing here yet. Anything Tarik decides about this area goes here VERBATIM, dated.
A paraphrase is not a decision — that is the mistake that produced an invented 6-city
list and a spec built from buggy code.)_

## Progress log

_(One line per CI-subagent run that changed something. Append, never rewrite.)_

## Founder decisions on record

**2026-08-02, verbatim:**

> dashboard design
>
> view per source and class (creator / services)
> filter per contactable…
> date download (last 24 hours, last 100 or 1000 pieces of data)..
> per city per type (personal trainer..) per city (nyc miami etc) and general location
> (manhattan brooklyn etc) for services .. and any category (if any for creators
> (parenting, pets etc)…

Read as the required filter set:

| filter | applies to | column |
|---|---|---|
| class | all | table selection |
| source | all | `data_source` / `discovered_via` / `source` |
| contactable | leads | `phone` OR email present |
| metro | leads | `state` (NY = NYC, FL = Miami) |
| locality | services | `city` (Manhattan, Brooklyn, Wynwood, …) |
| service type | services | `service_type` |
| category | creators | `category` |
| recency / size | all | last 24h · last 100 · last 1000 · all |

Metro and locality are SEPARATE filters. `state` is the metro and `city` is the
neighbourhood, so "Miami" as a metro must not be confused with "Miami" the city value —
that conflation is what made the Miami filter appear to vanish.

**2026-08-02, verbatim:** "you're calling services LIVE counts.. call it services"

The headline count is labelled with the CLASS being viewed — Services, Creators, Crawl
queue, Agent runs — never a generic "Leads". One label for four different things means the
headline number never says what it counts.

## Naming rule

| class | headline label | table |
|---|---|---|
| Services | **Services** | `leads_services` |
| Creators | **Creators** | `leads_influencers` |
| Crawl queue | **Crawl queue** | `crawl_requests` |
| Agent runs | **Agent runs** | `agent_runs` |
