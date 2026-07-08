# Off-Mac edge-function deploys

Deploying Supabase edge functions no longer needs the Mac. A GitHub Actions
workflow (`.github/workflows/deploy-functions.yml`) deploys every function in CI
whenever you push to `main` with a change under `supabase/functions/**`.

## The ONE human step (do this once)

Add a repository secret so CI can authenticate to Supabase:

1. GitHub → this repo → **Settings** → **Secrets and variables** → **Actions**
2. **New repository secret**
3. Name: `SUPABASE_ACCESS_TOKEN`
4. Value: a Supabase **personal access token**
   (Supabase dashboard → **Account** → **Access Tokens** → generate one)
5. Save.

That's it. After the token is set, **every** function deploy runs off-Mac via CI
on push — no laptop, no `supabase login`, no secret in the repo.

## What runs automatically

- Trigger: push to `main` touching `supabase/functions/**` (or `supabase/migrations/**`),
  plus a manual "Run workflow" button in the Actions tab.
- Action: `supabase functions deploy <fn> --project-ref vjmwnbftfquyquwaklue --no-verify-jwt`
  for the full function set.
- Auth: the `SUPABASE_ACCESS_TOKEN` secret only — the project ref is public.

## Still manual: migrations

Schema migrations under `supabase/migrations/**` are **not** applied by this
workflow (that needs the DB password and an auto-migrate-on-push is riskier than
a function deploy). Apply them separately — the Mac migration `.command`, or
`supabase db push` with the DB password — then push the function change and CI
handles the rest.

## Reverting

Delete `.github/workflows/deploy-functions.yml` (and, if desired, this file). No
other files or secrets are affected; the existing `ci.yml` gate is untouched.
