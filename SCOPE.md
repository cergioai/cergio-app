# SCOPE

SPEC-250 — founder, 2026-08-03, verbatim: "need agents to commit any fixes directly
without approval if it's agasint spec.. need to expediate their delivery to NOW... back
to back... they can fix at same speed as you..."

One commit: agent PRs arm auto-merge (machine gate replaces the human click; required CI
check under branch protection is still the sole merge authority; needs_founder findings
still refused), the fleet re-fires on every merge to main (back-to-back), and gate #218
is FLIPPED per the SPEC-241 procedure — behaviour + gate in one commit, old rule
preserved in the gate text.

- `scripts/agent-pr.mjs`
- `.github/workflows/night-fleet.yml`
- `agents/fleet.json`
- `scripts/qa.mjs`
- `SCOPE.md`

## Shared files
May only GROW. To modify an existing line add `SHARED-CHANGE-APPROVED`.

- `src/lib/api.js`
- `supabase/functions/_shared/**`
- `supabase/functions/fulfill-crawl/index.ts`
- `scripts/qa.mjs`

SHARED-CHANGE-APPROVED — qa.mjs gate #218: ONE assert flipped from banning auto-merge to
requiring it, executing the founder's verbatim 2026-08-03 order. This is the SPEC-241
gate-flip procedure: the gate encoded a founder decision; the founder reversed it; the
gate flips WITH the new verbatim quote in the same commit. No other existing line changes.
