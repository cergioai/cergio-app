// Supabase Edge Function — the agents' WRITE hand. Lets the scheduled agents
// (COO, QA, Inspector) write to the DB DIRECTLY over HTTP — no Mac, no launcher.
// Auth: shared secret in the x-agent-token header (== AGENT_WRITE_TOKEN secret).
// Safe, narrow actions only (no arbitrary SQL).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, x-agent-token' };
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const token = req.headers.get('x-agent-token') || '';
    if (!token || token !== Deno.env.get('AGENT_WRITE_TOKEN')) return j({ error: 'unauthorized' }, 401);
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({} as any));
    const action = body?.action;

    if (action === 'set_proposals') {
      // Replace the pending proposal set (the COO/QA/Inspector daily output).
      const items = Array.isArray(body.proposals) ? body.proposals.slice(0, 8) : [];
      await db.from('coo_proposals').update({ status: 'dismissed' }).eq('status', 'pending');
      if (items.length) {
        const rows = items.map((p: any, i: number) => ({
          rank: p.rank ?? i + 1, division: String(p.division ?? 'General').slice(0, 40),
          title: String(p.title ?? '').slice(0, 200), detail: String(p.detail ?? '').slice(0, 1000),
          expected_lift: String(p.lift ?? p.expected_lift ?? '').slice(0, 120), effort: String(p.effort ?? '').slice(0, 60),
          status: 'pending',
        }));
        const { error } = await db.from('coo_proposals').insert(rows);
        if (error) throw error;
      }
      return j({ ok: true, set: items.length });
    }

    if (action === 'upsert_creators') {
      // Load harvested creators server-side, then run the gate.
      const list = Array.isArray(body.creators) ? body.creators.slice(0, 200) : [];
      const tag = `se:web-harvest-${new Date().toISOString().slice(0, 10)}`;
      let ok = 0;
      const rows = list.filter((c: any) => c && (c.email || c.phone)).map((c: any) => ({
        id: 'harv:' + String(c.ig_handle || c.email || c.phone).replace(/[^a-z0-9]+/gi, '').slice(0, 60).toLowerCase(),
        ig_handle: c.ig_handle ?? null, display_name: String(c.display_name ?? c.ig_handle ?? 'Creator').slice(0, 80),
        category: String(c.category ?? 'creator').slice(0, 60), email: c.email ?? null, phone: c.phone ?? null,
        city: String(c.city ?? 'Miami').slice(0, 60), state: 'FL', is_business: false,
        discovered_via: tag, outreach_status: 'new', created_at: new Date().toISOString(),
      }));
      for (let i = 0; i < rows.length; i += 25) {
        const { error } = await db.from('leads_influencers').upsert(rows.slice(i, i + 25), { onConflict: 'id' });
        if (!error) ok += rows.slice(i, i + 25).length;
      }
      try { await db.rpc('cergio_grade_creators'); } catch (_e) { /* non-fatal */ }
      const { count } = await db.from('leads_influencers').select('id', { count: 'exact', head: true }).eq('outreach_status', 'queued');
      return j({ ok: true, upserted: ok, creators_sendable_total: count ?? null });
    }

    if (action === 'log') {
      // Agents record what they actually did (audit trail).
      await db.from('harvest_runs').insert({ tag: 'agent:' + String(body.who ?? 'agent'), error: String(body.note ?? '').slice(0, 400) });
      return j({ ok: true });
    }

    return j({ error: 'unknown action', actions: ['set_proposals', 'upsert_creators', 'log'] }, 400);
  } catch (e) {
    return j({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
