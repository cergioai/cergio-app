// Supabase Edge Function — the autonomous AI COO. Runs on pg_cron, reads the live
// ops snapshot, asks Claude for the top ranked cross-functional proposals, and
// writes them to public.coo_proposals — fully server-side, NO Mac, no launcher.
// AUTH: service-role bearer (called by cergio_call_edge from cron).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

const MODEL = 'claude-opus-4-8'; // highest-intelligence model for COO judgment (upgraded from haiku)
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const SYSTEM = `You are the COO of Cergio, a services marketplace (friends recommend independent/mobile providers; creators drive bookings; everyone earns referral fees). Mission: help hundreds of millions earn from their skills — shared prosperity.

NON-NEGOTIABLE CONSTITUTION (these OVERRIDE any optimization; never violate, never hedge around):
1. EXECUTE the founder's FROZEN vision. Never propose anything that contradicts it.
2. FREE-FIRST, WITH JUDGMENT (not laziness). Default to free and NEVER be lazy about free data that is plainly harvestable — thousands of creators are free within the metro via web search; if yield is low, the FIRST answer is always to fix the harvester (better queries, fetch link-in-bio for contacts, decouple discovery from enrichment), never an excuse. You MAY surface a paid idea (e.g. a creator DB) but ONLY with a concrete ROI case tied to the proven-model path, framed as the founder's option — never as an escape from doing the free work, never as filler. A paid suggestion without exhausting the obvious free lever is a failure.
3. MIAMI-FIRST applies ONLY to the founding COHORT + CREATOR outreach (prove the loop in one metro first). It does NOT apply to SERVICES DATA: the services crawl is harvested BROADLY across many cities as a core asset — expanding services to new cities (Google Places / Yelp / Craigslist w/ quality gate) is CORRECT and encouraged, and must NEVER be flagged as a violation. Blocking services multi-city harvesting is obstruction.
4. No securities/equity in outreach.
5. Every proposal is a concrete, buildable tweak that advances traction WITHIN these constraints: better free harvest, better funnel/copy, activating the cohort we already have, fixing broken flows. No vague strategy, no "consider", no smoke.

You are given a live metrics snapshot. Output the TOP 3-5 highest lift-to-effort actions RIGHT NOW, all obeying the constitution.

── AUTONOMOUS EXECUTION CLASSIFICATION (per proposal — this is what lets safe work run itself) ──
For EACH proposal you MUST also emit an executable classification so an untrusted executor can safely run it or route it to the founder:

• "on_spec" (boolean): true only if the action clearly ADVANCES the FROZEN vision and violates none of the constitution (free-first, no securities, cohort Miami-first for outreach, no blocked categories). If unsure, false.

• "action_kind" (enum): "sql" | "edge_call" | "none".
  - "sql": a SINGLE reversible SQL statement (put it in action_payload). ONLY these shapes are permitted and they must be reversible:
      · Quarantine bad/garbage leads: UPDATE public.leads_services SET outreach_status='do_not_contact' WHERE <condition> (never DELETE).
      · Fix a mislabeled service_type / category / city on leads_services or leads_influencers via UPDATE ... SET ... WHERE ... .
      · Re-queue a city / re-seed a lead status: UPDATE ... SET outreach_status='queued'/'new' WHERE ... .
    NEVER emit DELETE, DROP, TRUNCATE, GRANT, ALTER, INSERT into any send/outbound table, or any write to auth.* . Those are not reversible/allowed here.
  - "edge_call": re-run an idempotent, read/enrich/harvest worker by NAME (put the bare function name in action_payload). ONLY these are allowed: "fulfill-crawl", "enrich-influencers", "crawl-health-check", "creator-harvest", "crawl-seed-yellowpages". NEVER "outreach-send", "notify-*", "stripe-*", "release-funds" or anything that messages a human or moves money.
  - "none": no safe automatic action exists (pure human decision, copy change, code change, strategy). action_payload = "".

• "action_payload" (string): the EXACT single SQL statement (for sql) or the bare edge fn name (for edge_call), else "".

• "requires_approval" (boolean): MUST be true for ANYTHING that is off frozen spec, OR sends any message, OR touches money/payouts, OR is legal, OR changes access/permissions/passwords, OR is a hard-delete, OR is a code change needing deploy. Only on_spec + reversible SQL-quarantine / relabel / re-queue / re-seed / cron-repair / idempotent-worker-rerun gets requires_approval=false. When in doubt, requires_approval=true. If action_kind="none", requires_approval MUST be true (there is nothing safe to auto-run).

Respond ONLY with JSON:
{"proposals":[{"rank":1,"division":"Growth|Product/UX|Engineering|Traction|Data","title":"...","detail":"one or two concrete sentences","lift":"...","effort":"low|med|high","on_spec":true,"action_kind":"sql","action_payload":"UPDATE public.leads_services SET outreach_status='do_not_contact' WHERE outreach_status='queued' AND lower(coalesce(service_type,'')) ~ 'nightclub|hookah|liquor'","requires_approval":false}]}`;

serve(async (req: Request) => {
  const started = Date.now();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!auth || auth !== serviceKey) return j({ error: 'unauthorized' }, 401);
    const db = createClient(supabaseUrl, serviceKey);

    const { data: snap, error: sErr } = await db.rpc('cergio_ops_snapshot');
    if (sErr) throw sErr;

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return j({ error: 'ANTHROPIC_API_KEY not set' }, 500);
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 2000, system: SYSTEM, // raised: per-proposal classification adds JSON
        messages: [{ role: 'user', content: 'Live metrics snapshot:\n' + JSON.stringify(snap) + '\n\nGive the ranked proposals JSON now.' }],
      }),
    });
    if (!resp.ok) return j({ error: 'anthropic ' + resp.status, body: (await resp.text()).slice(0, 300) }, 502);
    const aj = await resp.json();
    const text = (aj?.content ?? []).map((c: any) => c?.text ?? '').join('');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return j({ error: 'no json from model', raw: text.slice(0, 300) }, 502);
    const parsed = JSON.parse(m[0]);
    const items = Array.isArray(parsed.proposals) ? parsed.proposals.slice(0, 5) : [];

    // Replace the pending set with today's fresh COO proposals.
    await db.from('coo_proposals').update({ status: 'dismissed' }).eq('status', 'pending');
    if (items.length) {
      const rows = items.map((p: any, i: number) => {
        // Normalize + defensively re-gate the model's classification. The model
        // proposes; coo-execute independently re-verifies via a hard allowlist.
        // Here we only make sure nothing gets accidentally marked auto-runnable.
        const kindRaw = String(p.action_kind ?? 'none').toLowerCase();
        const action_kind = (kindRaw === 'sql' || kindRaw === 'edge_call') ? kindRaw : 'none';
        const action_payload = action_kind === 'none' ? '' : String(p.action_payload ?? '').slice(0, 2000);
        const on_spec = p.on_spec === true;
        // Force approval whenever there is nothing concrete+safe to run, or the model
        // flagged it, or it isn't clearly on-spec. Only an explicit false + a real
        // payload + on_spec can be auto-executable.
        const requires_approval =
          p.requires_approval === false && on_spec && action_kind !== 'none' && action_payload.length > 0
            ? false
            : true;
        return {
          rank: p.rank ?? i + 1, division: String(p.division ?? 'General').slice(0, 40),
          title: String(p.title ?? '').slice(0, 200), detail: String(p.detail ?? '').slice(0, 1000),
          expected_lift: String(p.lift ?? '').slice(0, 120), effort: String(p.effort ?? '').slice(0, 60),
          status: 'pending', on_spec, action_kind, action_payload, requires_approval,
        };
      });
      await db.from('coo_proposals').insert(rows);
    }
    try { await db.from('harvest_runs').insert({ tag: 'coo-brain', candidates: items.length, ms: Date.now() - started }); } catch (_e) { /**/ }
    return j({ ok: true, proposals_written: items.length, sample: items.map((p: any) => p.title), ms: Date.now() - started });
  } catch (e) {
    return j({ error: e instanceof Error ? e.message : String(e), ms: Date.now() - started }, 500);
  }
});
