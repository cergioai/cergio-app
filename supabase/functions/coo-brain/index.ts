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

You are given a live metrics snapshot. Output the TOP 3-5 highest lift-to-effort actions RIGHT NOW, all obeying the constitution. Respond ONLY with JSON: {"proposals":[{"rank":1,"division":"Growth|Product/UX|Engineering|Traction|Data","title":"...","detail":"one or two concrete sentences","lift":"...","effort":"low|med|high"}]}`;

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
        model: MODEL, max_tokens: 1200, system: SYSTEM,
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
      const rows = items.map((p: any, i: number) => ({
        rank: p.rank ?? i + 1, division: String(p.division ?? 'General').slice(0, 40),
        title: String(p.title ?? '').slice(0, 200), detail: String(p.detail ?? '').slice(0, 1000),
        expected_lift: String(p.lift ?? '').slice(0, 120), effort: String(p.effort ?? '').slice(0, 60), status: 'pending',
      }));
      await db.from('coo_proposals').insert(rows);
    }
    try { await db.from('harvest_runs').insert({ tag: 'coo-brain', candidates: items.length, ms: Date.now() - started }); } catch (_e) { /**/ }
    return j({ ok: true, proposals_written: items.length, sample: items.map((p: any) => p.title), ms: Date.now() - started });
  } catch (e) {
    return j({ error: e instanceof Error ? e.message : String(e), ms: Date.now() - started }, 500);
  }
});
